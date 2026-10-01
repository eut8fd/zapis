"""
Slot engine (ТЗ 13, SCH-004…SCH-008).

Тесты собирают контекст руками, без БД: движок должен быть проверяем
отдельно от репозиториев, иначе граничные случаи по времени проверить
нечем.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from app.db.models import (
    Branch, Company, Employee, ScheduleBreak, ScheduleException, WeeklyScheduleRule,
)
from app.services import slots as engine
from app.services.slots import BookingShape, ScheduleContext, ServiceSpec
from app.services.timeutils import Interval, intersect, local_datetime, merge, subtract

TZ = 'Asia/Almaty'
SECRET = 'test-secret'


def make_company(**kw) -> Company:
    return Company(
        id=uuid.uuid4(), name='Тест', slug='test', category='beauty',
        owner_user_id=uuid.uuid4(), settings=kw.get('settings', {}),
    )


def make_branch(tz: str = TZ) -> Branch:
    return Branch(id=uuid.uuid4(), company_id=uuid.uuid4(), name='Главный', slug='main', timezone=tz)


def make_employee() -> Employee:
    return Employee(id=uuid.uuid4(), company_id=uuid.uuid4(), display_name='Мастер')


def rule(branch_id, weekday, start, end, employee_id=None) -> WeeklyScheduleRule:
    return WeeklyScheduleRule(
        id=uuid.uuid4(), company_id=uuid.uuid4(), branch_id=branch_id, employee_id=employee_id,
        weekday=weekday, start_local_time=time(*start), end_local_time=time(*end), active=True,
    )


def shape(duration=60, before=0, after=0) -> BookingShape:
    return BookingShape((ServiceSpec(
        service_id=uuid.uuid4(), name='Стрижка', price_minor=500000, currency_code='KZT',
        duration_minutes=duration, buffer_before_minutes=before, buffer_after_minutes=after,
    ),))


def context(*, tz=TZ, branch_hours=((10, 0), (20, 0)), employee_rules=None,
            breaks=None, exceptions=None, busy=None) -> tuple[ScheduleContext, Employee]:
    company, branch, employee = make_company(), make_branch(tz), make_employee()
    ctx = ScheduleContext(company=company, branch=branch, employees={employee.id: employee})
    for weekday in range(7):
        ctx.branch_rules.append(rule(branch.id, weekday, *branch_hours))
    if employee_rules:
        for weekday, start, end in employee_rules:
            ctx.employee_rules.setdefault(employee.id, []).append(
                rule(branch.id, weekday, start, end, employee_id=employee.id)
            )
    if breaks:
        for target_rule, start, end in breaks:
            ctx.breaks.setdefault(target_rule.id, []).append(ScheduleBreak(
                id=uuid.uuid4(), company_id=company.id, rule_id=target_rule.id,
                start_local_time=time(*start), end_local_time=time(*end),
                created_at=datetime.now(timezone.utc),
            ))
    ctx.exceptions = list(exceptions or [])
    if busy:
        ctx.busy[employee.id] = list(busy)
    return ctx, employee


# ------------------------------------------------------------- интервалы

def test_merge_joins_touching_intervals():
    base = datetime(2026, 9, 1, 10, tzinfo=timezone.utc)
    merged = merge([
        Interval(base, base + timedelta(hours=1)),
        Interval(base + timedelta(hours=1), base + timedelta(hours=2)),
    ])
    assert len(merged) == 1
    assert merged[0].minutes == 120


def test_subtract_splits_interval():
    base = datetime(2026, 9, 1, 10, tzinfo=timezone.utc)
    result = subtract(
        [Interval(base, base + timedelta(hours=8))],
        [Interval(base + timedelta(hours=3), base + timedelta(hours=4))],
    )
    assert [i.minutes for i in result] == [180, 240]


def test_intersect_is_branch_hours_clipping_employee_hours():
    """Грабли из CLAUDE.md: часы мастера сами по себе ничего не значат."""
    base = datetime(2026, 9, 1, tzinfo=timezone.utc)
    branch = [Interval(base + timedelta(hours=10), base + timedelta(hours=18))]
    employee = [Interval(base + timedelta(hours=8), base + timedelta(hours=22))]
    result = intersect(branch, employee)
    assert len(result) == 1
    assert result[0].start == base + timedelta(hours=10)
    assert result[0].end == base + timedelta(hours=18)


# ------------------------------------------------------------- окна работы

def test_employee_without_own_schedule_uses_branch_hours():
    ctx, employee = context()
    windows = engine.free_windows(ctx, employee.id, date(2026, 9, 1))
    assert len(windows) == 1
    assert windows[0].minutes == 600


def test_employee_day_off_produces_no_windows():
    # У мастера есть график, но только на понедельник; вторник — выходной.
    ctx, employee = context(employee_rules=[(0, (10, 0), (18, 0))])
    assert engine.free_windows(ctx, employee.id, date(2026, 9, 1)) == []   # вторник


def test_break_cuts_the_window():
    ctx, employee = context()
    monday_rule = next(r for r in ctx.branch_rules if r.weekday == 0)
    ctx.breaks[monday_rule.id] = [ScheduleBreak(
        id=uuid.uuid4(), company_id=ctx.company.id, rule_id=monday_rule.id,
        start_local_time=time(13, 0), end_local_time=time(14, 0),
        created_at=datetime.now(timezone.utc),
    )]
    windows = engine.free_windows(ctx, employee.id, date(2026, 8, 31))    # понедельник
    assert [w.minutes for w in windows] == [180, 360]


def test_vacation_exception_removes_the_day():
    day = date(2026, 9, 1)
    ctx, employee = context()
    ctx.exceptions = [ScheduleException(
        id=uuid.uuid4(), company_id=ctx.company.id, branch_id=ctx.branch.id,
        employee_id=employee.id,
        starts_at=local_datetime(day, time(0, 0), TZ),
        ends_at=local_datetime(day + timedelta(days=1), time(0, 0), TZ),
        kind='vacation', created_at=datetime.now(timezone.utc),
    )]
    assert engine.free_windows(ctx, employee.id, day) == []


def test_branch_wide_exception_applies_to_everyone():
    day = date(2026, 9, 1)
    ctx, employee = context()
    ctx.exceptions = [ScheduleException(
        id=uuid.uuid4(), company_id=ctx.company.id, branch_id=ctx.branch.id,
        employee_id=None,                      # весь филиал
        starts_at=local_datetime(day, time(10, 0), TZ),
        ends_at=local_datetime(day, time(14, 0), TZ),
        kind='blocked', created_at=datetime.now(timezone.utc),
    )]
    windows = engine.free_windows(ctx, employee.id, day)
    assert [w.minutes for w in windows] == [360]


def test_custom_open_extends_beyond_regular_hours():
    day = date(2026, 9, 1)
    ctx, employee = context()
    ctx.exceptions = [ScheduleException(
        id=uuid.uuid4(), company_id=ctx.company.id, branch_id=ctx.branch.id,
        employee_id=employee.id,
        starts_at=local_datetime(day, time(20, 0), TZ),
        ends_at=local_datetime(day, time(22, 0), TZ),
        kind='custom_open', created_at=datetime.now(timezone.utc),
    )]
    windows = engine.free_windows(ctx, employee.id, day)
    assert [w.minutes for w in windows] == [720]


def test_busy_appointment_removes_its_interval():
    day = date(2026, 9, 1)
    ctx, employee = context(busy=[Interval(
        local_datetime(day, time(12, 0), TZ), local_datetime(day, time(13, 0), TZ),
    )])
    windows = engine.free_windows(ctx, employee.id, day)
    assert [w.minutes for w in windows] == [120, 420]


# ------------------------------------------------------------------ слоты

def _slots(ctx, employee, day, booking, *, step=30, now=None):
    return engine.slots_for_day(
        ctx, employee.id, day, booking,
        step_minutes=step,
        not_before=now or datetime(2020, 1, 1, tzinfo=timezone.utc),
        not_after=datetime(2099, 1, 1, tzinfo=timezone.utc),
        secret=SECRET,
    )


def test_slots_follow_the_grid():
    day = date(2026, 9, 1)
    ctx, employee = context()
    found = _slots(ctx, employee, day, shape(60))
    times = [x.local_time for x in found]
    assert times[0] == '10:00'
    assert '10:30' in times
    # Последний слот должен закончиться ровно к закрытию.
    assert times[-1] == '19:00'


def test_buffer_after_shortens_the_tail():
    """
    Буфер после услуги занимает календарь: с ним последний слот сдвигается
    на шаг назад, потому что 19:00 + 60 + 15 уже выходит за 20:00.
    """
    day = date(2026, 9, 1)
    ctx, employee = context()
    assert _slots(ctx, employee, day, shape(60))[-1].local_time == '19:00'
    assert _slots(ctx, employee, day, shape(60, after=15))[-1].local_time == '18:30'


def test_buffer_before_pushes_the_first_slot():
    day = date(2026, 9, 1)
    ctx, employee = context()
    found = _slots(ctx, employee, day, shape(60, before=15))
    assert found[0].local_time == '10:15'


def test_gap_after_appointment_is_offered_even_off_grid():
    """
    После записи, закончившейся в 11:20, окно 11:20–20:00 должно давать
    и сам «хвост», и обычную сетку — иначе теряется загрузка мастера.
    """
    day = date(2026, 9, 1)
    ctx, employee = context(busy=[Interval(
        local_datetime(day, time(10, 0), TZ), local_datetime(day, time(11, 20), TZ),
    )])
    found = _slots(ctx, employee, day, shape(60))
    times = [x.local_time for x in found]
    assert times[0] == '11:20'
    assert '11:30' in times


def test_lead_time_hides_slots_that_are_too_soon():
    day = date(2026, 9, 1)
    ctx, employee = context()
    not_before = local_datetime(day, time(15, 0), TZ)
    found = engine.slots_for_day(
        ctx, employee.id, day, shape(60), step_minutes=30,
        not_before=not_before, not_after=datetime(2099, 1, 1, tzinfo=timezone.utc), secret=SECRET,
    )
    assert found[0].local_time == '15:00'


def test_slot_carries_price_and_duration_snapshot():
    ctx, employee = context()
    found = _slots(ctx, employee, date(2026, 9, 1), shape(45))
    assert found[0].price_minor == 500000
    assert found[0].duration_minutes == 45
    assert found[0].currency_code == 'KZT'


def test_availability_token_binds_to_slot_parameters():
    """ТЗ 13.2: токен связан с компанией, мастером, услугами и временем."""
    ctx, employee = context()
    booking = shape(60)
    service_ids = [item.service_id for item in booking.services]
    slot = _slots(ctx, employee, date(2026, 9, 1), booking)[0]

    assert engine.token_matches(
        slot.token, SECRET, ctx.company.id, ctx.branch.id, employee.id,
        service_ids, slot.starts_at,
    )
    # Другое время — другой токен.
    assert not engine.token_matches(
        slot.token, SECRET, ctx.company.id, ctx.branch.id, employee.id,
        service_ids, slot.starts_at + timedelta(minutes=30),
    )
    # Чужой секрет подделать токен не позволяет.
    assert not engine.token_matches(
        slot.token, 'other-secret', ctx.company.id, ctx.branch.id, employee.id,
        service_ids, slot.starts_at,
    )


# ------------------------------------------------------------ часовые пояса

def test_timezone_comes_from_branch_not_server():
    """SCH-005: 10:00 в Алматы — это 05:00 UTC, независимо от зоны сервера."""
    ctx, employee = context(tz=TZ)
    found = _slots(ctx, employee, date(2026, 9, 1), shape(60))
    assert found[0].starts_at.hour == 5
    assert found[0].local_time == '10:00'


def test_dst_spring_forward_does_not_produce_missing_local_times():
    """
    ТЗ 15.3: границы суток и DST покрываются тестами, даже если начальный
    рынок переводом стрелок не пользуется.
    """
    ctx, employee = context(tz='Europe/Berlin', branch_hours=((0, 0), (23, 59)))
    day = date(2026, 3, 29)                    # ночь перевода часов
    found = _slots(ctx, employee, day, shape(60), step=60)
    local_times = [x.local_time for x in found]
    assert '02:00' not in local_times, 'несуществующего локального часа быть не должно'
    assert len(found) >= 20


def test_overnight_shift_crosses_midnight():
    ctx, employee = context(branch_hours=((22, 0), (2, 0)))
    windows = engine.free_windows(ctx, employee.id, date(2026, 9, 1))
    assert len(windows) == 1
    assert windows[0].minutes == 240


# ------------------------------------------------------------- ближайшее

def test_next_available_returns_sorted_slots():
    ctx, employee = context()
    now = local_datetime(date(2026, 9, 1), time(9, 0), TZ)
    found = engine.next_available(
        ctx, shape(60), step_minutes=30, lead_time_minutes=0, horizon_days=7,
        secret=SECRET, now=now, limit=3,
    )
    assert len(found) == 3
    assert found[0].starts_at < found[1].starts_at < found[2].starts_at
