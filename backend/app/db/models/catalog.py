"""Услуги, категории и сотрудники (ТЗ 11.2)."""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey
from app.db.types import GUID


class ServiceCategory(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'service_categories'

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    color: Mapped[str | None] = mapped_column(String(9))
    sort_order: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)


class Service(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'services'
    __table_args__ = (
        # SVC-002/SVC-003: цену и длительность проверяет БД, а не только форма.
        CheckConstraint('price_minor >= 0', name='price_non_negative'),
        CheckConstraint('duration_minutes > 0', name='duration_positive'),
        CheckConstraint('buffer_before_minutes >= 0', name='buffer_before_non_negative'),
        CheckConstraint('buffer_after_minutes >= 0', name='buffer_after_non_negative'),
        Index('ix_services_company_active', 'company_id', 'active'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('branches.id', ondelete='SET NULL'),
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('service_categories.id', ondelete='SET NULL'),
    )

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text())

    # FIN-003: деньги — целое в минимальных единицах. Никаких float.
    price_minor: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), default='KZT', nullable=False)

    duration_minutes: Mapped[int] = mapped_column(Integer(), nullable=False)
    buffer_before_minutes: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    buffer_after_minutes: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)

    active: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)
    public: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    color: Mapped[str | None] = mapped_column(String(9))
    media_asset_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    @property
    def occupied_minutes(self) -> int:
        """Сколько времени услуга реально держит в календаре — с буферами."""
        return self.buffer_before_minutes + self.duration_minutes + self.buffer_after_minutes


class Employee(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'employees'
    __table_args__ = (
        Index('ix_employees_company_active', 'company_id', 'active'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    # Сотрудник может существовать до того, как примет приглашение: карточка в
    # расписании нужна раньше, чем у человека появится доступ.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('users.id', ondelete='SET NULL'),
    )

    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    role_title: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(32))
    bio: Mapped[str | None] = mapped_column(Text())

    takes_appointments: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)
    public: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)

    rating_sum: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    rating_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    media_asset_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    @property
    def rating(self) -> float | None:
        if not self.rating_count:
            return None
        return round(self.rating_sum / self.rating_count, 2)


class EmployeeBranch(Base):
    __tablename__ = 'employee_branches'
    __table_args__ = (
        UniqueConstraint('employee_id', 'branch_id', name='uq_employee_branches_employee_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('employees.id', ondelete='CASCADE'), nullable=False,
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('branches.id', ondelete='CASCADE'), nullable=False,
    )


class EmployeeService(Base):
    """
    SVC-004: связь всегда явная. Пустой список услуг у мастера означает
    «не оказывает ничего», а не «оказывает всё».
    """
    __tablename__ = 'employee_services'
    __table_args__ = (
        UniqueConstraint('employee_id', 'service_id', name='uq_employee_services_employee_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('employees.id', ondelete='CASCADE'), nullable=False,
    )
    service_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('services.id', ondelete='CASCADE'), nullable=False,
    )
    # SVC-006: цена и длительность могут отличаться у конкретного мастера.
    price_minor_override: Mapped[int | None] = mapped_column(Integer())
    duration_minutes_override: Mapped[int | None] = mapped_column(Integer())
