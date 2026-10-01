"""
Записи: создание, перенос, отмена, завершение (ТЗ 7.4–7.8, 13.3).

Главное правило модуля: занятость проверяется внутри той же транзакции,
которая вставляет запись. Любая предварительная проверка доступности —
подсказка интерфейсу, а не гарантия. На PostgreSQL поверх этого работает
exclusion constraint, и он ловит гонку, даже если код ошибётся.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.context import get_actor
from app.core.errors import (
    BusinessRuleViolation, InvalidStateTransition, NotFound, SlotTaken,
)
from app.db.models import (
    Appointment, AppointmentEvent, AppointmentService, Branch, Client, Company, Employee,
    EmployeeBranch, EmployeeService,
)
from app.db.types import new_uuid, utcnow
from app.domain import (
    APPOINTMENT_TRANSITIONS, AppointmentPaymentStatus, AppointmentSource, AppointmentStatus,
    BLOCKING_APPOINTMENT_STATUSES,
)
from app.services import audit, notifications, outbox, slots as slot_engine
from app.services.slots import BookingShape
from app.services.timeutils import Interval, local


@dataclass
class BookingRequest:
    company: Company
    branch: Branch
    client: Client
    employee_id: uuid.UUID
    service_ids: list[uuid.UUID]
    starts_at: datetime              # начало услуги, UTC
    source: str = AppointmentSource.CLIENT_APP
    client_comment: str | None = None
    internal_note: str | None = None
    idempotency_key: str | None = None
    availability_token: str | None = None
    created_by_user_id: uuid.UUID | None = None
    requires_prepayment: bool = False


@dataclass
class BookingResult:
    appointment: Appointment
    created: bool                    # False — вернули существующую по ключу идемпотентности


async def _lock_employee(session: AsyncSession, employee_id: uuid.UUID) -> Employee:
    """
    Сериализует запись к одному мастеру. На PostgreSQL это SELECT FOR UPDATE
    по строке сотрудника: две параллельные брони на одно время выстраиваются
    в очередь, и вторая увидит первую. На SQLite запись в базу и так под
    общим замком.
    """
    stmt = select(Employee).where(Employee.id == employee_id)
    if session.bind is not None and session.bind.dialect.name == 'postgresql':
        stmt = stmt.with_for_update()
    employee = await session.scalar(stmt)
    if employee is None:
        raise NotFound('Сотрудник')
    return employee


async def _conflicting(
    session: AsyncSession,
    employee_id: uuid.UUID,
    occupied: Interval,
    *,
    ignore_id: uuid.UUID | None = None,
) -> Appointment | None:
    stmt = select(Appointment).where(
        Appointment.employee_id == employee_id,
        Appointment.status.in_(list(BLOCKING_APPOINTMENT_STATUSES)),
        Appointment.starts_at < occupied.end,
        Appointment.ends_at > occupied.start,
    )
    if ignore_id is not None:
        stmt = stmt.where(Appointment.id != ignore_id)
    return await session.scalar(stmt.limit(1))


async def _alternatives(
    session: AsyncSession, company: Company, branch: Branch, employee_id: uuid.UUID,
    shape: BookingShape, settings: Settings, around: datetime,
) -> list[dict]:
    """Что предложить вместо занятого времени (ТЗ 13.3, шаг 7)."""
    employee = await session.get(Employee, employee_id)
    if employee is None:
        return []
    ctx = await slot_engine.load_context(
        session, company, branch, [employee],
        around - timedelta(days=1), around + timedelta(days=7),
    )
    found = slot_engine.next_available(
        ctx, shape,
        step_minutes=int(company.setting('slot_step_minutes', settings.slot_step_minutes)),
        lead_time_minutes=int(company.setting('lead_time_minutes', settings.booking_lead_time_minutes)),
        horizon_days=settings.booking_horizon_days,
        secret=settings.session_secret or settings.telegram_bot_token,
        limit=3,
    )
    return [
        {
            'employee_id': str(s.employee_id),
            'starts_at': s.starts_at.isoformat(),
            'local_date': s.local_date,
            'local_time': s.local_time,
        }
        for s in found
    ]


async def _validate_employee_can_serve(
    session: AsyncSession, company_id: uuid.UUID, branch_id: uuid.UUID,
    employee_id: uuid.UUID, service_ids: list[uuid.UUID],
) -> Employee:
    employee = await session.get(Employee, employee_id)
    if employee is None or employee.company_id != company_id:
        raise NotFound('Сотрудник')
    if not employee.active or not employee.takes_appointments:
        raise BusinessRuleViolation('Этот мастер сейчас не принимает записи')

    in_branch = await session.scalar(
        select(func.count()).select_from(EmployeeBranch).where(
            EmployeeBranch.employee_id == employee_id, EmployeeBranch.branch_id == branch_id,
        )
    )
    if not in_branch:
        raise BusinessRuleViolation('Мастер не работает в этом филиале')

    linked = await session.scalar(
        select(func.count()).select_from(EmployeeService).where(
            EmployeeService.employee_id == employee_id,
            EmployeeService.service_id.in_(service_ids),
        )
    )
    if linked != len(set(service_ids)):
        raise BusinessRuleViolation('Мастер не оказывает выбранные услуги')
    return employee


def _check_schedule_fits(
    ctx: slot_engine.ScheduleContext, employee_id: uuid.UUID, occupied: Interval, tz_name: str,
) -> None:
    """
    Слот должен попадать в рабочее окно. Проверяем по тому же движку, что
    считает выдачу: иначе ручная запись сотрудника легко уедет в час,
    когда салон уже закрыт.
    """
    day = local(occupied.start, tz_name).date()
    windows = slot_engine.working_windows(ctx, employee_id, day)
    # Интервал может начаться в конце суток и закончиться в следующих.
    if local(occupied.end, tz_name).date() != day:
        windows = windows + slot_engine.working_windows(ctx, employee_id, day + timedelta(days=1))
    from app.services.timeutils import merge

    if not any(w.contains(occupied) for w in merge(windows)):
        raise BusinessRuleViolation(
            'В это время мастер не работает',
            code='outside_working_hours',
        )


def _check_lead_time(company: Company, settings: Settings, starts_at: datetime,
                     *, staff: bool, now: datetime) -> None:
    horizon_days = int(company.setting('booking_horizon_days', settings.booking_horizon_days))
    if starts_at > now + timedelta(days=horizon_days):
        raise BusinessRuleViolation(
            f'Записаться можно не более чем на {horizon_days} дней вперёд',
            code='beyond_horizon',
        )
    if staff:
        # Сотрудник вносит визит задним числом — это законный сценарий.
        return
    lead = int(company.setting('lead_time_minutes', settings.booking_lead_time_minutes))
    if starts_at < now + timedelta(minutes=lead):
        raise BusinessRuleViolation(
            'Это время уже нельзя выбрать, выберите другое', code='lead_time_violation',
        )


async def create_appointment(
    session: AsyncSession, request: BookingRequest, settings: Settings,
) -> BookingResult:
    """
    ТЗ 13.3. Порядок шагов важен и не подлежит перестановке: проверка
    доступности стоит до вставки, но гарантию даёт именно вставка.
    """
    now = utcnow()
    company, branch = request.company, request.branch

    # 1. Идемпотентность: тот же ключ — та же запись, без второй брони.
    if request.idempotency_key:
        existing = await session.scalar(
            select(Appointment).where(
                Appointment.company_id == company.id,
                Appointment.idempotency_key == request.idempotency_key,
            )
        )
        if existing is not None:
            return BookingResult(appointment=existing, created=False)

    if branch.company_id != company.id:
        raise NotFound('Филиал')
    if request.client.company_id != company.id:
        raise NotFound('Клиент')

    # 2. Услуги и снимок цены считает сервер.
    shape = await slot_engine.resolve_services(
        session, company.id, request.service_ids, request.employee_id,
    )
    await _validate_employee_can_serve(
        session, company.id, branch.id, request.employee_id, request.service_ids,
    )

    staff_booking = request.source == AppointmentSource.STAFF
    _check_lead_time(company, settings, request.starts_at, staff=staff_booking, now=now)

    occupied = shape.occupied_for(request.starts_at)

    # 3. График: рабочее окно, перерывы, отсутствия.
    employee = await _lock_employee(session, request.employee_id)
    ctx = await slot_engine.load_context(
        session, company, branch, [employee], occupied.start - timedelta(days=1),
        occupied.end + timedelta(days=1),
    )
    _check_schedule_fits(ctx, employee.id, occupied, branch.timezone)

    # 4. Предварительная проверка занятости — понятная ошибка вместо
    #    исключения БД. Настоящая защита ниже, на вставке.
    conflict = await _conflicting(session, employee.id, occupied)
    if conflict is not None:
        raise SlotTaken(await _alternatives(
            session, company, branch, employee.id, shape, settings, request.starts_at,
        ))

    status = (
        AppointmentStatus.PENDING_PAYMENT if request.requires_prepayment
        else AppointmentStatus.CONFIRMED
    )
    appointment = Appointment(
        id=new_uuid(),
        company_id=company.id,
        branch_id=branch.id,
        client_id=request.client.id,
        employee_id=employee.id,
        starts_at=occupied.start,
        ends_at=occupied.end,
        service_starts_at=request.starts_at,
        service_ends_at=request.starts_at + timedelta(minutes=shape.duration_minutes),
        status=status,
        source=request.source,
        created_by_user_id=request.created_by_user_id,
        price_minor=shape.price_minor,
        currency_code=shape.services[0].currency_code,
        duration_minutes=shape.duration_minutes,
        title_snapshot=shape.title[:255],
        client_comment=request.client_comment,
        internal_note=request.internal_note,
        payment_status=(
            AppointmentPaymentStatus.AWAITING if request.requires_prepayment
            else AppointmentPaymentStatus.NOT_REQUIRED
        ),
        idempotency_key=request.idempotency_key,
        confirmed_at=None if request.requires_prepayment else now,
        created_at=now,
        updated_at=now,
    )
    session.add(appointment)

    for spec in shape.services:
        session.add(AppointmentService(
            id=new_uuid(),
            company_id=company.id,
            appointment_id=appointment.id,
            service_id=spec.service_id,
            name_snapshot=spec.name,
            price_minor=spec.price_minor,
            currency_code=spec.currency_code,
            duration_minutes=spec.duration_minutes,
            buffer_before_minutes=spec.buffer_before_minutes,
            buffer_after_minutes=spec.buffer_after_minutes,
            sort_order=spec.sort_order,
        ))

    # 5. Вставка. IntegrityError здесь — это либо exclusion constraint
    #    PostgreSQL, либо гонка по ключу идемпотентности.
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        if request.idempotency_key:
            existing = await session.scalar(
                select(Appointment).where(
                    Appointment.company_id == company.id,
                    Appointment.idempotency_key == request.idempotency_key,
                )
            )
            if existing is not None:
                return BookingResult(appointment=existing, created=False)
        raise SlotTaken() from exc

    _record_event(session, appointment, 'created', after={
        'status': appointment.status,
        'starts_at': appointment.starts_at.isoformat(),
        'employee_id': str(appointment.employee_id),
    })

    outbox.emit(
        session, outbox.EventType.APPOINTMENT_CREATED,
        {'appointment_id': str(appointment.id), 'company_id': str(company.id)},
        company_id=company.id,
    )
    await _plan_notifications(session, appointment, company, employee, request.client, kind='created')
    await audit.record(
        session, audit.AuditAction.APPOINTMENT_CREATED,
        company_id=company.id, target_type='appointment', target_id=appointment.id,
        after={'starts_at': appointment.starts_at.isoformat(), 'source': appointment.source},
    )
    return BookingResult(appointment=appointment, created=True)


def _record_event(
    session: AsyncSession, appointment: Appointment, event_type: str,
    *, before: dict | None = None, after: dict | None = None,
) -> None:
    from app.core.context import get_correlation_id

    actor = get_actor()
    session.add(AppointmentEvent(
        id=new_uuid(),
        company_id=appointment.company_id,
        appointment_id=appointment.id,
        event_type=event_type,
        actor_user_id=actor.user_id if actor else None,
        actor_role=(actor.company_role or actor.platform_role) if actor else None,
        before=before,
        after=after,
        correlation_id=get_correlation_id(),
        created_at=utcnow(),
    ))


async def _plan_notifications(
    session: AsyncSession, appointment: Appointment, company: Company,
    employee: Employee, client: Client, *, kind: str,
) -> None:
    client_tg = await notifications.telegram_id_for_client(session, client)
    employee_tg = await notifications.telegram_id_for_employee(session, employee.user_id)
    await notifications.plan_appointment_notifications(
        session, appointment,
        company_settings=company.settings,
        client_telegram_id=client_tg,
        employee_telegram_id=employee_tg,
        locale=company.default_locale,
        kind=kind,
    )


# ------------------------------------------------------------------- перенос

async def reschedule(
    session: AsyncSession,
    appointment: Appointment,
    settings: Settings,
    *,
    starts_at: datetime,
    employee_id: uuid.UUID | None = None,
    staff: bool,
    reason: str | None = None,
) -> Appointment:
    """
    ТЗ 7.6: новый слот занимается той же транзакцией, которая освобождает
    старый. Промежуточного состояния «старое отпустили, новое не взяли» нет.
    """
    if appointment.status not in (AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING_PAYMENT):
        raise InvalidStateTransition(appointment.status, 'rescheduled')

    company = await session.get(Company, appointment.company_id)
    branch = await session.get(Branch, appointment.branch_id)
    if company is None or branch is None:
        raise NotFound('Запись')

    target_employee_id = employee_id or appointment.employee_id
    service_ids = [s.service_id for s in sorted(appointment.services, key=lambda s: s.sort_order)]

    shape = await slot_engine.resolve_services(session, company.id, service_ids, target_employee_id)
    await _validate_employee_can_serve(
        session, company.id, branch.id, target_employee_id, service_ids,
    )
    _check_lead_time(company, settings, starts_at, staff=staff, now=utcnow())

    occupied = shape.occupied_for(starts_at)
    employee = await _lock_employee(session, target_employee_id)
    ctx = await slot_engine.load_context(
        session, company, branch, [employee],
        occupied.start - timedelta(days=1), occupied.end + timedelta(days=1),
        ignore_appointment_id=appointment.id,
    )
    _check_schedule_fits(ctx, employee.id, occupied, branch.timezone)

    conflict = await _conflicting(session, employee.id, occupied, ignore_id=appointment.id)
    if conflict is not None:
        raise SlotTaken(await _alternatives(
            session, company, branch, employee.id, shape, settings, starts_at,
        ))

    before = {
        'starts_at': appointment.starts_at.isoformat(),
        'employee_id': str(appointment.employee_id),
    }
    appointment.starts_at = occupied.start
    appointment.ends_at = occupied.end
    appointment.service_starts_at = starts_at
    appointment.service_ends_at = starts_at + timedelta(minutes=shape.duration_minutes)
    appointment.employee_id = employee.id
    appointment.duration_minutes = shape.duration_minutes
    appointment.version += 1
    appointment.updated_at = utcnow()

    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise SlotTaken() from exc

    # APT-010: старые напоминания больше не про это время.
    await notifications.cancel_for_appointment(session, appointment.id)
    client = await session.get(Client, appointment.client_id)
    if client is not None:
        await _plan_notifications(session, appointment, company, employee, client, kind='rescheduled')

    _record_event(session, appointment, 'rescheduled', before=before, after={
        'starts_at': appointment.starts_at.isoformat(),
        'employee_id': str(appointment.employee_id),
        'reason': reason,
    })
    outbox.emit(
        session, outbox.EventType.APPOINTMENT_RESCHEDULED,
        {'appointment_id': str(appointment.id)}, company_id=company.id,
    )
    await audit.record(
        session, audit.AuditAction.APPOINTMENT_RESCHEDULED,
        company_id=company.id, target_type='appointment', target_id=appointment.id,
        before=before, after={'starts_at': appointment.starts_at.isoformat()}, reason=reason,
    )
    return appointment


# -------------------------------------------------------------------- отмена

def cancellation_deadline_ok(company: Company, appointment: Appointment, now: datetime) -> bool:
    hours = int(company.setting('cancellation_deadline_hours', 0) or 0)
    if hours <= 0:
        return True
    return appointment.service_starts_at - timedelta(hours=hours) > now


async def cancel(
    session: AsyncSession,
    appointment: Appointment,
    *,
    by_client: bool,
    reason: str | None = None,
    actor_user_id: uuid.UUID | None = None,
    enforce_deadline: bool = True,
) -> Appointment:
    target = (
        AppointmentStatus.CANCELLED_BY_CLIENT if by_client
        else AppointmentStatus.CANCELLED_BY_COMPANY
    )
    allowed = APPOINTMENT_TRANSITIONS.get(appointment.status, frozenset())
    if target not in allowed:
        raise InvalidStateTransition(appointment.status, target)

    company = await session.get(Company, appointment.company_id)
    now = utcnow()
    if by_client and enforce_deadline and company is not None:
        if not cancellation_deadline_ok(company, appointment, now):
            hours = company.setting('cancellation_deadline_hours', 0)
            raise BusinessRuleViolation(
                f'Отменить можно не позднее чем за {hours} ч. Свяжитесь с салоном',
                code='cancellation_deadline_passed',
            )

    before = {'status': appointment.status}
    appointment.status = target
    appointment.cancelled_at = now
    appointment.cancelled_by_user_id = actor_user_id
    appointment.cancellation_reason = reason
    appointment.version += 1
    appointment.updated_at = now

    # APT-009: слот освобождается сразу, запись остаётся в истории.
    await notifications.cancel_for_appointment(session, appointment.id)
    _record_event(session, appointment, 'cancelled', before=before,
                  after={'status': target, 'reason': reason})
    outbox.emit(
        session, outbox.EventType.APPOINTMENT_CANCELLED,
        {'appointment_id': str(appointment.id), 'by_client': by_client},
        company_id=appointment.company_id,
    )
    await audit.record(
        session, audit.AuditAction.APPOINTMENT_CANCELLED,
        company_id=appointment.company_id, target_type='appointment', target_id=appointment.id,
        before=before, after={'status': target}, reason=reason,
    )
    return appointment


# ------------------------------------------------------- завершение и неявка

#: APT-011: закрыть визит можно, только когда он уже начался. Небольшой
#: допуск назад — часы устройства сотрудника и сервера расходятся.
COMPLETE_GRACE_MINUTES = 5


async def complete(
    session: AsyncSession, appointment: Appointment, *, now: datetime | None = None,
) -> Appointment:
    now = now or utcnow()
    if AppointmentStatus.COMPLETED not in APPOINTMENT_TRANSITIONS.get(appointment.status, frozenset()):
        raise InvalidStateTransition(appointment.status, AppointmentStatus.COMPLETED)
    if appointment.service_starts_at > now + timedelta(minutes=COMPLETE_GRACE_MINUTES):
        raise BusinessRuleViolation('Визит ещё не начался', code='too_early_to_complete')

    before = {'status': appointment.status}
    appointment.status = AppointmentStatus.COMPLETED
    appointment.completed_at = now
    appointment.version += 1
    appointment.updated_at = now

    await notifications.cancel_for_appointment(
        session, appointment.id, templates=[notifications.Template.APPOINTMENT_REMINDER],
    )
    _record_event(session, appointment, 'completed', before=before,
                  after={'status': appointment.status})
    outbox.emit(
        session, outbox.EventType.APPOINTMENT_COMPLETED,
        {'appointment_id': str(appointment.id)}, company_id=appointment.company_id,
    )
    # Запрос отзыва уходит не мгновенно: человек ещё в кресле.
    outbox.emit(
        session, outbox.EventType.REVIEW_REQUESTED,
        {'appointment_id': str(appointment.id)},
        company_id=appointment.company_id,
        available_at=now + timedelta(hours=2),
    )
    await audit.record(
        session, audit.AuditAction.APPOINTMENT_COMPLETED,
        company_id=appointment.company_id, target_type='appointment', target_id=appointment.id,
        before=before, after={'status': appointment.status},
    )
    return appointment


async def mark_no_show(
    session: AsyncSession, appointment: Appointment, *, now: datetime | None = None,
) -> Appointment:
    now = now or utcnow()
    if AppointmentStatus.NO_SHOW not in APPOINTMENT_TRANSITIONS.get(appointment.status, frozenset()):
        raise InvalidStateTransition(appointment.status, AppointmentStatus.NO_SHOW)
    if appointment.service_starts_at > now + timedelta(minutes=COMPLETE_GRACE_MINUTES):
        raise BusinessRuleViolation('Визит ещё не начался', code='too_early_for_no_show')

    before = {'status': appointment.status}
    appointment.status = AppointmentStatus.NO_SHOW
    appointment.version += 1
    appointment.updated_at = now

    await notifications.cancel_for_appointment(session, appointment.id)
    _record_event(session, appointment, 'no_show', before=before, after={'status': appointment.status})
    outbox.emit(
        session, outbox.EventType.APPOINTMENT_NO_SHOW,
        {'appointment_id': str(appointment.id)}, company_id=appointment.company_id,
    )
    await audit.record(
        session, audit.AuditAction.APPOINTMENT_NO_SHOW,
        company_id=appointment.company_id, target_type='appointment', target_id=appointment.id,
        before=before, after={'status': appointment.status},
    )
    return appointment
