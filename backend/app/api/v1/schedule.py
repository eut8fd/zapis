"""
Графики, исключения и расчёт слотов (ТЗ 8.5, 12.5).

Разделение прав здесь важное: `schedule.own.write` позволяет мастеру
править только свой график, `schedule.all.write` — чужой. Проверка идёт
по employee_id из membership, а не по тому, что прислал клиент.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import delete, select

from app.api.deps import AppSettings, DbSession, Tenant, TenantContext, require_permission
from app.api.v1 import public as public_api
from app.api.v1 import schemas as s
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.db.models import Branch, Employee, ScheduleBreak, ScheduleException, WeeklyScheduleRule
from app.db.types import new_uuid, utcnow
from app.domain import Permission
from app.services import audit
from app.services.timeutils import format_hhmm, parse_hhmm
from app.utils.text import clean

router = APIRouter(tags=['schedule'])

MAX_PRIVATE_HORIZON_DAYS = 62


def _assert_can_edit(tenant, employee_id: uuid.UUID | None) -> None:
    if tenant.has(Permission.SCHEDULE_ALL_WRITE):
        return
    if tenant.has(Permission.SCHEDULE_OWN_WRITE) and employee_id and employee_id == tenant.employee_id:
        return
    raise Forbidden('Можно менять только свой график')


@router.get('/companies/{company_id}/schedule/rules', response_model=list[s.ScheduleRuleOut])
async def list_rules(
    session: DbSession,
    tenant: Tenant,
    branch_id: Annotated[uuid.UUID | None, Query()] = None,
    employee_id: Annotated[uuid.UUID | None, Query()] = None,
) -> list[s.ScheduleRuleOut]:
    stmt = select(WeeklyScheduleRule).where(
        WeeklyScheduleRule.company_id == tenant.company.id,
        WeeklyScheduleRule.active.is_(True),
    )
    if branch_id:
        stmt = stmt.where(WeeklyScheduleRule.branch_id == branch_id)
    if employee_id is not None:
        stmt = stmt.where(WeeklyScheduleRule.employee_id == employee_id)

    rules = list((await session.execute(stmt.order_by(WeeklyScheduleRule.weekday))).scalars().all())
    breaks: dict[uuid.UUID, list[ScheduleBreak]] = {}
    if rules:
        for item in (await session.execute(
            select(ScheduleBreak).where(ScheduleBreak.rule_id.in_([r.id for r in rules]))
        )).scalars().all():
            breaks.setdefault(item.rule_id, []).append(item)

    return [
        s.ScheduleRuleOut(
            id=rule.id, branch_id=rule.branch_id, employee_id=rule.employee_id,
            weekday=rule.weekday,
            start=format_hhmm(rule.start_local_time), end=format_hhmm(rule.end_local_time),
            breaks=[
                s.BreakIn(start=format_hhmm(b.start_local_time), end=format_hhmm(b.end_local_time),
                          title=b.title)
                for b in sorted(breaks.get(rule.id, []), key=lambda x: x.start_local_time)
            ],
        )
        for rule in rules
    ]


@router.put('/companies/{company_id}/schedule/rules', response_model=list[s.ScheduleRuleOut])
async def replace_rules(
    payload: s.ScheduleRulesIn, session: DbSession, tenant: Tenant,
) -> list[s.ScheduleRuleOut]:
    """
    Полная замена недельного графика одной операцией. Частичные правки
    порождали бы промежуточные состояния, в которых слоты считаются неверно.
    """
    _assert_can_edit(tenant, payload.employee_id)

    branch = await session.get(Branch, payload.branch_id)
    if branch is None or branch.company_id != tenant.company.id:
        raise NotFound('Филиал')
    if payload.employee_id is not None:
        employee = await session.get(Employee, payload.employee_id)
        if employee is None or employee.company_id != tenant.company.id:
            raise NotFound('Сотрудник')

    old = list((await session.execute(
        select(WeeklyScheduleRule.id).where(
            WeeklyScheduleRule.company_id == tenant.company.id,
            WeeklyScheduleRule.branch_id == payload.branch_id,
            WeeklyScheduleRule.employee_id == payload.employee_id,
        )
    )).scalars().all())
    if old:
        await session.execute(delete(ScheduleBreak).where(ScheduleBreak.rule_id.in_(old)))
        await session.execute(delete(WeeklyScheduleRule).where(WeeklyScheduleRule.id.in_(old)))

    now = utcnow()
    for item in payload.rules:
        start, end = parse_hhmm(item.start), parse_hhmm(item.end)
        rule = WeeklyScheduleRule(
            id=new_uuid(),
            company_id=tenant.company.id,
            branch_id=payload.branch_id,
            employee_id=payload.employee_id,
            weekday=item.weekday,
            start_local_time=start,
            end_local_time=end,
            active=True,
            created_at=now, updated_at=now,
        )
        session.add(rule)
        await session.flush()

        for br in item.breaks:
            br_start, br_end = parse_hhmm(br.start), parse_hhmm(br.end)
            if br_start >= br_end:
                raise ValidationFailed('Перерыв: начало позже конца', fields={'breaks': 'order'})
            if br_start < start or br_end > end:
                raise ValidationFailed(
                    'Перерыв выходит за пределы смены', fields={'breaks': 'outside_shift'},
                )
            session.add(ScheduleBreak(
                id=new_uuid(), company_id=tenant.company.id, rule_id=rule.id,
                start_local_time=br_start, end_local_time=br_end,
                title=clean(br.title, max_length=120), created_at=now,
            ))

    await audit.record(
        session, audit.AuditAction.SCHEDULE_UPDATED,
        company_id=tenant.company.id, target_type='schedule',
        target_id=payload.employee_id or payload.branch_id,
        after={'rules': len(payload.rules), 'employee_id': str(payload.employee_id or '')},
    )
    await session.commit()
    return await list_rules(session, tenant, payload.branch_id, payload.employee_id)


@router.get('/companies/{company_id}/schedule/exceptions', response_model=list[s.ExceptionOut])
async def list_exceptions(
    session: DbSession,
    tenant: Tenant,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
    employee_id: Annotated[uuid.UUID | None, Query()] = None,
) -> list[s.ExceptionOut]:
    stmt = select(ScheduleException).where(ScheduleException.company_id == tenant.company.id)
    if employee_id is not None:
        stmt = stmt.where(ScheduleException.employee_id == employee_id)
    elif not tenant.has(Permission.CALENDAR_ALL_READ) and tenant.employee_id:
        # Мастер без общего календаря видит только свои отсутствия.
        stmt = stmt.where(
            (ScheduleException.employee_id == tenant.employee_id)
            | (ScheduleException.employee_id.is_(None))
        )

    if date_from or date_to:
        branch = await session.scalar(
            select(Branch).where(Branch.company_id == tenant.company.id)
            .order_by(Branch.sort_order).limit(1)
        )
        tz_name = branch.timezone if branch else 'UTC'
        from app.services.timeutils import end_of_local_day, start_of_local_day
        if date_from:
            stmt = stmt.where(ScheduleException.ends_at > start_of_local_day(date_from, tz_name))
        if date_to:
            stmt = stmt.where(ScheduleException.starts_at < end_of_local_day(date_to, tz_name))

    rows = (await session.execute(stmt.order_by(ScheduleException.starts_at))).scalars().all()
    return [s.ExceptionOut.model_validate(row) for row in rows]


@router.post('/companies/{company_id}/schedule/exceptions', response_model=s.ExceptionOut,
             status_code=status.HTTP_201_CREATED)
async def create_exception(
    payload: s.ExceptionIn, session: DbSession, tenant: Tenant,
) -> s.ExceptionOut:
    _assert_can_edit(tenant, payload.employee_id)

    if payload.starts_at.tzinfo is None or payload.ends_at.tzinfo is None:
        raise ValidationFailed('Время должно содержать часовой пояс', fields={'starts_at': 'tz'})
    if payload.starts_at >= payload.ends_at:
        raise ValidationFailed('Начало должно быть раньше конца', fields={'ends_at': 'order'})

    if payload.employee_id is not None:
        employee = await session.get(Employee, payload.employee_id)
        if employee is None or employee.company_id != tenant.company.id:
            raise NotFound('Сотрудник')
    elif not tenant.has(Permission.SCHEDULE_ALL_WRITE):
        raise Forbidden('Блокировка на весь филиал требует прав на общий график')

    if payload.branch_id is not None:
        branch = await session.get(Branch, payload.branch_id)
        if branch is None or branch.company_id != tenant.company.id:
            raise NotFound('Филиал')

    exception = ScheduleException(
        id=new_uuid(),
        company_id=tenant.company.id,
        branch_id=payload.branch_id,
        employee_id=payload.employee_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        kind=payload.kind,
        reason=clean(payload.reason, max_length=255),
        created_by_user_id=tenant.principal.user.id,
        created_at=utcnow(),
    )
    session.add(exception)
    await audit.record(
        session, audit.AuditAction.SCHEDULE_EXCEPTION_CREATED,
        company_id=tenant.company.id, target_type='schedule_exception', target_id=exception.id,
        after={'kind': exception.kind, 'starts_at': exception.starts_at.isoformat()},
    )
    await session.commit()
    return s.ExceptionOut.model_validate(exception)


@router.delete('/companies/{company_id}/schedule/exceptions/{exception_id}',
               response_model=s.OkOut)
async def delete_exception(
    exception_id: uuid.UUID, session: DbSession, tenant: Tenant,
) -> s.OkOut:
    exception = await session.get(ScheduleException, exception_id)
    if exception is None or exception.company_id != tenant.company.id:
        raise NotFound('Блокировка')
    _assert_can_edit(tenant, exception.employee_id)

    await audit.record(
        session, audit.AuditAction.SCHEDULE_EXCEPTION_DELETED,
        company_id=tenant.company.id, target_type='schedule_exception', target_id=exception.id,
        before={'kind': exception.kind, 'starts_at': exception.starts_at.isoformat()},
    )
    await session.delete(exception)
    await session.commit()
    return s.OkOut()


@router.get('/companies/{company_id}/availability', response_model=s.AvailabilityOut)
async def availability(
    session: DbSession,
    settings: AppSettings,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.SERVICES_READ))],
    service_ids: Annotated[list[uuid.UUID], Query(min_length=1, max_length=10)],
    date_from: Annotated[date, Query()],
    date_to: Annotated[date | None, Query()] = None,
    branch_id: Annotated[uuid.UUID | None, Query()] = None,
    employee_id: Annotated[uuid.UUID | None, Query()] = None,
    ignore_appointment_id: Annotated[uuid.UUID | None, Query()] = None,
) -> s.AvailabilityOut:
    """
    Тот же движок, что и в публичной выдаче (SCH-007). Горизонт шире:
    сотрудник планирует дальше, чем клиент записывается.
    """
    return await public_api.compute_availability(
        session, settings, tenant.company,
        service_ids=service_ids, date_from=date_from, date_to=date_to,
        branch_id=branch_id, employee_id=employee_id,
        max_horizon_days=MAX_PRIVATE_HORIZON_DAYS,
        ignore_appointment_id=ignore_appointment_id,
    )
