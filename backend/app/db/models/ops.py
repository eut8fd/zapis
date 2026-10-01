"""Уведомления, рассылки, поддержка, аудит, медиа и очереди (ТЗ 11.6)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey
from app.db.types import GUID, BigIntType, JSONBType, UTCDateTime
from app.domain import (
    BroadcastStatus, MediaStatus, NotificationChannel, NotificationStatus, OutboxStatus,
    TicketStatus,
)


class NotificationJob(UUIDPrimaryKey, Base):
    """
    ТЗ 15.2: задача живёт в БД, успех фиксируется только после ответа
    провайдера, а перезапуск worker не теряет и не дублирует отправку.
    """
    __tablename__ = 'notification_jobs'
    __table_args__ = (
        UniqueConstraint('idempotency_key', name='uq_notification_jobs_idempotency_key'),
        Index('ix_notification_jobs_due', 'status', 'scheduled_at'),
        Index('ix_notification_jobs_appointment', 'appointment_id'),
    )

    company_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('appointments.id', ondelete='CASCADE'),
    )
    broadcast_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    channel: Mapped[str] = mapped_column(String(16), default=NotificationChannel.TELEGRAM, nullable=False)
    template: Mapped[str] = mapped_column(String(48), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), default='ru', nullable=False)
    payload: Mapped[dict] = mapped_column(JSONBType(), default=dict, nullable=False)
    recipient_telegram_id: Mapped[int | None] = mapped_column(BigIntType())

    scheduled_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=NotificationStatus.PENDING, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    locked_by: Mapped[str | None] = mapped_column(String(64))

    provider_response_code: Mapped[str | None] = mapped_column(String(32))
    last_error: Mapped[str | None] = mapped_column(String(255))

    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Broadcast(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'broadcasts'

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text(), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=BroadcastStatus.DRAFT, nullable=False)

    # MSG-003: аудитория фиксируется снимком на момент запуска, а не
    # пересчитывается в момент отправки каждого сообщения.
    audience_filter: Mapped[dict] = mapped_column(JSONBType(), default=dict, nullable=False)
    audience_size: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)

    scheduled_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    sent_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    failed_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    blocked_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)


class BroadcastRecipient(Base):
    __tablename__ = 'broadcast_recipients'
    __table_args__ = (
        UniqueConstraint('broadcast_id', 'client_id', name='uq_broadcast_recipients_broadcast_id'),
        Index('ix_broadcast_recipients_status', 'broadcast_id', 'status'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    broadcast_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('broadcasts.id', ondelete='CASCADE'), nullable=False,
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('clients.id', ondelete='CASCADE'), nullable=False,
    )
    recipient_telegram_id: Mapped[int | None] = mapped_column(BigIntType())
    consent_snapshot: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default='pending', nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64))
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class SuppressionEntry(Base):
    """MSG-002: отписка и постоянные ошибки доставки. Проверяется до отправки."""
    __tablename__ = 'suppression_entries'
    __table_args__ = (
        UniqueConstraint('company_id', 'telegram_user_id', name='uq_suppression_entries_company_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    # NULL company_id — платформенная блокировка (пользователь заблокировал бота).
    company_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    telegram_user_id: Mapped[int] = mapped_column(BigIntType(), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class SupportTicket(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'support_tickets'

    company_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), index=True)
    author_user_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False)
    assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(32), default='general', nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default='normal', nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=TicketStatus.OPEN, nullable=False)

    first_response_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    sla_due_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class TicketMessage(Base):
    __tablename__ = 'ticket_messages'

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('support_tickets.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    author_kind: Mapped[str] = mapped_column(String(16), default='user', nullable=False)
    body: Mapped[str] = mapped_column(Text(), nullable=False)
    internal: Mapped[bool] = mapped_column(Boolean(), default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class AuditEvent(Base):
    """
    Append-only журнал (ADM-005). Ни UPDATE, ни DELETE в коде приложения нет —
    на PostgreSQL это дополнительно закрывается правами роли.
    """
    __tablename__ = 'audit_events'
    __table_args__ = (
        Index('ix_audit_events_company_time', 'company_id', 'created_at'),
        Index('ix_audit_events_actor_time', 'actor_user_id', 'created_at'),
        Index('ix_audit_events_target', 'target_type', 'target_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    actor_role: Mapped[str | None] = mapped_column(String(24))
    actor_kind: Mapped[str] = mapped_column(String(16), default='user', nullable=False)

    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(64))

    before: Mapped[dict | None] = mapped_column(JSONBType())
    after: Mapped[dict | None] = mapped_column(JSONBType())
    reason: Mapped[str | None] = mapped_column(String(255))

    correlation_id: Mapped[str | None] = mapped_column(String(64))
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class MediaAsset(UUIDPrimaryKey, Base):
    __tablename__ = 'media_assets'

    company_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), index=True)
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    object_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer(), nullable=False)
    checksum: Mapped[str | None] = mapped_column(String(64))
    width: Mapped[int | None] = mapped_column(Integer())
    height: Mapped[int | None] = mapped_column(Integer())
    status: Mapped[str] = mapped_column(String(16), default=MediaStatus.UPLOADING, nullable=False)
    variants: Mapped[dict | None] = mapped_column(JSONBType())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    # ТЗ 16: удаление сущности не стирает файл сразу — есть окно восстановления.
    delete_after: Mapped[datetime | None] = mapped_column(UTCDateTime())


class OutboxEvent(Base):
    """
    Transactional outbox: событие пишется той же транзакцией, что и бизнес-
    изменение (ТЗ 10.2). Иначе запись создана, а уведомление потеряно.
    """
    __tablename__ = 'outbox_events'
    __table_args__ = (
        Index('ix_outbox_events_pending', 'status', 'available_at'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONBType(), default=dict, nullable=False)

    status: Mapped[str] = mapped_column(String(16), default=OutboxStatus.PENDING, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    available_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    locked_by: Mapped[str | None] = mapped_column(String(64))
    last_error: Mapped[str | None] = mapped_column(String(255))

    correlation_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class InboxEvent(Base):
    """
    Идемпотентный приём внешних событий: Telegram update_id и webhook
    провайдера. Повтор доставки не приводит к повторной обработке.
    """
    __tablename__ = 'inbox_events'
    __table_args__ = (
        UniqueConstraint('source', 'external_id', name='uq_inbox_events_source'),
        Index('ix_inbox_events_pending', 'status', 'created_at'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    source: Mapped[str] = mapped_column(String(24), nullable=False)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONBType(), default=dict, nullable=False)

    status: Mapped[str] = mapped_column(String(16), default=OutboxStatus.PENDING, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class IdempotencyRecord(Base):
    """
    Ключи идемпотентности для критичных POST (ТЗ 12.1). Хранится отпечаток
    запроса: тот же ключ с другим телом — это ошибка клиента, а не повтор.
    """
    __tablename__ = 'idempotency_records'
    __table_args__ = (
        UniqueConstraint('scope', 'key', name='uq_idempotency_records_scope'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    scope: Mapped[str] = mapped_column(String(96), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int | None] = mapped_column(Integer())
    response_body: Mapped[dict | None] = mapped_column(JSONBType())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
