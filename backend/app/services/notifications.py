"""
Планирование уведомлений (ТЗ 15).

Задачи создаются в той же транзакции, что и бизнес-изменение. Отправка —
дело worker: он один разговаривает с Telegram и умеет retry, backoff и DLQ.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import sha256_hex
from app.db.models import Appointment, Client, NotificationJob, User
from app.db.types import new_uuid, utcnow
from app.domain import NotificationStatus


class Template:
    APPOINTMENT_CONFIRMED = 'appointment_confirmed'
    APPOINTMENT_REMINDER = 'appointment_reminder'
    APPOINTMENT_RESCHEDULED = 'appointment_rescheduled'
    APPOINTMENT_CANCELLED = 'appointment_cancelled'
    APPOINTMENT_CREATED_STAFF = 'appointment_created_staff'
    REVIEW_REQUEST = 'review_request'
    DAILY_DIGEST = 'daily_digest'
    INVITE_CREATED = 'invite_created'
    SUBSCRIPTION_EXPIRING = 'subscription_expiring'
    PAYMENT_RESULT = 'payment_result'
    BROADCAST = 'broadcast'


#: Напоминания по умолчанию (ТЗ 15.1). Компания может переопределить в настройках.
DEFAULT_REMINDERS_MINUTES = (24 * 60, 2 * 60)


def idempotency_key(*parts: object) -> str:
    """
    Ключ сообщения (ТЗ 15.2). Строится из смысла, а не из времени запроса:
    повторный вызов планировщика не создаёт второе такое же напоминание.
    """
    return sha256_hex('|'.join(str(p) for p in parts))[:64]


def schedule(
    session: AsyncSession,
    *,
    template: str,
    scheduled_at: datetime,
    company_id: uuid.UUID | None,
    recipient_telegram_id: int | None,
    payload: dict,
    locale: str = 'ru',
    user_id: uuid.UUID | None = None,
    appointment_id: uuid.UUID | None = None,
    broadcast_id: uuid.UUID | None = None,
    key: str | None = None,
) -> NotificationJob | None:
    """
    Ставит задачу в очередь. Без Telegram ID отправлять некому — молча не
    создаём задачу, которая всё равно уйдёт в failed.
    """
    if not recipient_telegram_id:
        return None

    job = NotificationJob(
        id=new_uuid(),
        company_id=company_id,
        user_id=user_id,
        appointment_id=appointment_id,
        broadcast_id=broadcast_id,
        template=template,
        locale=locale,
        payload=payload,
        recipient_telegram_id=recipient_telegram_id,
        scheduled_at=scheduled_at,
        status=NotificationStatus.PENDING,
        next_attempt_at=scheduled_at,
        idempotency_key=key or idempotency_key(
            template, company_id, appointment_id, recipient_telegram_id, scheduled_at.isoformat(),
        ),
        created_at=utcnow(),
    )
    session.add(job)
    return job


async def cancel_for_appointment(
    session: AsyncSession, appointment_id: uuid.UUID, *, templates: list[str] | None = None,
) -> None:
    """
    APT-010: перенос и отмена гасят устаревшие напоминания. Уже отправленные
    не трогаем — их из истории не вернуть.
    """
    stmt = (
        update(NotificationJob)
        .where(
            NotificationJob.appointment_id == appointment_id,
            NotificationJob.status.in_([NotificationStatus.PENDING, NotificationStatus.RETRY]),
        )
        .values(status=NotificationStatus.CANCELLED, cancelled_at=utcnow())
    )
    if templates:
        stmt = stmt.where(NotificationJob.template.in_(templates))
    await session.execute(stmt)


def reminder_offsets(company_settings: dict | None) -> tuple[int, ...]:
    raw = (company_settings or {}).get('reminders_minutes')
    if not isinstance(raw, list) or not raw:
        return DEFAULT_REMINDERS_MINUTES
    values = sorted({int(v) for v in raw if isinstance(v, (int, float)) and 0 < int(v) <= 14 * 24 * 60},
                    reverse=True)
    return tuple(values) or DEFAULT_REMINDERS_MINUTES


async def plan_appointment_notifications(
    session: AsyncSession,
    appointment: Appointment,
    *,
    company_settings: dict | None,
    client_telegram_id: int | None,
    employee_telegram_id: int | None,
    locale: str = 'ru',
    kind: str = 'created',
    now: datetime | None = None,
) -> list[NotificationJob]:
    """Подтверждение клиенту, сообщение мастеру и напоминания до визита."""
    now = now or utcnow()
    created: list[NotificationJob] = []
    payload = {
        'appointment_id': str(appointment.id),
        'company_id': str(appointment.company_id),
        'starts_at': appointment.starts_at.isoformat(),
        'title': appointment.title_snapshot,
    }

    confirm_template = (
        Template.APPOINTMENT_CONFIRMED if kind == 'created' else Template.APPOINTMENT_RESCHEDULED
    )
    job = schedule(
        session, template=confirm_template, scheduled_at=now,
        company_id=appointment.company_id, recipient_telegram_id=client_telegram_id,
        payload=payload, locale=locale, appointment_id=appointment.id,
        key=idempotency_key(confirm_template, appointment.id, appointment.version, client_telegram_id),
    )
    if job:
        created.append(job)

    job = schedule(
        session, template=Template.APPOINTMENT_CREATED_STAFF, scheduled_at=now,
        company_id=appointment.company_id, recipient_telegram_id=employee_telegram_id,
        payload=payload, locale=locale, appointment_id=appointment.id,
        key=idempotency_key('staff', appointment.id, appointment.version, employee_telegram_id),
    )
    if job:
        created.append(job)

    for offset in reminder_offsets(company_settings):
        when = appointment.starts_at - timedelta(minutes=offset)
        if when <= now:
            continue                       # визит слишком близко — напоминать нечем
        job = schedule(
            session, template=Template.APPOINTMENT_REMINDER, scheduled_at=when,
            company_id=appointment.company_id, recipient_telegram_id=client_telegram_id,
            payload=dict(payload, offset_minutes=offset), locale=locale,
            appointment_id=appointment.id,
            key=idempotency_key('reminder', appointment.id, appointment.version, offset),
        )
        if job:
            created.append(job)
    return created


async def telegram_id_for_client(session: AsyncSession, client: Client) -> int | None:
    if client.user_id is None:
        return None
    user = await session.get(User, client.user_id)
    return user.telegram_user_id if user else None


async def telegram_id_for_employee(session: AsyncSession, employee_user_id: uuid.UUID | None) -> int | None:
    if employee_user_id is None:
        return None
    user = await session.get(User, employee_user_id)
    return user.telegram_user_id if user else None


async def due_jobs(session: AsyncSession, *, limit: int = 50, now: datetime | None = None) -> list[NotificationJob]:
    now = now or utcnow()
    stmt = (
        select(NotificationJob)
        .where(
            NotificationJob.status.in_([NotificationStatus.PENDING, NotificationStatus.RETRY]),
            NotificationJob.next_attempt_at <= now,
        )
        .order_by(NotificationJob.next_attempt_at)
        .limit(limit)
    )
    if session.bind is not None and session.bind.dialect.name == 'postgresql':
        stmt = stmt.with_for_update(skip_locked=True)
    return list((await session.execute(stmt)).scalars().all())
