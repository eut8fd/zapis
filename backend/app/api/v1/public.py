"""
Публичный каталог и страница компании (ТЗ 8.1, 12.3).

CAT-001: наружу уходят только опубликованные компании и только разрешённые
поля. Ни CRM, ни финансов, ни membership, ни приглашений здесь нет — это
проверяется составом схем, а не аккуратностью обработчика.
"""
from __future__ import annotations

import math
import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.api.deps import AppSettings, DbSession, PublicCompany
from app.api.v1 import schemas as s
from app.core.errors import NotFound, ValidationFailed
from app.db.models import (
    Branch, Company, Employee, EmployeeService, Review, Service,
)
from app.db.types import utcnow
from app.domain import BranchStatus, CompanyStatus, ReviewStatus
from app.services import slots as slot_engine
from app.utils import cursor as cursor_utils

router = APIRouter(prefix='/public', tags=['public'])

MAX_PUBLIC_HORIZON_DAYS = 30


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Гаверсинус. Точность до сотен метров нас устраивает — это карточка каталога."""
    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    )
    return round(radius * 2 * math.asin(math.sqrt(a)), 1)


async def _company_aggregates(session, company_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Минимальная цена, рейтинг и число отзывов — одним запросом на всю выдачу."""
    if not company_ids:
        return {}

    prices = (await session.execute(
        select(Service.company_id, func.min(Service.price_minor))
        .where(
            Service.company_id.in_(company_ids),
            Service.active.is_(True), Service.public.is_(True), Service.price_minor > 0,
        )
        .group_by(Service.company_id)
    )).all()

    ratings = (await session.execute(
        select(Review.company_id, func.avg(Review.rating), func.count(Review.id))
        .where(Review.company_id.in_(company_ids), Review.status == ReviewStatus.PUBLISHED)
        .group_by(Review.company_id)
    )).all()

    out: dict[uuid.UUID, dict] = {cid: {} for cid in company_ids}
    for company_id, min_price in prices:
        out.setdefault(company_id, {})['min_price_minor'] = int(min_price)
    for company_id, avg, count in ratings:
        out.setdefault(company_id, {}).update(
            rating=round(float(avg), 1) if avg is not None else None,
            reviews_count=int(count),
        )
    return out


async def _primary_branch(session, company_id: uuid.UUID) -> Branch | None:
    return await session.scalar(
        select(Branch)
        .where(Branch.company_id == company_id, Branch.status == BranchStatus.ACTIVE)
        .order_by(Branch.sort_order, Branch.created_at)
        .limit(1)
    )


@router.get('/companies', response_model=s.Page)
async def catalog(
    session: DbSession,
    settings: AppSettings,
    q: Annotated[str | None, Query(max_length=120)] = None,
    category: Annotated[str | None, Query(max_length=40)] = None,
    city: Annotated[str | None, Query(max_length=80)] = None,
    latitude: Annotated[float | None, Query(ge=-90, le=90)] = None,
    longitude: Annotated[float | None, Query(ge=-180, le=180)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> s.Page:
    """CAT-002: фильтрация выполняется сервером, а не отбором на клиенте."""
    secret = settings.session_secret or settings.telegram_bot_token
    position = cursor_utils.decode(cursor, secret)

    stmt = (
        select(Company)
        .where(Company.status == CompanyStatus.PUBLISHED, Company.deleted_at.is_(None))
        .order_by(Company.name, Company.id)
        .limit(limit + 1)
    )
    if category:
        stmt = stmt.where(Company.category == category)
    if q:
        pattern = f'%{q.lower()}%'
        stmt = stmt.where(or_(
            func.lower(Company.name).like(pattern),
            func.lower(func.coalesce(Company.description, '')).like(pattern),
        ))
    if city:
        stmt = stmt.where(Company.id.in_(
            select(Branch.company_id).where(func.lower(Branch.city) == city.lower())
        ))
    if position:
        # Составной курсор: имена не уникальны, добавляем id как тай-брейк.
        stmt = stmt.where(or_(
            Company.name > position['name'],
            (Company.name == position['name']) & (Company.id > uuid.UUID(position['id'])),
        ))

    rows = list((await session.execute(stmt)).scalars().all())
    has_more = len(rows) > limit
    rows = rows[:limit]

    aggregates = await _company_aggregates(session, [c.id for c in rows])
    items: list[s.CompanyCardOut] = []
    for company in rows:
        branch = await _primary_branch(session, company.id)
        agg = aggregates.get(company.id, {})
        distance = None
        if latitude is not None and longitude is not None and branch and branch.latitude is not None:
            distance = _distance_km(latitude, longitude, branch.latitude, branch.longitude or 0.0)
        items.append(s.CompanyCardOut(
            id=company.id, slug=company.slug, name=company.name, category=company.category,
            description=company.description, currency_code=company.currency_code,
            city=branch.city if branch else None,
            address=branch.address if branch else None,
            rating=agg.get('rating'), reviews_count=agg.get('reviews_count', 0),
            min_price_minor=agg.get('min_price_minor'),
            distance_km=distance,
        ))

    if latitude is not None and longitude is not None:
        # CAT-003: сортировка по расстоянию применяется к уже отфильтрованной
        # странице; полноценный геопоиск требует PostGIS и придёт отдельно.
        items.sort(key=lambda c: (c.distance_km is None, c.distance_km or 0))

    next_cursor = None
    if has_more and rows:
        next_cursor = cursor_utils.encode(
            {'name': rows[-1].name, 'id': str(rows[-1].id)}, secret,
        )
    return s.Page(items=items, next_cursor=next_cursor, has_more=has_more)


@router.get('/companies/{slug}', response_model=s.CompanyPublicOut)
async def company_page(company: PublicCompany, session: DbSession) -> s.CompanyPublicOut:
    branches = list((await session.execute(
        select(Branch)
        .where(Branch.company_id == company.id, Branch.status == BranchStatus.ACTIVE)
        .order_by(Branch.sort_order)
    )).scalars().all())
    aggregates = (await _company_aggregates(session, [company.id])).get(company.id, {})
    primary = branches[0] if branches else None

    return s.CompanyPublicOut(
        id=company.id, slug=company.slug, name=company.name, category=company.category,
        description=company.description, currency_code=company.currency_code,
        city=primary.city if primary else None,
        address=primary.address if primary else None,
        phone=primary.phone if primary else None,
        rating=aggregates.get('rating'), reviews_count=aggregates.get('reviews_count', 0),
        min_price_minor=aggregates.get('min_price_minor'),
        branches=[s.BranchPublicOut.model_validate(b) for b in branches],
    )


@router.get('/companies/{slug}/services', response_model=list[s.ServicePublicOut])
async def company_services(company: PublicCompany, session: DbSession) -> list[s.ServicePublicOut]:
    rows = (await session.execute(
        select(Service)
        .where(
            Service.company_id == company.id,
            Service.active.is_(True), Service.public.is_(True),
        )
        .order_by(Service.sort_order, Service.name)
    )).scalars().all()
    return [s.ServicePublicOut.model_validate(row) for row in rows]


@router.get('/companies/{slug}/staff', response_model=list[s.StaffPublicOut])
async def company_staff(company: PublicCompany, session: DbSession) -> list[s.StaffPublicOut]:
    employees = list((await session.execute(
        select(Employee)
        .where(
            Employee.company_id == company.id,
            Employee.active.is_(True), Employee.public.is_(True),
            Employee.takes_appointments.is_(True),
        )
        .order_by(Employee.sort_order, Employee.display_name)
    )).scalars().all())
    if not employees:
        return []

    links = (await session.execute(
        select(EmployeeService.employee_id, EmployeeService.service_id)
        .where(EmployeeService.employee_id.in_([e.id for e in employees]))
    )).all()
    by_employee: dict[uuid.UUID, list[uuid.UUID]] = {}
    for employee_id, service_id in links:
        by_employee.setdefault(employee_id, []).append(service_id)

    return [
        s.StaffPublicOut(
            id=e.id, display_name=e.display_name, role_title=e.role_title,
            rating=e.rating, service_ids=by_employee.get(e.id, []),
        )
        for e in employees
    ]


@router.get('/companies/{slug}/availability', response_model=s.AvailabilityOut)
async def company_availability(
    company: PublicCompany,
    session: DbSession,
    settings: AppSettings,
    service_ids: Annotated[list[uuid.UUID], Query(min_length=1, max_length=10)],
    date_from: Annotated[date, Query()],
    date_to: Annotated[date | None, Query()] = None,
    branch_id: Annotated[uuid.UUID | None, Query()] = None,
    employee_id: Annotated[uuid.UUID | None, Query()] = None,
) -> s.AvailabilityOut:
    """
    Публичная выдача слотов с ограниченным горизонтом (ТЗ 12.3). Считает
    тот же движок, что и приватный календарь — иначе клиент видел бы одно,
    а сотрудник другое.
    """
    return await compute_availability(
        session, settings, company,
        service_ids=service_ids, date_from=date_from, date_to=date_to,
        branch_id=branch_id, employee_id=employee_id,
        max_horizon_days=MAX_PUBLIC_HORIZON_DAYS,
    )


async def compute_availability(
    session,
    settings,
    company: Company,
    *,
    service_ids: list[uuid.UUID],
    date_from: date,
    date_to: date | None,
    branch_id: uuid.UUID | None,
    employee_id: uuid.UUID | None,
    max_horizon_days: int,
    ignore_appointment_id: uuid.UUID | None = None,
) -> s.AvailabilityOut:
    date_to = date_to or date_from
    if date_to < date_from:
        raise ValidationFailed('Конец периода раньше начала', fields={'date_to': 'range'})
    span = (date_to - date_from).days
    if span > max_horizon_days:
        raise ValidationFailed(
            f'Период не может превышать {max_horizon_days} дней', fields={'date_to': 'too_wide'},
        )

    branch = (
        await session.get(Branch, branch_id) if branch_id
        else await _primary_branch(session, company.id)
    )
    if branch is None or branch.company_id != company.id or branch.status != BranchStatus.ACTIVE:
        raise NotFound('Филиал')

    candidates = await slot_engine.eligible_employees(session, company.id, branch.id, service_ids)
    if employee_id is not None:
        candidates = [e for e in candidates if e.id == employee_id]
        if not candidates:
            raise NotFound('Сотрудник')
    if not candidates:
        shape_only = await slot_engine.resolve_services(session, company.id, service_ids)
        return s.AvailabilityOut(
            branch_id=branch.id, timezone=branch.timezone,
            duration_minutes=shape_only.duration_minutes,
            price_minor=shape_only.price_minor,
            currency_code=shape_only.services[0].currency_code,
            days=[],
        )

    shape = await slot_engine.resolve_services(
        session, company.id, service_ids, candidates[0].id if len(candidates) == 1 else None,
    )

    from app.services.timeutils import end_of_local_day, start_of_local_day

    window_start = start_of_local_day(date_from, branch.timezone) - timedelta(days=1)
    window_end = end_of_local_day(date_to, branch.timezone) + timedelta(days=1)
    ctx = await slot_engine.load_context(
        session, company, branch, candidates, window_start, window_end,
        ignore_appointment_id=ignore_appointment_id,
    )

    found = slot_engine.compute_slots(
        ctx, shape, date_from, date_to,
        step_minutes=int(company.setting('slot_step_minutes', settings.slot_step_minutes)),
        lead_time_minutes=int(company.setting('lead_time_minutes', settings.booking_lead_time_minutes)),
        horizon_days=int(company.setting('booking_horizon_days', settings.booking_horizon_days)),
        secret=settings.session_secret or settings.telegram_bot_token,
        now=utcnow(),
    )

    return s.AvailabilityOut(
        branch_id=branch.id,
        timezone=branch.timezone,
        duration_minutes=shape.duration_minutes,
        price_minor=shape.price_minor,
        currency_code=shape.services[0].currency_code,
        days=[
            s.DaySlotsOut(date=group['date'], slots=[s.SlotOut.model_validate(x) for x in group['slots']])
            for group in slot_engine.group_by_day(found)
        ],
    )


@router.get('/companies/{slug}/reviews', response_model=list[s.ReviewOut])
async def company_reviews(
    company: PublicCompany,
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[s.ReviewOut]:
    rows = (await session.execute(
        select(Review)
        .where(Review.company_id == company.id, Review.status == ReviewStatus.PUBLISHED)
        .order_by(Review.created_at.desc())
        .limit(limit)
    )).scalars().all()
    # Имя клиента наружу не отдаём: публичная страница — не место для PII.
    return [
        s.ReviewOut(
            id=r.id, appointment_id=r.appointment_id, rating=r.rating, comment=r.comment,
            status=r.status, reply_body=r.reply_body, created_at=r.created_at,
        )
        for r in rows
    ]
