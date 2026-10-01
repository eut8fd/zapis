"""
Worker уведомлений и outbox (ТЗ 15.2, 10.2).

Гарантии, которые он обязан держать:
- задача переходит в `sent` только после успешного ответа Telegram;
- 429 уважает `retry_after`, временные ошибки уходят в backoff с джиттером;
- постоянные ошибки попадают в suppression, а не крутятся вечно;
- после лимита попыток задача остаётся `failed` — это DLQ для alert;
- перезапуск посреди отправки не теряет и не дублирует задачи.
"""
from __future__ import annotations

import asyncio
import random
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.logging import get_logger
from app.db import base as db
from app.db.models import (
    Appointment, Branch, Client, Company, NotificationJob, OutboxEvent, SuppressionEntry,
)
from app.db.types import new_uuid, utcnow
from app.domain import NotificationStatus, OutboxStatus
from app.core import idempotency
from app.services import messages, notifications, outbox
from app.services.timeutils import local
from app.workers import transport as transport_factory
from app.workers.telegram import SendResult
from app.workers.transport import Transport

log = get_logger('zapis.worker')

MAX_ATTEMPTS = 8
BATCH_SIZE = 25
IDLE_SLEEP_SECONDS = 5
#: Telegram разрешает ~30 сообщений в секунду суммарно. Держим запас.
SEND_INTERVAL_SECONDS = 0.05


def backoff_seconds(attempt: int) -> float:
    """Экспонента с джиттером: без него все задачи повторятся в один момент."""
    base = min(2 ** attempt, 900)
    return base * (0.5 + random.random() / 2)


async def _claim(session: AsyncSession, worker_id: str, now: datetime) -> list[NotificationJob]:
    jobs = await notifications.due_jobs(session, limit=BATCH_SIZE, now=now)
    if not jobs:
        return []
    await session.execute(
        update(NotificationJob)
        .where(NotificationJob.id.in_([job.id for job in jobs]))
        .values(status=NotificationStatus.PROCESSING, locked_at=now, locked_by=worker_id)
    )
    await session.commit()
    return jobs


async def _is_suppressed(session: AsyncSession, job: NotificationJob) -> bool:
    """MSG-002: отписка и «бот заблокирован» проверяются до отправки."""
    entry = await session.scalar(
        select(SuppressionEntry).where(
            SuppressionEntry.telegram_user_id == job.recipient_telegram_id,
            (SuppressionEntry.company_id.is_(None))
            | (SuppressionEntry.company_id == job.company_id),
        )
    )
    return entry is not None


async def build_text(session: AsyncSession, job: NotificationJob) -> str:
    """Собирает текст сообщения: локаль, дата в зоне филиала, название услуги."""
    values: dict = dict(job.payload or {})

    appointment = None
    if job.appointment_id is not None:
        appointment = await session.get(Appointment, job.appointment_id)

    company = None
    if job.company_id is not None:
        company = await session.get(Company, job.company_id)
    if company is not None:
        values['company'] = company.name

    if appointment is not None:
        branch = await session.get(Branch, appointment.branch_id)
        tz_name = branch.timezone if branch else 'UTC'
        local_start = local(appointment.service_starts_at, tz_name)
        values['date'] = messages.format_date(local_start, job.locale)
        values['time'] = local_start.strftime('%H:%M')
        values['title'] = appointment.title_snapshot
        values['address'] = f'\n{branch.address}' if branch and branch.address else ''

        client = await session.get(Client, appointment.client_id)
        if client is not None:
            values['client'] = client.display_name

    return messages.render(job.template, job.locale, values)


async def _apply_result(
    session: AsyncSession, job: NotificationJob, result: SendResult, now: datetime,
) -> None:
    job.attempt_count += 1
    job.provider_response_code = result.error_code
    job.locked_at = None
    job.locked_by = None

    if result.ok:
        # Успех фиксируется только здесь — после ответа провайдера.
        job.status = NotificationStatus.SENT
        job.sent_at = now
        job.last_error = None
        return

    job.last_error = (result.description or result.error_code or 'unknown')[:255]

    if result.permanent:
        job.status = NotificationStatus.FAILED
        if job.recipient_telegram_id:
            existing = await session.scalar(
                select(SuppressionEntry).where(
                    SuppressionEntry.telegram_user_id == job.recipient_telegram_id,
                    SuppressionEntry.company_id.is_(None),
                )
            )
            if existing is None:
                session.add(SuppressionEntry(
                    id=new_uuid(), company_id=None,
                    telegram_user_id=job.recipient_telegram_id,
                    reason=job.last_error[:64], created_at=now,
                ))
        return

    if job.attempt_count >= MAX_ATTEMPTS:
        # DLQ: дальше разбирается человек по alert, автоматика сдалась.
        job.status = NotificationStatus.FAILED
        log.error('notification.dead_letter', extra={
            'job_id': str(job.id), 'template': job.template, 'attempts': job.attempt_count,
        })
        return

    delay = result.retry_after if result.retry_after else backoff_seconds(job.attempt_count)
    job.status = NotificationStatus.RETRY
    job.next_attempt_at = now + timedelta(seconds=float(delay))


async def process_notifications(
    session: AsyncSession, telegram: Transport, worker_id: str,
) -> int:
    now = utcnow()
    jobs = await _claim(session, worker_id, now)
    sent = 0

    for job in jobs:
        if await _is_suppressed(session, job):
            job.status = NotificationStatus.CANCELLED
            job.cancelled_at = now
            job.last_error = 'suppressed'
            continue

        text = await build_text(session, job)
        if not text:
            job.status = NotificationStatus.FAILED
            job.last_error = 'empty_template'
            continue

        result = await telegram.send_message(job.recipient_telegram_id, text)
        await _apply_result(session, job, result, utcnow())
        sent += 1 if result.ok else 0
        await asyncio.sleep(SEND_INTERVAL_SECONDS)

    await session.commit()
    return sent


# --------------------------------------------------------------------- outbox

async def process_outbox(session: AsyncSession, worker_id: str) -> int:
    """
    Разбирает бизнес-события. Сейчас единственный потребитель — запрос
    отзыва: остальные уведомления планируются прямо в транзакции записи.
    """
    events = await outbox.claim_batch(session, worker_id, limit=BATCH_SIZE)
    handled = 0

    for event in events:
        try:
            await _handle_event(session, event)
            await outbox.mark_done(session, event)
            handled += 1
        except Exception as exc:                    # noqa: BLE001 — событие не должно ронять цикл
            log.exception('outbox.handler_failed', extra={'event_type': event.event_type})
            await outbox.mark_failed(session, event, str(exc))

    await session.commit()
    return handled


async def _handle_event(session: AsyncSession, event: OutboxEvent) -> None:
    if event.event_type != outbox.EventType.REVIEW_REQUESTED:
        return

    appointment_id = event.payload.get('appointment_id')
    if not appointment_id:
        return

    appointment = await session.get(Appointment, uuid.UUID(appointment_id))
    if appointment is None or appointment.status != 'completed':
        return

    client = await session.get(Client, appointment.client_id)
    company = await session.get(Company, appointment.company_id)
    if client is None or company is None:
        return

    telegram_id = await notifications.telegram_id_for_client(session, client)
    notifications.schedule(
        session,
        template=notifications.Template.REVIEW_REQUEST,
        scheduled_at=utcnow(),
        company_id=company.id,
        recipient_telegram_id=telegram_id,
        payload={'appointment_id': str(appointment.id)},
        locale=company.default_locale,
        appointment_id=appointment.id,
        key=notifications.idempotency_key('review', appointment.id),
    )


# ----------------------------------------------------------------- цикл жизни

#: Как часто чистить просроченные ключи идемпотентности. Раз в час
#: достаточно: записи живут сутки, а запрос тяжёлый.
HOUSEKEEPING_INTERVAL_SECONDS = 3600


async def run_forever(stop: asyncio.Event | None = None) -> None:
    settings = get_settings()
    worker_id = f'worker-{uuid.uuid4().hex[:8]}'
    stop = stop or asyncio.Event()
    next_housekeeping = 0.0
    log.info('worker.start', extra={'worker_id': worker_id})

    # Транспорт выбирает конфигурация: Bot API или локальный инбокс.
    # Всё, что выше — очередь, повторы и отмены — от этого не зависит.
    async with transport_factory.build(settings) as telegram:
        while not stop.is_set():
            try:
                async with db.get_sessionmaker()() as session:
                    sent = await process_notifications(session, telegram, worker_id)
                    handled = await process_outbox(session, worker_id)

                    loop_time = asyncio.get_running_loop().time()
                    if loop_time >= next_housekeeping:
                        purged = await idempotency.purge_expired(session)
                        await session.commit()
                        next_housekeeping = loop_time + HOUSEKEEPING_INTERVAL_SECONDS
                        if purged:
                            log.info('worker.purged_idempotency', extra={'count': purged})
            except Exception:                       # noqa: BLE001 — цикл не должен умирать
                log.exception('worker.iteration_failed')
                sent = handled = 0

            if not sent and not handled:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=IDLE_SLEEP_SECONDS)
                except asyncio.TimeoutError:
                    pass

    log.info('worker.stop', extra={'worker_id': worker_id})


async def requeue_stale(session: AsyncSession, *, older_than_minutes: int = 15) -> int:
    """
    Задачи, застрявшие в `processing` после падения worker, возвращаются
    в очередь. Без этого рестарт посреди отправки терял бы уведомления.
    """
    cutoff = utcnow() - timedelta(minutes=older_than_minutes)
    result = await session.execute(
        update(NotificationJob)
        .where(
            NotificationJob.status == NotificationStatus.PROCESSING,
            NotificationJob.locked_at < cutoff,
        )
        .values(status=NotificationStatus.RETRY, next_attempt_at=utcnow(),
                locked_at=None, locked_by=None)
    )
    stale_outbox = await session.execute(
        update(OutboxEvent)
        .where(OutboxEvent.status == OutboxStatus.PROCESSING, OutboxEvent.locked_at < cutoff)
        .values(status=OutboxStatus.PENDING, available_at=utcnow(),
                locked_at=None, locked_by=None)
    )
    await session.commit()
    return (result.rowcount or 0) + (stale_outbox.rowcount or 0)
