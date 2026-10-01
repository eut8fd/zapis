"""Тарифы, подписки и платежи (ТЗ 11.5, 14)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey
from app.db.types import GUID, JSONBType, UTCDateTime
from app.domain import (
    PaymentOrderStatus, PaymentOrderType, PaymentTransactionStatus, RefundStatus,
    SubscriptionStatus,
)


class Plan(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'plans'

    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text())
    price_minor: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), default='KZT', nullable=False)
    billing_period: Mapped[str] = mapped_column(String(16), default='month', nullable=False)
    trial_days: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)


class PlanEntitlement(Base):
    """
    Лимит или фича тарифа. Типизировано, а не «текстом в описании» (ТЗ 11.5):
    entitlement service читает именно отсюда и проверяет в транзакции.
    """
    __tablename__ = 'plan_entitlements'
    __table_args__ = (
        UniqueConstraint('plan_id', 'key', name='uq_plan_entitlements_plan_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('plans.id', ondelete='CASCADE'), nullable=False,
    )
    key: Mapped[str] = mapped_column(String(48), nullable=False)
    # NULL в limit_value означает «без ограничения», а не ноль.
    limit_value: Mapped[int | None] = mapped_column(Integer())
    enabled: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)


class Subscription(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'subscriptions'

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), unique=True, nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('plans.id', ondelete='RESTRICT'), nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(16), default=SubscriptionStatus.TRIALING, nullable=False, index=True,
    )

    current_period_start: Mapped[datetime | None] = mapped_column(UTCDateTime())
    current_period_end: Mapped[datetime | None] = mapped_column(UTCDateTime())
    grace_until: Mapped[datetime | None] = mapped_column(UTCDateTime())
    auto_renew: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    provider: Mapped[str | None] = mapped_column(String(32))
    provider_customer_ref: Mapped[str | None] = mapped_column(String(128))
    provider_subscription_ref: Mapped[str | None] = mapped_column(String(128))


class PaymentOrder(UUIDPrimaryKey, Timestamps, Base):
    """
    Заказ на оплату. Сумму считает backend (ТЗ 14.2) — фронт не может
    прислать произвольный итог.
    """
    __tablename__ = 'payment_orders'
    __table_args__ = (
        CheckConstraint('amount_minor >= 0', name='amount_non_negative'),
        UniqueConstraint('idempotency_key', name='uq_payment_orders_idempotency_key'),
        Index('ix_payment_orders_company_status', 'company_id', 'status'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('appointments.id', ondelete='SET NULL'),
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('subscriptions.id', ondelete='SET NULL'),
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    type: Mapped[str] = mapped_column(String(24), default=PaymentOrderType.CLIENT_SERVICE, nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer(), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default=PaymentOrderStatus.CREATED, nullable=False)

    provider: Mapped[str | None] = mapped_column(String(32))
    provider_order_ref: Mapped[str | None] = mapped_column(String(128))
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)

    description: Mapped[str | None] = mapped_column(String(255))
    refunded_minor: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)

    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    paid_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    failed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class PaymentTransaction(UUIDPrimaryKey, Base):
    __tablename__ = 'payment_transactions'
    __table_args__ = (
        UniqueConstraint('provider', 'provider_transaction_ref', name='uq_payment_transactions_provider'),
    )

    order_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('payment_orders.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(8), default='in', nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer(), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default=PaymentTransactionStatus.PENDING, nullable=False,
    )

    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_transaction_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    # Сырой payload не храним в открытом виде — только ссылку на защищённое
    # хранилище (ТЗ 14.3, 17.6).
    raw_payload_ref: Mapped[str | None] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    failed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    failure_code: Mapped[str | None] = mapped_column(String(64))


class ProviderEvent(UUIDPrimaryKey, Base):
    """Webhook провайдера. Повторная доставка того же события безопасна."""
    __tablename__ = 'provider_events'
    __table_args__ = (
        UniqueConstraint('provider', 'provider_event_id', name='uq_provider_events_provider'),
    )

    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    event_type: Mapped[str | None] = mapped_column(String(64))
    signature_valid: Mapped[bool] = mapped_column(Boolean(), default=False, nullable=False)
    payload_ref: Mapped[str | None] = mapped_column(String(255))
    payload_digest: Mapped[str | None] = mapped_column(String(64))

    received_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    processing_error: Mapped[str | None] = mapped_column(Text())
    retry_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)


class Refund(UUIDPrimaryKey, Base):
    __tablename__ = 'refunds'
    __table_args__ = (
        CheckConstraint('amount_minor > 0', name='amount_positive'),
        UniqueConstraint('provider', 'provider_refund_ref', name='uq_refunds_provider'),
    )

    order_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('payment_orders.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('payment_transactions.id', ondelete='SET NULL'),
    )
    company_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)

    amount_minor: Mapped[int] = mapped_column(Integer(), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=RefundStatus.REQUESTED, nullable=False)

    provider: Mapped[str | None] = mapped_column(String(32))
    provider_refund_ref: Mapped[str | None] = mapped_column(String(128))
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)

    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class FinanceTransaction(UUIDPrimaryKey, Base):
    """
    FIN-001/002: фактическая операция компании. От статуса записи отделена
    намеренно — завершённый визит и полученные деньги это разные факты.
    """
    __tablename__ = 'finance_transactions'
    __table_args__ = (
        Index('ix_finance_company_date', 'company_id', 'occurred_at'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('appointments.id', ondelete='SET NULL'),
    )
    payment_order_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('payment_orders.id', ondelete='SET NULL'),
    )

    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer(), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    note: Mapped[str | None] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(24), default='manual', nullable=False)

    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    # FIN-005: не удаляем, а сторнируем — ссылкой на отменяющую операцию.
    reversed_by_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    reverses_id: Mapped[uuid.UUID | None] = mapped_column(GUID())


class EntitlementUsage(Base):
    """
    Счётчики использования лимитов с окном. Нужны там, где считать по факту
    дорого: AI-запросы и рассылки за период.
    """
    __tablename__ = 'entitlement_usage'
    __table_args__ = (
        UniqueConstraint('company_id', 'key', 'period_start', name='uq_entitlement_usage_company_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    key: Mapped[str] = mapped_column(String(48), nullable=False)
    period_start: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    period_end: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    used: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    meta: Mapped[dict | None] = mapped_column(JSONBType())
