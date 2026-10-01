"""
Серверный slot engine (ТЗ 13).

SCH-007: движок один — для бота, Mini App, API и ручных операций сотрудника.
Фронт не присылает готовый флаг «свободно»: он спрашивает слоты и потом
запрашивает запись, а занятость всё равно перепроверяется в транзакции.

Как считается доступность одного мастера на день:

    часы филиала  ∩  часы мастера        рабочее окно
      ∪ разовые открытия (custom_open)
      − перерывы графика
      − отсутствия, отпуска, блокировки
      − уже занятые интервалы записей     свободные окна

Занятый интервал записи включает буферы услуги: именно он и проверяется
на пересечение, поэтому уборка после клиента не превращается в двойную
запись.
"""
from __future__ import annotations

import hashlib
import hmac
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound, ValidationFailed
from app.db.models import (
    Appointment, Branch, Company, Employee, EmployeeService, ScheduleBreak,
    ScheduleException, Service, WeeklyScheduleRule,
)
from app.db.types import utcnow
from app.domain import BLOCKING_APPOINTMENT_STATUSES, ScheduleExceptionType
from app.services.timeutils import (
    Interval, end_of_local_day, intersect, local, local_datetime, local_days, merge,
    start_of_local_day, subtract,
)

#: Исключения, которые убирают время из графика. custom_open, наоборот, добавляет.
BLOCKING_EXCEPTION_KINDS = frozenset({
    ScheduleExceptionType.BLOCKED, ScheduleExceptionType.BREAK,
    ScheduleExceptionType.VACATION, ScheduleExceptionType.SICK,
})


@dataclass(frozen=True)
class ServiceSpec:
    """Услуга в составе записи с учётом персональных цен мастера (SVC-006)."""
    service_id: uuid.UUID
    name: str
    price_minor: int
    currency_code: str
    duration_minutes: int
    buffer_before_minutes: int
    buffer_after_minutes: int
    sort_order: int = 0


@dataclass(frozen=True)
class BookingShape:
    """
    Итоговая «форма» записи: сколько идёт услуга и сколько времени она
    занимает в календаре вместе с буферами.
    """
    services: tuple[ServiceSpec, ...]

    @property
    def duration_minutes(self) -> int:
        return sum(s.duration_minutes for s in self.services)

    @property
    def buffer_before(self) -> int:
        return self.services[0].buffer_before_minutes if self.services else 0

    @property
    def buffer_after(self) -> int:
        return self.services[-1].buffer_after_minutes if self.services else 0

    @property
    def occupied_minutes(self) -> int:
        return self.buffer_before + self.duration_minutes + self.buffer_after

    @property
    def price_minor(self) -> int:
        return sum(s.price_minor for s in self.services)

    @property
    def title(self) -> str:
        return ' + '.join(s.name for s in self.services)

    def occupied_for(self, service_start: datetime) -> Interval:
        return Interval(
            service_start - timedelta(minutes=self.buffer_before),
            service_start + timedelta(minutes=self.duration_minutes + self.buffer_after),
        )


@dataclass(frozen=True)
class Slot:
    employee_id: uuid.UUID
    starts_at: datetime          # начало услуги, UTC
    ends_at: datetime            # конец услуги, UTC
    occupied_start: datetime     # с буферами — то, что реально занимается
    occupied_end: datetime
    local_date: str
    local_time: str
    duration_minutes: int
    price_minor: int
    currency_code: str
    token: str


@dataclass
class ScheduleContext:
    """Всё, что нужно движку, загруженное одним заходом в БД."""
    company: Company
    branch: Branch
    employees: dict[uuid.UUID, Employee]
    branch_rules: list[WeeklyScheduleRule] = field(default_factory=list)
    employee_rules: dict[uuid.UUID, list[WeeklyScheduleRule]] = field(default_factory=dict)
    breaks: dict[uuid.UUID, list[ScheduleBreak]] = field(default_factory=dict)
    exceptions: list[ScheduleException] = field(default_factory=list)
    busy: dict[uuid.UUID, list[Interval]] = field(default_factory=dict)

    @property
    def timezone(self) -> str:
        return self.branch.timezone


# --------------------------------------------------------------------- загрузка

async def resolve_services(
    session: AsyncSession,
    company_id: uuid.UUID,
    service_ids: list[uuid.UUID],
    employee_id: uuid.UUID | None = None,
) -> BookingShape:
    """
    Собирает снимок услуг. Цена и длительность берутся с сервера — фронт
    прислать их не может (ТЗ 14.2 по деньгам, APT-004 по снимку).
    """
    if not service_ids:
        raise ValidationFailed('Выберите услугу', fields={'service_ids': 'обязательное поле'})

    rows = (await session.execute(
        select(Service).where(Service.id.in_(service_ids), Service.company_id == company_id)
    )).scalars().all()
    found = {s.id: s for s in rows}

    missing = [str(sid) for sid in service_ids if sid not in found]
    if missing:
        raise NotFound('Услуга', details={'service_ids': missing})

    overrides: dict[uuid.UUID, EmployeeService] = {}
    if employee_id is not None:
        links = (await session.execute(
            select(EmployeeService).where(
                EmployeeService.employee_id == employee_id,
                EmployeeService.service_id.in_(service_ids),
            )
        )).scalars().all()
        overrides = {link.service_id: link for link in links}

    specs: list[ServiceSpec] = []
    for order, sid in enumerate(service_ids):
        service = found[sid]
        if not service.active:
            raise ValidationFailed(
                f'Услуга «{service.name}» сейчас недоступна', fields={'service_ids': 'inactive'},
            )
        link = overrides.get(sid)
        specs.append(ServiceSpec(
            service_id=service.id,
            name=service.name,
            price_minor=link.price_minor_override if link and link.price_minor_override is not None
            else service.price_minor,
            currency_code=service.currency_code,
            duration_minutes=link.duration_minutes_override if link and link.duration_minutes_override
            else service.duration_minutes,
            buffer_before_minutes=service.buffer_before_minutes,
            buffer_after_minutes=service.buffer_after_minutes,
            sort_order=order,
        ))
    return BookingShape(tuple(specs))


async def eligible_employees(
    session: AsyncSession,
    company_id: uuid.UUID,
    branch_id: uuid.UUID,
    service_ids: list[uuid.UUID],
) -> list[Employee]:
    """
    Кто может оказать весь набор услуг. SVC-004: связь явная — мастер без
    привязки к услуге в выдачу не попадает.
    """
    from app.db.models import EmployeeBranch

    stmt = (
        select(Employee)
        .join(EmployeeBranch, EmployeeBranch.employee_id == Employee.id)
        .where(
            Employee.company_id == company_id,
            Employee.active.is_(True),
            Employee.takes_appointments.is_(True),
            EmployeeBranch.branch_id == branch_id,
        )
        .order_by(Employee.sort_order, Employee.display_name)
    )
    candidates = list((await session.execute(stmt)).scalars().unique().all())
    if not candidates or not service_ids:
        return candidates

    links = (await session.execute(
        select(EmployeeService.employee_id, EmployeeService.service_id).where(
            EmployeeService.company_id == company_id,
            EmployeeService.employee_id.in_([e.id for e in candidates]),
            EmployeeService.service_id.in_(service_ids),
        )
    )).all()

    provided: dict[uuid.UUID, set[uuid.UUID]] = {}
    for employee_id, service_id in links:
        provided.setdefault(employee_id, set()).add(service_id)

    needed = set(service_ids)
    return [e for e in candidates if provided.get(e.id, set()) >= needed]


async def load_context(
    session: AsyncSession,
    company: Company,
    branch: Branch,
    employees: list[Employee],
    window_start: datetime,
    window_end: datetime,
    *,
    ignore_appointment_id: uuid.UUID | None = None,
) -> ScheduleContext:
    employee_ids = [e.id for e in employees]
    ctx = ScheduleContext(
        company=company, branch=branch, employees={e.id: e for e in employees},
    )

    rules = (await session.execute(
        select(WeeklyScheduleRule).where(
            WeeklyScheduleRule.company_id == company.id,
            WeeklyScheduleRule.branch_id == branch.id,
            WeeklyScheduleRule.active.is_(True),
        )
    )).scalars().all()
    for rule in rules:
        if rule.employee_id is None:
            ctx.branch_rules.append(rule)
        elif rule.employee_id in ctx.employees:
            ctx.employee_rules.setdefault(rule.employee_id, []).append(rule)

    if rules:
        breaks = (await session.execute(
            select(ScheduleBreak).where(ScheduleBreak.rule_id.in_([r.id for r in rules]))
        )).scalars().all()
        for item in breaks:
            ctx.breaks.setdefault(item.rule_id, []).append(item)

    ctx.exceptions = list((await session.execute(
        select(ScheduleException).where(
            ScheduleException.company_id == company.id,
            ScheduleException.starts_at < window_end,
            ScheduleException.ends_at > window_start,
            (ScheduleException.employee_id.is_(None))
            | (ScheduleException.employee_id.in_(employee_ids)),
            (ScheduleException.branch_id.is_(None)) | (ScheduleException.branch_id == branch.id),
        )
    )).scalars().all())

    busy_stmt = select(Appointment).where(
        Appointment.company_id == company.id,
        Appointment.employee_id.in_(employee_ids),
        Appointment.status.in_(list(BLOCKING_APPOINTMENT_STATUSES)),
        Appointment.starts_at < window_end,
        Appointment.ends_at > window_start,
    )
    # При переносе своя же запись не должна мешать выбрать новое время.
    if ignore_appointment_id is not None:
        busy_stmt = busy_stmt.where(Appointment.id != ignore_appointment_id)

    for appointment in (await session.execute(busy_stmt)).scalars().all():
        ctx.busy.setdefault(appointment.employee_id, []).append(
            Interval(appointment.starts_at, appointment.ends_at)
        )
    return ctx


# ----------------------------------------------------------------- вычисление

def _rule_applies(rule: WeeklyScheduleRule, day: date) -> bool:
    if rule.valid_from and day < rule.valid_from:
        return False
    if rule.valid_to and day > rule.valid_to:
        return False
    return True


def _rule_intervals(
    rules: list[WeeklyScheduleRule], day: date, tz_name: str,
) -> tuple[list[Interval], list[WeeklyScheduleRule]]:
    weekday = day.weekday()
    matched = [r for r in rules if r.weekday == weekday and _rule_applies(r, day)]
    intervals: list[Interval] = []
    for rule in matched:
        start = local_datetime(day, rule.start_local_time, tz_name)
        # Смена «22:00–02:00» переходит на следующие сутки.
        end_day = day + timedelta(days=1) if rule.end_local_time <= rule.start_local_time else day
        end = local_datetime(end_day, rule.end_local_time, tz_name)
        if start < end:
            intervals.append(Interval(start, end))
    return merge(intervals), matched


def working_windows(ctx: ScheduleContext, employee_id: uuid.UUID, day: date) -> list[Interval]:
    """
    Рабочее время мастера по графику: часы, перерывы и отсутствия, но без
    учёта уже созданных записей.

    Отдельно от `free_windows` это нужно, чтобы различать две разные
    причины отказа. «Мастер в это время не работает» — 422, а «время
    только что заняли» — 409 с альтернативами. Если считать одним
    методом, занятый слот выглядел бы как нерабочее время.
    """
    tz_name = ctx.timezone
    branch_windows, branch_matched = _rule_intervals(ctx.branch_rules, day, tz_name)
    if not branch_windows:
        return []

    employee_rules = ctx.employee_rules.get(employee_id, [])
    if employee_rules:
        employee_windows, employee_matched = _rule_intervals(employee_rules, day, tz_name)
        if not employee_windows:
            return []          # у мастера этот день выходной
        windows = intersect(branch_windows, employee_windows)
    else:
        # У мастера вообще нет своего графика — работает по часам филиала.
        # Это состояние сразу после добавления сотрудника, и оно ожидаемо.
        windows = branch_windows
        employee_matched = []

    day_start = start_of_local_day(day, tz_name)
    day_end = end_of_local_day(day, tz_name)

    extra_open = [
        Interval(e.starts_at, e.ends_at)
        for e in ctx.exceptions
        if e.kind == ScheduleExceptionType.CUSTOM_OPEN
        and e.employee_id in (None, employee_id)
        and e.starts_at < day_end and e.ends_at > day_start
    ]
    if extra_open:
        windows = merge(windows + extra_open)

    cuts: list[Interval] = []
    for rule in branch_matched + employee_matched:
        for item in ctx.breaks.get(rule.id, []):
            start = local_datetime(day, item.start_local_time, tz_name)
            end_day = day + timedelta(days=1) if item.end_local_time <= item.start_local_time else day
            end = local_datetime(end_day, item.end_local_time, tz_name)
            if start < end:
                cuts.append(Interval(start, end))

    for exception in ctx.exceptions:
        if exception.kind not in BLOCKING_EXCEPTION_KINDS:
            continue
        if exception.employee_id not in (None, employee_id):
            continue
        if exception.starts_at >= day_end or exception.ends_at <= day_start:
            continue
        cuts.append(Interval(exception.starts_at, exception.ends_at))

    return subtract(windows, cuts)


def free_windows(ctx: ScheduleContext, employee_id: uuid.UUID, day: date) -> list[Interval]:
    """Свободное время одного мастера: рабочее окно минус занятые записи."""
    windows = working_windows(ctx, employee_id, day)
    busy = ctx.busy.get(employee_id, [])
    return subtract(windows, busy) if busy else windows


def _candidate_starts(window: Interval, step_minutes: int, tz_name: str) -> list[datetime]:
    """
    Точки старта внутри окна: сетка от локальной полуночи плюс само начало
    окна. Сетка даёт привычные 10:00 и 10:30, а начало окна не теряет
    случайные «хвосты» после записи, закончившейся в 11:20.
    """
    starts = [window.start]
    local_start = local(window.start, tz_name)
    midnight = local_start.replace(hour=0, minute=0, second=0, microsecond=0)
    offset = int((local_start - midnight).total_seconds() // 60)
    first_mark = ((offset + step_minutes - 1) // step_minutes) * step_minutes

    mark = first_mark
    while True:
        moment = (midnight + timedelta(minutes=mark)).astimezone(window.start.tzinfo)
        if moment >= window.end:
            break
        if moment > window.start:
            starts.append(moment)
        mark += step_minutes
    return starts


def slots_for_day(
    ctx: ScheduleContext,
    employee_id: uuid.UUID,
    day: date,
    shape: BookingShape,
    *,
    step_minutes: int,
    not_before: datetime,
    not_after: datetime,
    secret: str,
) -> list[Slot]:
    tz_name = ctx.timezone
    out: list[Slot] = []
    occupied_len = timedelta(minutes=shape.occupied_minutes)
    before = timedelta(minutes=shape.buffer_before)

    for window in free_windows(ctx, employee_id, day):
        if window.minutes < shape.occupied_minutes:
            continue
        for occupied_start in _candidate_starts(window, step_minutes, tz_name):
            occupied_end = occupied_start + occupied_len
            if occupied_end > window.end:
                continue
            service_start = occupied_start + before
            if service_start < not_before or service_start > not_after:
                continue
            service_end = service_start + timedelta(minutes=shape.duration_minutes)
            local_start = local(service_start, tz_name)
            out.append(Slot(
                employee_id=employee_id,
                starts_at=service_start,
                ends_at=service_end,
                occupied_start=occupied_start,
                occupied_end=occupied_end,
                local_date=local_start.date().isoformat(),
                local_time=local_start.strftime('%H:%M'),
                duration_minutes=shape.duration_minutes,
                price_minor=shape.price_minor,
                currency_code=shape.services[0].currency_code if shape.services else 'KZT',
                token=availability_token(
                    secret, ctx.company.id, ctx.branch.id, employee_id,
                    [s.service_id for s in shape.services], service_start,
                ),
            ))
    out.sort(key=lambda s: (s.starts_at, str(s.employee_id)))
    return out


def compute_slots(
    ctx: ScheduleContext,
    shape: BookingShape,
    date_from: date,
    date_to: date,
    *,
    step_minutes: int,
    lead_time_minutes: int,
    horizon_days: int,
    secret: str,
    now: datetime | None = None,
    employee_ids: list[uuid.UUID] | None = None,
) -> list[Slot]:
    now = now or utcnow()
    not_before = now + timedelta(minutes=lead_time_minutes)
    not_after = now + timedelta(days=horizon_days)
    targets = employee_ids or list(ctx.employees)

    slots: list[Slot] = []
    for day in local_days(date_from, date_to):
        for employee_id in targets:
            slots.extend(slots_for_day(
                ctx, employee_id, day, shape,
                step_minutes=step_minutes, not_before=not_before,
                not_after=not_after, secret=secret,
            ))
    slots.sort(key=lambda s: (s.starts_at, str(s.employee_id)))
    return slots


def group_by_day(slots: list[Slot]) -> list[dict]:
    """Группировка для интерфейса: день -> список слотов."""
    days: dict[str, list[Slot]] = {}
    for slot in slots:
        days.setdefault(slot.local_date, []).append(slot)
    return [{'date': day, 'slots': items} for day, items in sorted(days.items())]


# ------------------------------------------------------- availability token

def availability_token(
    secret: str,
    company_id: uuid.UUID,
    branch_id: uuid.UUID,
    employee_id: uuid.UUID,
    service_ids: list[uuid.UUID],
    starts_at: datetime,
) -> str:
    """
    ТЗ 13.2: короткоживущий opaque-токен, связывающий слот с его параметрами.
    Защищает от устаревшего UI, но не заменяет проверку в транзакции —
    сервер всё равно перепроверяет занятость (13.3, шаг 6).
    """
    material = '|'.join([
        str(company_id), str(branch_id), str(employee_id),
        ','.join(sorted(str(s) for s in service_ids)),
        starts_at.isoformat(),
    ])
    digest = hmac.new(secret.encode('utf-8'), material.encode('utf-8'), hashlib.sha256)
    return digest.hexdigest()[:32]


def token_matches(
    token: str | None, secret: str, company_id: uuid.UUID, branch_id: uuid.UUID,
    employee_id: uuid.UUID, service_ids: list[uuid.UUID], starts_at: datetime,
) -> bool:
    if not token:
        return False
    expected = availability_token(secret, company_id, branch_id, employee_id, service_ids, starts_at)
    return hmac.compare_digest(expected, token)


def next_available(
    ctx: ScheduleContext, shape: BookingShape, *, step_minutes: int, lead_time_minutes: int,
    horizon_days: int, secret: str, now: datetime | None = None, limit: int = 3,
) -> list[Slot]:
    """
    Ближайшие свободные слоты. Нужны в двух местах: карточка компании в
    каталоге (CAT-004) и альтернативы при 409 SLOT_TAKEN (ТЗ 13.3, шаг 7).
    """
    now = now or utcnow()
    tz_name = ctx.timezone
    today = local(now, tz_name).date()
    found: list[Slot] = []
    for offset in range(0, min(horizon_days, 21) + 1):
        day = today + timedelta(days=offset)
        for employee_id in ctx.employees:
            found.extend(slots_for_day(
                ctx, employee_id, day, shape,
                step_minutes=step_minutes,
                not_before=now + timedelta(minutes=lead_time_minutes),
                not_after=now + timedelta(days=horizon_days),
                secret=secret,
            ))
        if len(found) >= limit:
            break
    found.sort(key=lambda s: (s.starts_at, str(s.employee_id)))
    return found[:limit]
