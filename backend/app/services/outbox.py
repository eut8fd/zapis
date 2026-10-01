"""
Transactional outbox и inbox (ТЗ 10.2, 9.2).

Смысл: бизнес-транзакция никогда не ходит в Telegram или к провайдеру
напрямую. Она кладёт событие в ту же БД тем же коммитом, а доставкой
занимается worker. Иначе появляется классическая пара багов — запись
создана без уведомления либо уведомление ушло по откатившейся записи.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.context import get_correlation_id
from app.db.models import InboxEvent, OutboxEvent
from app.db.types import new_uuid, utcnow
from app.domain import OutboxStatus

MAX_ATTEMPTS = 8


class EventType:
    APPOINTMENT_CREATED = 'appointment.created'
    APPOINTMENT_RESCHEDULED = 'appointment.rescheduled'
    APPOINTMENT_CANCELLED = 'appointment.cancelled'
    APPOINTMENT_COMPLETED = 'appointment.completed'
    APPOINTMENT_NO_SHOW = 'appointment.no_show'
    REVIEW_REQUESTED = 'review.requested'
    INVITE_CREATED = 'invite.created'
    PAYMENT_PAID = 'payment.paid'
    PAYMENT_FAILED = 'payment.failed'
    SUBSCRIPTION_EXPIRING = 'subscription.expiring'
    BROADCAST_ENQUEUED = 'broadcast.enqueued'


def emit(
    session: AsyncSession,
    event_type: str,
    payload: dict[str, Any],
    *,
    company_id: uuid.UUID | None = None,
    available_at: datetime | None = None,
) -> OutboxEvent:
    """Добавляет событие в сессию. Коммит делает вызывающая транзакция."""
    event = OutboxEvent(
        id=new_uuid(),
        company_id=company_id,
        event_type=event_type,
        payload=payload,
        status=OutboxStatus.PENDING,
        available_at=available_at or utcnow(),
        correlation_id=get_correlation_id(),
        created_at=utcnow(),
    )
    session.add(event)
    return event


async def claim_batch(
    session: AsyncSession, worker_id: str, *, limit: int = 50,
) -> list[OutboxEvent]:
    """
    Забирает пачку событий под свой worker_id. На PostgreSQL — SKIP LOCKED,
    чтобы несколько worker не дрались за одни строки; на SQLite блокировка
    базы и так сериализует доступ.
    """
    now = utcnow()
    stmt = (
        select(OutboxEvent)
        .where(
            OutboxEvent.status.in_([OutboxStatus.PENDING, OutboxStatus.PROCESSING]),
            OutboxEvent.available_at <= now,
        )
        .order_by(OutboxEvent.available_at)
        .limit(limit)
    )
    if session.bind is not None and session.bind.dialect.name == 'postgresql':
        stmt = stmt.with_for_update(skip_locked=True)

    events = list((await session.execute(stmt)).scalars().all())
    if not events:
        return []

    await session.execute(
        update(OutboxEvent)
        .where(OutboxEvent.id.in_([e.id for e in events]))
        .values(status=OutboxStatus.PROCESSING, locked_at=now, locked_by=worker_id)
    )
    await session.commit()
    return events


async def mark_done(session: AsyncSession, event: OutboxEvent) -> None:
    event.status = OutboxStatus.DONE
    event.processed_at = utcnow()
    event.locked_by = None
    event.locked_at = None


async def mark_failed(session: AsyncSession, event: OutboxEvent, error: str) -> None:
    """
    Экспоненциальный backoff. После MAX_ATTEMPTS событие остаётся failed —
    это и есть DLQ, по которому срабатывает alert (ТЗ 15.2).
    """
    event.attempt_count += 1
    event.last_error = error[:255]
    event.locked_by = None
    event.locked_at = None
    if event.attempt_count >= MAX_ATTEMPTS:
        event.status = OutboxStatus.FAILED
        event.processed_at = utcnow()
        return
    delay = min(2 ** event.attempt_count, 900)
    event.status = OutboxStatus.PENDING
    event.available_at = utcnow() + timedelta(seconds=delay)


# ------------------------------------------------------------------- inbox

async def accept_inbound(
    session: AsyncSession, source: str, external_id: str, payload: dict[str, Any],
) -> InboxEvent | None:
    """
    Регистрирует внешнее событие. Возвращает None, если такое уже было —
    повторная доставка Telegram update или webhook безопасна (ТЗ 9.1, 14.3).
    """
    existing = await session.scalar(
        select(InboxEvent).where(
            InboxEvent.source == source, InboxEvent.external_id == str(external_id),
        )
    )
    if existing is not None:
        return None

    event = InboxEvent(
        id=new_uuid(),
        source=source,
        external_id=str(external_id),
        payload=payload,
        status=OutboxStatus.PENDING,
        created_at=utcnow(),
    )
    session.add(event)
    return event
