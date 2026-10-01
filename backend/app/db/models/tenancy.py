"""Компании, филиалы, членство и приглашения (ТЗ 11.1, 11.4)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey
from app.db.types import GUID, JSONBType, UTCDateTime
from app.domain import BranchStatus, CompanyStatus, InviteStatus, MembershipStatus


class Company(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'companies'

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str | None] = mapped_column(Text())

    status: Mapped[str] = mapped_column(String(16), default=CompanyStatus.DRAFT, nullable=False, index=True)
    default_locale: Mapped[str] = mapped_column(String(8), default='ru', nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), default='KZT', nullable=False)

    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False,
    )
    logo_media_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    # Политики компании: дедлайн отмены, предоплата, окно записи. Хранятся
    # типизированным JSON — их состав ещё меняется, а миграцию на каждую
    # настройку заводить дорого.
    settings: Mapped[dict] = mapped_column(JSONBType(), default=dict, nullable=False)

    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    suspended_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    suspended_reason: Mapped[str | None] = mapped_column(String(255))
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    branches: Mapped[list['Branch']] = relationship(back_populates='company')
    memberships: Mapped[list['Membership']] = relationship(back_populates='company')

    @property
    def is_published(self) -> bool:
        return self.status == CompanyStatus.PUBLISHED and self.deleted_at is None

    def setting(self, key: str, default=None):
        return (self.settings or {}).get(key, default)


class Branch(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'branches'
    __table_args__ = (
        UniqueConstraint('company_id', 'slug', name='uq_branches_company_slug'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(80), index=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(160))

    latitude: Mapped[float | None] = mapped_column()
    longitude: Mapped[float | None] = mapped_column()
    # SCH-005: расписание считается в зоне филиала, а не устройства или сервера.
    timezone: Mapped[str] = mapped_column(String(64), default='Asia/Almaty', nullable=False)

    status: Mapped[str] = mapped_column(String(16), default=BranchStatus.ACTIVE, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    sort_order: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)

    company: Mapped[Company] = relationship(back_populates='branches')


class Membership(UUIDPrimaryKey, Base):
    """
    Связь пользователя с компанией. Именно она — источник прав (AUTH-005),
    а не поле роли, присланное фронтом.
    """
    __tablename__ = 'memberships'
    __table_args__ = (
        Index('ix_memberships_company_status', 'company_id', 'status'),
        Index('ix_memberships_user_status', 'user_id', 'status'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('users.id', ondelete='CASCADE'), nullable=False,
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    role: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=MembershipStatus.ACTIVE, nullable=False)
    permissions: Mapped[list] = mapped_column(JSONBType(), default=list, nullable=False)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    terminated_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    terminated_reason: Mapped[str | None] = mapped_column(String(255))

    company: Mapped[Company] = relationship(back_populates='memberships')

    @property
    def is_active(self) -> bool:
        return self.status == MembershipStatus.ACTIVE and self.terminated_at is None


class TeamInvite(UUIDPrimaryKey, Base):
    """
    TEAM-001: в БД лежит только hash одноразового токена. Сам токен виден
    ровно один раз — в ответе на создание приглашения.
    """
    __tablename__ = 'team_invites'
    __table_args__ = (
        Index('ix_team_invites_company_status', 'company_id', 'status'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('branches.id', ondelete='SET NULL'),
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    permissions: Mapped[list] = mapped_column(JSONBType(), default=list, nullable=False)

    status: Mapped[str] = mapped_column(String(16), default=InviteStatus.PENDING, nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    used_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
