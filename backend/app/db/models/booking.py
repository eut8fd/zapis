"""Клиенты, записи, история и отзывы (ТЗ 11.3)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey
from app.db.types import GUID, JSONBType, UTCDateTime
from app.domain import (
    AppointmentPaymentStatus, AppointmentSource, AppointmentStatus, ClientStatus,
    ConsentStatus, ReviewStatus,
)


class Client(UUIDPrimaryKey, Timestamps, Base):
    """
    CRM-001: карточка принадлежит компании. Один и тот же человек в двух
    компаниях — две карточки, связанные общим user_id. Ровно это не даёт
    новому пользователю по branded-ссылке попасть в чужую карточку (CAT-006).
    """
    __tablename__ = 'clients'
    __table_args__ = (
        # Один подтверждённый пользователь — не более одной карточки в компании.
        UniqueConstraint('company_id', 'user_id', name='uq_clients_company_user'),
        Index('ix_clients_company_phone', 'company_id', 'phone_normalized'),
        Index('ix_clients_company_status', 'company_id', 'status'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('users.id', ondelete='SET NULL'),
    )

    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    # CRM-002/003: телефон, telegram id и username — три разных поля,
    # нормализацию делает сервер.
    phone_normalized: Mapped[str | None] = mapped_column(String(32))
    phone_raw: Mapped[str | None] = mapped_column(String(40))
    telegram_username: Mapped[str | None] = mapped_column(String(64))

    source: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default=ClientStatus.ACTIVE, nullable=False)
    consent_status: Mapped[str] = mapped_column(
        String(16), default=ConsentStatus.UNKNOWN, nullable=False,
    )
    consent_updated_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    preferences: Mapped[dict] = mapped_column(JSONBType(), default=dict, nullable=False)
    anonymized_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class ClientNote(UUIDPrimaryKey, Base):
    """CRM-006/007: заметка имеет автора, видимость и попадает в аудит."""
    __tablename__ = 'client_notes'

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('clients.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    body: Mapped[str] = mapped_column(Text(), nullable=False)
    visibility: Mapped[str] = mapped_column(String(16), default='team', nullable=False)
    sensitive: Mapped[bool] = mapped_column(Boolean(), default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class ClientTag(UUIDPrimaryKey, Base):
    __tablename__ = 'client_tags'
    __table_args__ = (
        UniqueConstraint('company_id', 'name', name='uq_client_tags_company_id'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str | None] = mapped_column(String(9))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class ClientTagLink(Base):
    __tablename__ = 'client_tag_links'
    __table_args__ = (
        UniqueConstraint('client_id', 'tag_id', name='uq_client_tag_links_client_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('clients.id', ondelete='CASCADE'), nullable=False,
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('client_tags.id', ondelete='CASCADE'), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class Appointment(UUIDPrimaryKey, Timestamps, Base):
    """
    Запись. Интервал `starts_at..ends_at` — занятое время целиком, включая
    буферы услуги: именно он проверяется на пересечение.

    Дополнительно на PostgreSQL миграция вешает exclusion constraint
    (employee_id, tstzrange) WHERE status IN (...) — это и есть настоящая
    гарантия APT-003, приложение лишь дублирует её понятной ошибкой.
    """
    __tablename__ = 'appointments'
    __table_args__ = (
        CheckConstraint('starts_at < ends_at', name='interval_ordered'),
        CheckConstraint('price_minor >= 0', name='price_non_negative'),
        # APT-002: повтор запроса с тем же ключом не создаёт вторую запись.
        UniqueConstraint('company_id', 'idempotency_key', name='uq_appointments_company_idempotency'),
        Index('ix_appointments_company_start', 'company_id', 'starts_at'),
        Index('ix_appointments_employee_start', 'employee_id', 'starts_at'),
        Index('ix_appointments_client', 'client_id', 'starts_at'),
        Index('ix_appointments_status_start', 'status', 'starts_at'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('branches.id', ondelete='RESTRICT'), nullable=False,
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('clients.id', ondelete='RESTRICT'), nullable=False,
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('employees.id', ondelete='RESTRICT'), nullable=False,
    )

    starts_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    # Время, которое клиент видит как своё: без буферов компании.
    service_starts_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    service_ends_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)

    status: Mapped[str] = mapped_column(
        String(24), default=AppointmentStatus.CONFIRMED, nullable=False,
    )
    source: Mapped[str] = mapped_column(
        String(16), default=AppointmentSource.CLIENT_APP, nullable=False,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    # APT-004: снимок цены и длительности на момент записи. Позже услуга
    # подорожает — история от этого не поедет.
    price_minor: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), default='KZT', nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer(), nullable=False)
    title_snapshot: Mapped[str] = mapped_column(String(255), default='', nullable=False)

    client_comment: Mapped[str | None] = mapped_column(Text())
    internal_note: Mapped[str | None] = mapped_column(Text())

    payment_status: Mapped[str] = mapped_column(
        String(16), default=AppointmentPaymentStatus.NOT_REQUIRED, nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer(), default=1, nullable=False)

    # APT-002: повтор запроса с тем же ключом возвращает ту же запись.
    idempotency_key: Mapped[str | None] = mapped_column(String(128))

    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    cancelled_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    cancellation_reason: Mapped[str | None] = mapped_column(String(255))

    services: Mapped[list['AppointmentService']] = relationship(
        back_populates='appointment', cascade='all, delete-orphan', lazy='selectin',
    )

    @property
    def blocks_slot(self) -> bool:
        from app.domain import BLOCKING_APPOINTMENT_STATUSES
        return self.status in BLOCKING_APPOINTMENT_STATUSES


class AppointmentService(Base):
    """APT-005: одна запись может содержать несколько услуг, каждая со снимком."""
    __tablename__ = 'appointment_services'
    __table_args__ = (
        UniqueConstraint('appointment_id', 'service_id', 'sort_order', name='uq_appointment_services_appointment_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('appointments.id', ondelete='CASCADE'), nullable=False,
    )
    service_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('services.id', ondelete='RESTRICT'), nullable=False,
    )

    name_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    price_minor: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), default='KZT', nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer(), nullable=False)
    buffer_before_minutes: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    buffer_after_minutes: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)

    appointment: Mapped[Appointment] = relationship(back_populates='services')


class AppointmentEvent(Base):
    """APT-006: append-only история. Ничего не переписываем, только добавляем."""
    __tablename__ = 'appointment_events'
    __table_args__ = (
        Index('ix_appointment_events_appointment', 'appointment_id', 'created_at'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('appointments.id', ondelete='CASCADE'), nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    actor_role: Mapped[str | None] = mapped_column(String(24))
    before: Mapped[dict | None] = mapped_column(JSONBType())
    after: Mapped[dict | None] = mapped_column(JSONBType())
    correlation_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class Review(UUIDPrimaryKey, Base):
    """REV-001/002: один отзыв на завершённую запись, повтор идемпотентен."""
    __tablename__ = 'reviews'
    __table_args__ = (
        CheckConstraint('rating >= 1 AND rating <= 5', name='rating_range'),
        Index('ix_reviews_company_status', 'company_id', 'status'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('appointments.id', ondelete='CASCADE'), unique=True, nullable=False,
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('clients.id', ondelete='CASCADE'), nullable=False,
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    rating: Mapped[int] = mapped_column(Integer(), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text())
    status: Mapped[str] = mapped_column(String(24), default=ReviewStatus.PUBLISHED, nullable=False)

    reply_body: Mapped[str | None] = mapped_column(Text())
    reply_author_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    reply_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
