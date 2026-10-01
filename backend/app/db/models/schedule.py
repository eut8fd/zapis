"""Графики, перерывы и исключения (ТЗ 11.2, 8.5)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Index, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey
from app.db.types import GUID, UTCDateTime


class WeeklyScheduleRule(UUIDPrimaryKey, Timestamps, Base):
    """
    Недельный график. employee_id = NULL — это часы самого филиала;
    заполненный employee_id — часы мастера. Итоговое окно работы всегда
    пересечение обоих (грабли из CLAUDE.md: часы мастера сами по себе
    ничего не значат).
    """
    __tablename__ = 'weekly_schedule_rules'
    __table_args__ = (
        CheckConstraint('weekday >= 0 AND weekday <= 6', name='weekday_range'),
        Index('ix_weekly_rules_scope', 'company_id', 'branch_id', 'employee_id', 'weekday'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('branches.id', ondelete='CASCADE'), nullable=False,
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('employees.id', ondelete='CASCADE'),
    )

    weekday: Mapped[int] = mapped_column(Integer(), nullable=False)  # 0 = понедельник
    start_local_time: Mapped[time] = mapped_column(Time(), nullable=False)
    end_local_time: Mapped[time] = mapped_column(Time(), nullable=False)

    valid_from: Mapped[date | None] = mapped_column(Date())
    valid_to: Mapped[date | None] = mapped_column(Date())
    active: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)


class ScheduleBreak(UUIDPrimaryKey, Base):
    """SCH-002: перерывов в дне может быть несколько."""
    __tablename__ = 'schedule_breaks'
    __table_args__ = (
        Index('ix_schedule_breaks_rule', 'rule_id'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    rule_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('weekly_schedule_rules.id', ondelete='CASCADE'), nullable=False,
    )
    start_local_time: Mapped[time] = mapped_column(Time(), nullable=False)
    end_local_time: Mapped[time] = mapped_column(Time(), nullable=False)
    title: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class ScheduleException(UUIDPrimaryKey, Base):
    """
    Разовые изменения: блокировка, отпуск, больничный, дополнительное окно.
    Хранится в UTC — интервал может пересекать границу суток и DST.
    """
    __tablename__ = 'schedule_exceptions'
    __table_args__ = (
        CheckConstraint('starts_at < ends_at', name='interval_ordered'),
        Index('ix_schedule_exceptions_lookup', 'company_id', 'employee_id', 'starts_at', 'ends_at'),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('companies.id', ondelete='CASCADE'), nullable=False,
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('branches.id', ondelete='CASCADE'),
    )
    # NULL — исключение на весь филиал (санитарный день, праздник).
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey('employees.id', ondelete='CASCADE'),
    )

    starts_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(255))

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
