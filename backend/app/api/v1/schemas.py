"""
Схемы запросов и ответов (ТЗ 12.1, 24.2).

Правила, которые здесь соблюдаются буквально:
- деньги — целое в минимальных единицах плюс код валюты;
- даты — ISO 8601 с зоной;
- наружу не уходят внутренние поля ORM;
- ни одна схема запроса не содержит роль, company_id как доказательство
  доступа или вычисленный клиентом флаг «свободно».
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain import CompanyRole, ScheduleExceptionType


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra='forbid', str_strip_whitespace=True)


class Money(Schema):
    amount_minor: int = Field(ge=0)
    currency_code: str = Field(min_length=3, max_length=3)


# --------------------------------------------------------------------- auth

class TelegramExchangeIn(Schema):
    init_data: str = Field(min_length=1, max_length=8192)
    client: Literal['miniapp', 'bot', 'web'] = 'miniapp'


class TokenPair(Schema):
    access_token: str
    refresh_token: str
    token_type: Literal['Bearer'] = 'Bearer'
    expires_in: int


class RefreshIn(Schema):
    refresh_token: str = Field(min_length=8, max_length=512)


class MembershipOut(Schema):
    company_id: uuid.UUID
    company_name: str
    company_slug: str
    company_status: str
    role: str
    employee_id: uuid.UUID | None
    permissions: list[str]


class MeOut(Schema):
    user_id: uuid.UUID
    telegram_user_id: int
    display_name: str
    username: str | None
    language_code: str
    phone: str | None
    platform_role: str
    memberships: list[MembershipOut]


class ProfileIn(Schema):
    first_name: str | None = Field(default=None, max_length=128)
    last_name: str | None = Field(default=None, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    language_code: str | None = Field(default=None, max_length=8)


# ------------------------------------------------------------------ каталог

class BranchPublicOut(Schema):
    id: uuid.UUID
    name: str
    address: str | None
    city: str | None
    phone: str | None
    latitude: float | None
    longitude: float | None
    timezone: str


class CompanyCardOut(Schema):
    id: uuid.UUID
    slug: str
    name: str
    category: str
    description: str | None
    currency_code: str
    city: str | None = None
    address: str | None = None
    rating: float | None = None
    reviews_count: int = 0
    min_price_minor: int | None = None
    next_available_at: datetime | None = None
    distance_km: float | None = None


class CompanyPublicOut(CompanyCardOut):
    branches: list[BranchPublicOut] = []
    phone: str | None = None


class ServicePublicOut(Schema):
    id: uuid.UUID
    name: str
    description: str | None
    category_id: uuid.UUID | None
    price_minor: int
    currency_code: str
    duration_minutes: int


class StaffPublicOut(Schema):
    id: uuid.UUID
    display_name: str
    role_title: str | None
    rating: float | None
    service_ids: list[uuid.UUID] = []


class SlotOut(Schema):
    employee_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    local_date: str
    local_time: str
    duration_minutes: int
    price_minor: int
    currency_code: str
    token: str


class DaySlotsOut(Schema):
    date: str
    slots: list[SlotOut]


class AvailabilityOut(Schema):
    branch_id: uuid.UUID
    timezone: str
    duration_minutes: int
    price_minor: int
    currency_code: str
    days: list[DaySlotsOut]


# ------------------------------------------------------------------ компания

class CompanyCreateIn(Schema):
    name: str = Field(min_length=2, max_length=160)
    category: str = Field(min_length=2, max_length=40)
    city: str = Field(min_length=2, max_length=80)
    timezone: str = Field(default='Asia/Almaty', max_length=64)
    currency_code: str = Field(default='KZT', min_length=3, max_length=3)
    default_locale: Literal['ru', 'kk', 'en'] = 'ru'
    phone: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=255)
    # ТЗ 7.3 шаг 3: принятие обязательных документов — часть регистрации.
    accepted_terms_version: str = Field(min_length=1, max_length=32)
    accepted_privacy_version: str = Field(min_length=1, max_length=32)


class CompanyUpdateIn(Schema):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    category: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=2000)
    default_locale: Literal['ru', 'kk', 'en'] | None = None
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    settings: dict[str, Any] | None = None


class CompanyOut(Schema):
    id: uuid.UUID
    slug: str
    name: str
    category: str
    description: str | None
    status: str
    default_locale: str
    currency_code: str
    published_at: datetime | None
    settings: dict[str, Any]


class PublishCheckOut(Schema):
    ready: bool
    missing: list[str]


class BranchIn(Schema):
    name: str = Field(min_length=2, max_length=160)
    address: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=80)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=160)
    timezone: str = Field(default='Asia/Almaty', max_length=64)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class BranchOut(BranchPublicOut):
    status: str
    email: str | None
    sort_order: int


# ------------------------------------------------------------------- услуги

class ServiceIn(Schema):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    category_id: uuid.UUID | None = None
    branch_id: uuid.UUID | None = None
    price_minor: int = Field(ge=0, le=10**12)
    duration_minutes: int = Field(ge=5, le=8 * 60)
    buffer_before_minutes: int = Field(default=0, ge=0, le=240)
    buffer_after_minutes: int = Field(default=0, ge=0, le=240)
    employee_ids: list[uuid.UUID] = Field(default_factory=list)
    color: str | None = Field(default=None, max_length=9)
    public: bool = True


class ServiceUpdateIn(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    category_id: uuid.UUID | None = None
    price_minor: int | None = Field(default=None, ge=0, le=10**12)
    duration_minutes: int | None = Field(default=None, ge=5, le=8 * 60)
    buffer_before_minutes: int | None = Field(default=None, ge=0, le=240)
    buffer_after_minutes: int | None = Field(default=None, ge=0, le=240)
    employee_ids: list[uuid.UUID] | None = None
    color: str | None = Field(default=None, max_length=9)
    active: bool | None = None
    public: bool | None = None


class ServiceOut(ServicePublicOut):
    buffer_before_minutes: int
    buffer_after_minutes: int
    active: bool
    public: bool
    color: str | None
    employee_ids: list[uuid.UUID] = []


class ServiceCategoryIn(Schema):
    name: str = Field(min_length=1, max_length=120)
    color: str | None = Field(default=None, max_length=9)
    sort_order: int = 0


class ServiceCategoryOut(Schema):
    id: uuid.UUID
    name: str
    color: str | None
    sort_order: int
    active: bool


# ------------------------------------------------------------------ команда

class EmployeeIn(Schema):
    display_name: str = Field(min_length=1, max_length=160)
    role_title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    bio: str | None = Field(default=None, max_length=2000)
    takes_appointments: bool = True
    branch_ids: list[uuid.UUID] = Field(default_factory=list)
    service_ids: list[uuid.UUID] = Field(default_factory=list)


class EmployeeUpdateIn(Schema):
    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    role_title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    bio: str | None = Field(default=None, max_length=2000)
    takes_appointments: bool | None = None
    active: bool | None = None
    public: bool | None = None
    branch_ids: list[uuid.UUID] | None = None
    service_ids: list[uuid.UUID] | None = None


class EmployeeOut(Schema):
    id: uuid.UUID
    user_id: uuid.UUID | None
    display_name: str
    role_title: str | None
    phone: str | None
    bio: str | None
    takes_appointments: bool
    active: bool
    public: bool
    rating: float | None
    branch_ids: list[uuid.UUID] = []
    service_ids: list[uuid.UUID] = []
    role: str | None = None
    has_access: bool = False


class TerminateIn(Schema):
    reason: str = Field(min_length=3, max_length=255)
    # TEAM-006: что делать с будущими записями — решение обязательное.
    future_appointments: Literal['reassign', 'cancel', 'keep']
    reassign_to_employee_id: uuid.UUID | None = None


class TerminateOut(Schema):
    employee_id: uuid.UUID
    future_appointments_affected: int
    action: str


# ----------------------------------------------------------- приглашения

class InviteIn(Schema):
    role: Literal[CompanyRole.MANAGER, CompanyRole.MASTER]
    employee_id: uuid.UUID | None = None
    branch_id: uuid.UUID | None = None
    permissions: list[str] = Field(default_factory=list)
    expires_in_hours: int = Field(default=72, ge=1, le=720)


class InviteOut(Schema):
    id: uuid.UUID
    role: str
    status: str
    expires_at: datetime
    employee_id: uuid.UUID | None
    created_at: datetime


class InviteCreatedOut(InviteOut):
    # TEAM-001: сам токен возвращается ровно один раз, в этом ответе.
    token: str
    link: str


class InvitePreviewOut(Schema):
    company_name: str
    role: str
    expires_at: datetime
    valid: bool


class InviteAcceptOut(Schema):
    company_id: uuid.UUID
    company_name: str
    role: str
    employee_id: uuid.UUID | None


# -------------------------------------------------------------- расписание

class BreakIn(Schema):
    start: str = Field(pattern=r'^\d{2}:\d{2}$')
    end: str = Field(pattern=r'^\d{2}:\d{2}$')
    title: str | None = Field(default=None, max_length=120)


class ScheduleRuleIn(Schema):
    weekday: int = Field(ge=0, le=6)
    start: str = Field(pattern=r'^\d{2}:\d{2}$')
    end: str = Field(pattern=r'^\d{2}:\d{2}$')
    breaks: list[BreakIn] = Field(default_factory=list)


class ScheduleRulesIn(Schema):
    branch_id: uuid.UUID
    employee_id: uuid.UUID | None = None
    rules: list[ScheduleRuleIn]

    @field_validator('rules')
    @classmethod
    def _no_overlaps(cls, rules: list[ScheduleRuleIn]) -> list[ScheduleRuleIn]:
        # SCH-004: пересечения в пределах одного дня недели недопустимы.
        by_day: dict[int, list[tuple[str, str]]] = {}
        for rule in rules:
            if rule.start >= rule.end:
                raise ValueError('начало смены должно быть раньше конца')
            by_day.setdefault(rule.weekday, []).append((rule.start, rule.end))
        for day, spans in by_day.items():
            spans.sort()
            for prev, nxt in zip(spans, spans[1:]):
                if nxt[0] < prev[1]:
                    raise ValueError(f'смены пересекаются в дне {day}')
        return rules


class ScheduleRuleOut(Schema):
    id: uuid.UUID
    branch_id: uuid.UUID
    employee_id: uuid.UUID | None
    weekday: int
    start: str
    end: str
    breaks: list[BreakIn] = []


class ExceptionIn(Schema):
    employee_id: uuid.UUID | None = None
    branch_id: uuid.UUID | None = None
    starts_at: datetime
    ends_at: datetime
    kind: ScheduleExceptionType
    reason: str | None = Field(default=None, max_length=255)


class ExceptionOut(Schema):
    id: uuid.UUID
    employee_id: uuid.UUID | None
    branch_id: uuid.UUID | None
    starts_at: datetime
    ends_at: datetime
    kind: str
    reason: str | None
    created_at: datetime


# ------------------------------------------------------------------- записи

class AppointmentCreateIn(Schema):
    branch_id: uuid.UUID
    employee_id: uuid.UUID
    service_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)
    starts_at: datetime
    client_comment: str | None = Field(default=None, max_length=1000)
    availability_token: str | None = Field(default=None, max_length=64)

    @field_validator('starts_at')
    @classmethod
    def _aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError('время должно содержать часовой пояс')
        return value


class StaffAppointmentCreateIn(AppointmentCreateIn):
    client_id: uuid.UUID | None = None
    new_client_name: str | None = Field(default=None, max_length=160)
    new_client_phone: str | None = Field(default=None, max_length=32)
    internal_note: str | None = Field(default=None, max_length=1000)


class RescheduleIn(Schema):
    starts_at: datetime
    employee_id: uuid.UUID | None = None
    reason: str | None = Field(default=None, max_length=255)

    @field_validator('starts_at')
    @classmethod
    def _aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError('время должно содержать часовой пояс')
        return value


class CancelIn(Schema):
    reason: str | None = Field(default=None, max_length=255)


class AppointmentServiceOut(Schema):
    service_id: uuid.UUID
    name: str
    price_minor: int
    duration_minutes: int


class AppointmentOut(Schema):
    id: uuid.UUID
    company_id: uuid.UUID
    branch_id: uuid.UUID
    client_id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str | None = None
    company_name: str | None = None
    starts_at: datetime
    ends_at: datetime
    local_date: str | None = None
    local_time: str | None = None
    timezone: str | None = None
    status: str
    source: str
    payment_status: str
    price_minor: int
    currency_code: str
    duration_minutes: int
    title: str
    client_comment: str | None = None
    internal_note: str | None = None
    version: int
    can_cancel: bool = False
    can_reschedule: bool = False
    services: list[AppointmentServiceOut] = []


class AppointmentEventOut(Schema):
    event_type: str
    actor_role: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    created_at: datetime


# ------------------------------------------------------------------- клиенты

class ClientIn(Schema):
    display_name: str = Field(min_length=1, max_length=160)
    phone: str | None = Field(default=None, max_length=32)
    telegram_username: str | None = Field(default=None, max_length=64)
    source: str | None = Field(default=None, max_length=32)


class ClientOut(Schema):
    id: uuid.UUID
    display_name: str
    phone: str | None = None
    telegram_username: str | None = None
    status: str
    consent_status: str
    source: str | None
    created_at: datetime
    visits_count: int = 0
    last_visit_at: datetime | None = None


# --------------------------------------------------------------------- общее

class Page(Schema):
    """Cursor-based pagination (ТЗ 12.1). offset наружу не выставляем."""
    items: list[Any]
    next_cursor: str | None = None
    has_more: bool = False


class OkOut(Schema):
    ok: bool = True


class HealthOut(Schema):
    status: str
    release: str
    env: str
    checks: dict[str, str] = {}


class ReviewIn(Schema):
    appointment_id: uuid.UUID
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


class ReviewOut(Schema):
    id: uuid.UUID
    appointment_id: uuid.UUID
    rating: int
    comment: str | None
    status: str
    reply_body: str | None
    created_at: datetime
    client_name: str | None = None


class CatalogQuery(Schema):
    q: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=40)
    city: str | None = Field(default=None, max_length=80)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    limit: int = Field(default=20, ge=1, le=50)
    cursor: str | None = None


class AvailabilityQuery(Schema):
    branch_id: uuid.UUID | None = None
    employee_id: uuid.UUID | None = None
    service_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)
    date_from: date
    date_to: date | None = None
