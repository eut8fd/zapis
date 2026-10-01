"""
Компания, филиалы, услуги и команда (ТЗ 8.2–8.4, 12.4).

Каждый обработчик объявляет нужное право через зависимость. Проверка идёт
на сервере независимо от того, показала кнопку клиентская часть или нет.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import func, select

from app.api.deps import (
    AppSettings, CurrentUser, DbSession, TenantContext, require_permission,
)
from app.api.v1 import schemas as s
from app.core import idempotency
from app.core.errors import BusinessRuleViolation, NotFound, ValidationFailed
from app.db.models import (
    Appointment, Branch, Company, Employee, EmployeeBranch, EmployeeService, Membership,
    Service, ServiceCategory, UserConsent,
)
from app.db.types import new_uuid, utcnow
from app.domain import (
    BLOCKING_APPOINTMENT_STATUSES, BranchStatus, CompanyRole, CompanyStatus, MembershipStatus,
    Permission,
)
from app.services import audit, auth as auth_service, entitlements
from app.services.timeutils import zone
from app.utils.phone import normalize_phone
from app.utils.text import clean, slugify

router = APIRouter(tags=['company'])


async def _unique_slug(session, base: str) -> str:
    slug = slugify(base)
    candidate = slug
    suffix = 2
    while await session.scalar(select(func.count()).select_from(Company).where(Company.slug == candidate)):
        candidate = f'{slug}-{suffix}'
        suffix += 1
        if suffix > 200:
            candidate = f'{slug}-{uuid.uuid4().hex[:6]}'
            break
    return candidate


@router.post('/companies', response_model=s.CompanyOut, status_code=status.HTTP_201_CREATED)
async def create_company(
    payload: s.CompanyCreateIn,
    principal: CurrentUser,
    session: DbSession,
    idempotency_key: Annotated[str | None, Header(alias='Idempotency-Key')] = None,
) -> s.CompanyOut:
    """
    ТЗ 7.3: компания, первый филиал и membership владельца создаются одной
    транзакцией. Половинчатого состояния «компания есть, владельца нет»
    существовать не должно.
    """
    zone(payload.timezone)                     # падает 422, если зона неизвестна

    scope = idempotency.scope_for('company.create', principal.user.id)
    if idempotency_key:
        cached = await idempotency.begin(session, scope, idempotency_key, payload.model_dump())
        if cached:
            await session.commit()
            return s.CompanyOut(**cached)

    now = utcnow()
    company = Company(
        id=new_uuid(),
        name=clean(payload.name, max_length=160),
        slug=await _unique_slug(session, payload.name),
        category=payload.category,
        status=CompanyStatus.DRAFT,
        default_locale=payload.default_locale,
        currency_code=payload.currency_code.upper(),
        owner_user_id=principal.user.id,
        settings={
            'legal': {
                'terms_version': payload.accepted_terms_version,
                'privacy_version': payload.accepted_privacy_version,
                'accepted_at': now.isoformat(),
            },
        },
        created_at=now, updated_at=now,
    )
    session.add(company)
    await session.flush()

    branch = Branch(
        id=new_uuid(),
        company_id=company.id,
        name=company.name,
        slug='main',
        address=clean(payload.address, max_length=255),
        city=clean(payload.city, max_length=80),
        phone=normalize_phone(payload.phone),
        timezone=payload.timezone,
        status=BranchStatus.ACTIVE,
        created_at=now, updated_at=now,
    )
    session.add(branch)

    membership = Membership(
        id=new_uuid(),
        company_id=company.id,
        user_id=principal.user.id,
        role=CompanyRole.OWNER,
        status=MembershipStatus.ACTIVE,
        permissions=[],
        created_at=now,
        activated_at=now,
    )
    session.add(membership)

    session.add(UserConsent(
        id=new_uuid(), user_id=principal.user.id, kind='company_terms',
        document_version=payload.accepted_terms_version, granted=True,
        source='company_registration', created_at=now,
    ))

    await entitlements.start_trial(session, company)
    await audit.record(
        session, audit.AuditAction.COMPANY_CREATED,
        company_id=company.id, target_type='company', target_id=company.id,
        after={'name': company.name, 'slug': company.slug},
    )

    result = s.CompanyOut.model_validate(company)
    if idempotency_key:
        await idempotency.finish(session, scope, idempotency_key, 201, result.model_dump())
    await session.commit()
    return result


@router.get('/companies/{company_id}', response_model=s.CompanyOut)
async def get_company(
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.COMPANY_SETTINGS_READ))],
) -> s.CompanyOut:
    return s.CompanyOut.model_validate(tenant.company)


@router.patch('/companies/{company_id}', response_model=s.CompanyOut)
async def update_company(
    payload: s.CompanyUpdateIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.COMPANY_SETTINGS_WRITE))],
) -> s.CompanyOut:
    company = tenant.company
    before = {'name': company.name, 'category': company.category}

    if payload.name is not None:
        company.name = clean(payload.name, max_length=160)
    if payload.category is not None:
        company.category = payload.category
    if payload.description is not None:
        company.description = clean(payload.description, max_length=2000)
    if payload.default_locale is not None:
        company.default_locale = payload.default_locale
    if payload.currency_code is not None:
        company.currency_code = payload.currency_code.upper()
    if payload.settings is not None:
        company.settings = _merge_settings(company.settings, payload.settings)
    company.updated_at = utcnow()

    await audit.record(
        session, audit.AuditAction.COMPANY_UPDATED,
        company_id=company.id, target_type='company', target_id=company.id,
        before=before, after={'name': company.name, 'category': company.category},
    )
    await session.commit()
    return s.CompanyOut.model_validate(company)


#: Настройки, которые компания может менять сама. Всё остальное в JSON
#: приходит от платформы и через PATCH не переписывается.
ALLOWED_SETTINGS = frozenset({
    'slot_step_minutes', 'lead_time_minutes', 'booking_horizon_days',
    'cancellation_deadline_hours', 'reminders_minutes', 'require_prepayment',
    'auto_confirm', 'public_phone', 'social_links', 'about',
})


def _merge_settings(current: dict, incoming: dict) -> dict:
    merged = dict(current or {})
    for key, value in incoming.items():
        if key in ALLOWED_SETTINGS:
            merged[key] = value
    return merged


def _publish_blockers(company: Company, branch: Branch | None, services: int, staff: int) -> list[str]:
    """COM-004/CAT-004: чек-лист публикации считает сервер, а не интерфейс."""
    missing: list[str] = []
    if not company.description:
        missing.append('description')
    if branch is None:
        missing.append('branch')
    else:
        if not branch.address:
            missing.append('branch.address')
        if not branch.phone:
            missing.append('branch.phone')
        if not branch.city:
            missing.append('branch.city')
    if services < 1:
        missing.append('services')
    if staff < 1:
        missing.append('staff')
    return missing


@router.get('/companies/{company_id}/publish-check', response_model=s.PublishCheckOut)
async def publish_check(
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.COMPANY_SETTINGS_READ))],
) -> s.PublishCheckOut:
    missing = await _collect_blockers(session, tenant.company)
    return s.PublishCheckOut(ready=not missing, missing=missing)


async def _collect_blockers(session, company: Company) -> list[str]:
    branch = await session.scalar(
        select(Branch).where(Branch.company_id == company.id, Branch.status == BranchStatus.ACTIVE)
        .order_by(Branch.sort_order).limit(1)
    )
    services = int(await session.scalar(
        select(func.count()).select_from(Service).where(
            Service.company_id == company.id, Service.active.is_(True), Service.public.is_(True),
        )
    ) or 0)
    staff = int(await session.scalar(
        select(func.count()).select_from(Employee).where(
            Employee.company_id == company.id, Employee.active.is_(True),
            Employee.takes_appointments.is_(True),
        )
    ) or 0)
    return _publish_blockers(company, branch, services, staff)


@router.post('/companies/{company_id}/publish', response_model=s.CompanyOut)
async def publish_company(
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.COMPANY_SETTINGS_WRITE))],
) -> s.CompanyOut:
    company = tenant.company
    if company.status == CompanyStatus.SUSPENDED:
        raise BusinessRuleViolation('Компания заблокирована, обратитесь в поддержку')

    missing = await _collect_blockers(session, company)
    if missing:
        raise ValidationFailed(
            'Заполните обязательные данные перед публикацией',
            fields={item: 'required' for item in missing},
        )

    company.status = CompanyStatus.PUBLISHED
    company.published_at = company.published_at or utcnow()
    company.updated_at = utcnow()
    await audit.record(
        session, audit.AuditAction.COMPANY_PUBLISHED,
        company_id=company.id, target_type='company', target_id=company.id,
        after={'status': company.status},
    )
    await session.commit()
    return s.CompanyOut.model_validate(company)


@router.get('/companies/{company_id}/usage')
async def usage(
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.COMPANY_SETTINGS_READ))],
) -> dict:
    return await entitlements.usage_report(session, tenant.company.id)


# ------------------------------------------------------------------ филиалы

@router.get('/companies/{company_id}/branches', response_model=list[s.BranchOut])
async def list_branches(
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.COMPANY_SETTINGS_READ))],
) -> list[s.BranchOut]:
    rows = (await session.execute(
        select(Branch).where(Branch.company_id == tenant.company.id).order_by(Branch.sort_order)
    )).scalars().all()
    return [s.BranchOut.model_validate(b) for b in rows]


@router.post('/companies/{company_id}/branches', response_model=s.BranchOut,
             status_code=status.HTTP_201_CREATED)
async def create_branch(
    payload: s.BranchIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.COMPANY_SETTINGS_WRITE))],
) -> s.BranchOut:
    zone(payload.timezone)
    await entitlements.require_capacity(session, tenant.company.id, entitlements.Key.MAX_BRANCHES)

    now = utcnow()
    branch = Branch(
        id=new_uuid(),
        company_id=tenant.company.id,
        name=clean(payload.name, max_length=160),
        slug=slugify(payload.name, max_length=40),
        address=clean(payload.address, max_length=255),
        city=clean(payload.city, max_length=80),
        phone=normalize_phone(payload.phone),
        email=clean(payload.email, max_length=160),
        timezone=payload.timezone,
        latitude=payload.latitude,
        longitude=payload.longitude,
        status=BranchStatus.ACTIVE,
        created_at=now, updated_at=now,
    )
    session.add(branch)
    await audit.record(
        session, audit.AuditAction.BRANCH_CREATED,
        company_id=tenant.company.id, target_type='branch', target_id=branch.id,
        after={'name': branch.name},
    )
    await session.commit()
    return s.BranchOut.model_validate(branch)


@router.patch('/companies/{company_id}/branches/{branch_id}', response_model=s.BranchOut)
async def update_branch(
    branch_id: uuid.UUID,
    payload: s.BranchIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.COMPANY_SETTINGS_WRITE))],
) -> s.BranchOut:
    branch = await session.get(Branch, branch_id)
    if branch is None or branch.company_id != tenant.company.id:
        raise NotFound('Филиал')
    zone(payload.timezone)

    before = {'timezone': branch.timezone, 'address': branch.address}
    branch.name = clean(payload.name, max_length=160)
    branch.address = clean(payload.address, max_length=255)
    branch.city = clean(payload.city, max_length=80)
    branch.phone = normalize_phone(payload.phone)
    branch.email = clean(payload.email, max_length=160)
    branch.timezone = payload.timezone
    branch.latitude = payload.latitude
    branch.longitude = payload.longitude
    branch.updated_at = utcnow()

    await audit.record(
        session, audit.AuditAction.BRANCH_UPDATED,
        company_id=tenant.company.id, target_type='branch', target_id=branch.id,
        before=before, after={'timezone': branch.timezone, 'address': branch.address},
    )
    await session.commit()
    return s.BranchOut.model_validate(branch)


# -------------------------------------------------------------------- услуги

async def _service_employee_ids(session, service_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    if not service_ids:
        return {}
    rows = (await session.execute(
        select(EmployeeService.service_id, EmployeeService.employee_id)
        .where(EmployeeService.service_id.in_(service_ids))
    )).all()
    out: dict[uuid.UUID, list[uuid.UUID]] = {}
    for service_id, employee_id in rows:
        out.setdefault(service_id, []).append(employee_id)
    return out


@router.get('/companies/{company_id}/services', response_model=list[s.ServiceOut])
async def list_services(
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.SERVICES_READ))],
    include_inactive: Annotated[bool, Query()] = False,
) -> list[s.ServiceOut]:
    stmt = select(Service).where(Service.company_id == tenant.company.id)
    if not include_inactive:
        stmt = stmt.where(Service.active.is_(True))
    rows = list((await session.execute(stmt.order_by(Service.sort_order, Service.name))).scalars().all())

    links = await _service_employee_ids(session, [r.id for r in rows])
    return [
        s.ServiceOut(**s.ServiceOut.model_validate(row).model_dump(exclude={'employee_ids'}),
                     employee_ids=links.get(row.id, []))
        for row in rows
    ]


async def _assign_service_employees(
    session, company_id: uuid.UUID, service_id: uuid.UUID, employee_ids: list[uuid.UUID],
) -> None:
    """SVC-004: связь явная. Присланные чужие сотрудники отбрасываются."""
    valid = set((await session.execute(
        select(Employee.id).where(
            Employee.company_id == company_id, Employee.id.in_(employee_ids or []),
        )
    )).scalars().all())

    existing = {
        link.employee_id: link for link in (await session.execute(
            select(EmployeeService).where(EmployeeService.service_id == service_id)
        )).scalars().all()
    }
    for employee_id in valid - set(existing):
        session.add(EmployeeService(
            id=new_uuid(), company_id=company_id,
            employee_id=employee_id, service_id=service_id,
        ))
    for employee_id in set(existing) - valid:
        await session.delete(existing[employee_id])


@router.post('/companies/{company_id}/services', response_model=s.ServiceOut,
             status_code=status.HTTP_201_CREATED)
async def create_service(
    payload: s.ServiceIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.SERVICES_WRITE))],
) -> s.ServiceOut:
    # SVC-007: лимит тарифа проверяется в той же транзакции, что и вставка.
    await entitlements.require_capacity(session, tenant.company.id, entitlements.Key.MAX_SERVICES)

    now = utcnow()
    service = Service(
        id=new_uuid(),
        company_id=tenant.company.id,
        branch_id=payload.branch_id,
        category_id=payload.category_id,
        name=clean(payload.name, max_length=160),
        description=clean(payload.description, max_length=2000),
        price_minor=payload.price_minor,
        currency_code=tenant.company.currency_code,
        duration_minutes=payload.duration_minutes,
        buffer_before_minutes=payload.buffer_before_minutes,
        buffer_after_minutes=payload.buffer_after_minutes,
        active=True,
        public=payload.public,
        color=payload.color,
        created_at=now, updated_at=now,
    )
    session.add(service)
    await session.flush()
    await _assign_service_employees(session, tenant.company.id, service.id, payload.employee_ids)

    await audit.record(
        session, audit.AuditAction.SERVICE_CREATED,
        company_id=tenant.company.id, target_type='service', target_id=service.id,
        after={'name': service.name, 'price_minor': service.price_minor},
    )
    await session.commit()
    return s.ServiceOut(
        **s.ServiceOut.model_validate(service).model_dump(exclude={'employee_ids'}),
        employee_ids=payload.employee_ids,
    )


@router.patch('/companies/{company_id}/services/{service_id}', response_model=s.ServiceOut)
async def update_service(
    service_id: uuid.UUID,
    payload: s.ServiceUpdateIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.SERVICES_WRITE))],
) -> s.ServiceOut:
    service = await session.get(Service, service_id)
    if service is None or service.company_id != tenant.company.id:
        raise NotFound('Услуга')

    before = {'price_minor': service.price_minor, 'duration_minutes': service.duration_minutes,
              'active': service.active}
    data = payload.model_dump(exclude_unset=True, exclude={'employee_ids'})
    for field, value in data.items():
        if value is None and field in ('price_minor', 'duration_minutes'):
            continue
        setattr(service, field, clean(value, max_length=2000) if isinstance(value, str) else value)

    if payload.active is False:
        # SVC-005: деактивация не ломает историю — прошлые записи держат снимок.
        service.active = False
    service.updated_at = utcnow()

    if payload.employee_ids is not None:
        await _assign_service_employees(session, tenant.company.id, service.id, payload.employee_ids)

    await audit.record(
        session,
        audit.AuditAction.SERVICE_DEACTIVATED if payload.active is False
        else audit.AuditAction.SERVICE_UPDATED,
        company_id=tenant.company.id, target_type='service', target_id=service.id,
        before=before,
        after={'price_minor': service.price_minor, 'duration_minutes': service.duration_minutes,
               'active': service.active},
    )
    await session.commit()

    links = await _service_employee_ids(session, [service.id])
    return s.ServiceOut(
        **s.ServiceOut.model_validate(service).model_dump(exclude={'employee_ids'}),
        employee_ids=links.get(service.id, []),
    )


@router.get('/companies/{company_id}/service-categories', response_model=list[s.ServiceCategoryOut])
async def list_categories(
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.SERVICES_READ))],
) -> list[s.ServiceCategoryOut]:
    rows = (await session.execute(
        select(ServiceCategory)
        .where(ServiceCategory.company_id == tenant.company.id, ServiceCategory.active.is_(True))
        .order_by(ServiceCategory.sort_order, ServiceCategory.name)
    )).scalars().all()
    return [s.ServiceCategoryOut.model_validate(row) for row in rows]


@router.post('/companies/{company_id}/service-categories', response_model=s.ServiceCategoryOut,
             status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: s.ServiceCategoryIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.SERVICES_WRITE))],
) -> s.ServiceCategoryOut:
    now = utcnow()
    category = ServiceCategory(
        id=new_uuid(), company_id=tenant.company.id,
        name=clean(payload.name, max_length=120), color=payload.color,
        sort_order=payload.sort_order, active=True, created_at=now, updated_at=now,
    )
    session.add(category)
    await session.commit()
    return s.ServiceCategoryOut.model_validate(category)


# ------------------------------------------------------------------- команда

async def _employee_links(session, employee_ids: list[uuid.UUID]) -> tuple[dict, dict]:
    if not employee_ids:
        return {}, {}
    branches = (await session.execute(
        select(EmployeeBranch.employee_id, EmployeeBranch.branch_id)
        .where(EmployeeBranch.employee_id.in_(employee_ids))
    )).all()
    services = (await session.execute(
        select(EmployeeService.employee_id, EmployeeService.service_id)
        .where(EmployeeService.employee_id.in_(employee_ids))
    )).all()

    by_branch: dict[uuid.UUID, list[uuid.UUID]] = {}
    for employee_id, branch_id in branches:
        by_branch.setdefault(employee_id, []).append(branch_id)
    by_service: dict[uuid.UUID, list[uuid.UUID]] = {}
    for employee_id, service_id in services:
        by_service.setdefault(employee_id, []).append(service_id)
    return by_branch, by_service


async def _serialize_employees(session, company_id: uuid.UUID, rows: list[Employee]) -> list[s.EmployeeOut]:
    by_branch, by_service = await _employee_links(session, [r.id for r in rows])
    memberships = {
        m.employee_id: m for m in (await session.execute(
            select(Membership).where(
                Membership.company_id == company_id,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )).scalars().all() if m.employee_id
    }
    out: list[s.EmployeeOut] = []
    for row in rows:
        membership = memberships.get(row.id)
        out.append(s.EmployeeOut(
            id=row.id, user_id=row.user_id, display_name=row.display_name,
            role_title=row.role_title, phone=row.phone, bio=row.bio,
            takes_appointments=row.takes_appointments, active=row.active, public=row.public,
            rating=row.rating,
            branch_ids=by_branch.get(row.id, []), service_ids=by_service.get(row.id, []),
            role=membership.role if membership else None,
            has_access=membership is not None,
        ))
    return out


@router.get('/companies/{company_id}/employees', response_model=list[s.EmployeeOut])
async def list_employees(
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.TEAM_READ))],
    include_inactive: Annotated[bool, Query()] = False,
) -> list[s.EmployeeOut]:
    stmt = select(Employee).where(Employee.company_id == tenant.company.id)
    if not include_inactive:
        stmt = stmt.where(Employee.active.is_(True))
    rows = list((await session.execute(
        stmt.order_by(Employee.sort_order, Employee.display_name)
    )).scalars().all())
    return await _serialize_employees(session, tenant.company.id, rows)


async def _assign_employee_links(
    session, company_id: uuid.UUID, employee_id: uuid.UUID,
    branch_ids: list[uuid.UUID] | None, service_ids: list[uuid.UUID] | None,
) -> None:
    if branch_ids is not None:
        valid = set((await session.execute(
            select(Branch.id).where(Branch.company_id == company_id, Branch.id.in_(branch_ids))
        )).scalars().all())
        existing = {
            link.branch_id: link for link in (await session.execute(
                select(EmployeeBranch).where(EmployeeBranch.employee_id == employee_id)
            )).scalars().all()
        }
        for branch_id in valid - set(existing):
            session.add(EmployeeBranch(
                id=new_uuid(), company_id=company_id,
                employee_id=employee_id, branch_id=branch_id,
            ))
        for branch_id in set(existing) - valid:
            await session.delete(existing[branch_id])

    if service_ids is not None:
        valid = set((await session.execute(
            select(Service.id).where(Service.company_id == company_id, Service.id.in_(service_ids))
        )).scalars().all())
        existing = {
            link.service_id: link for link in (await session.execute(
                select(EmployeeService).where(EmployeeService.employee_id == employee_id)
            )).scalars().all()
        }
        for service_id in valid - set(existing):
            session.add(EmployeeService(
                id=new_uuid(), company_id=company_id,
                employee_id=employee_id, service_id=service_id,
            ))
        for service_id in set(existing) - valid:
            await session.delete(existing[service_id])


@router.post('/companies/{company_id}/employees', response_model=s.EmployeeOut,
             status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: s.EmployeeIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.TEAM_INVITE))],
) -> s.EmployeeOut:
    await entitlements.require_capacity(session, tenant.company.id, entitlements.Key.MAX_EMPLOYEES)

    now = utcnow()
    employee = Employee(
        id=new_uuid(),
        company_id=tenant.company.id,
        display_name=clean(payload.display_name, max_length=160),
        role_title=clean(payload.role_title, max_length=120),
        phone=normalize_phone(payload.phone),
        bio=clean(payload.bio, max_length=2000),
        takes_appointments=payload.takes_appointments,
        active=True, public=True,
        created_at=now, updated_at=now,
    )
    session.add(employee)
    await session.flush()

    branch_ids = payload.branch_ids
    if not branch_ids:
        # Без филиала мастер не появится ни в одной выдаче слотов —
        # по умолчанию цепляем к первому активному.
        default_branch = await session.scalar(
            select(Branch.id).where(
                Branch.company_id == tenant.company.id, Branch.status == BranchStatus.ACTIVE,
            ).order_by(Branch.sort_order).limit(1)
        )
        branch_ids = [default_branch] if default_branch else []

    await _assign_employee_links(
        session, tenant.company.id, employee.id, branch_ids, payload.service_ids,
    )
    await audit.record(
        session, audit.AuditAction.EMPLOYEE_CREATED,
        company_id=tenant.company.id, target_type='employee', target_id=employee.id,
        after={'display_name': employee.display_name},
    )
    await session.commit()
    return (await _serialize_employees(session, tenant.company.id, [employee]))[0]


@router.patch('/companies/{company_id}/employees/{employee_id}', response_model=s.EmployeeOut)
async def update_employee(
    employee_id: uuid.UUID,
    payload: s.EmployeeUpdateIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.TEAM_READ))],
) -> s.EmployeeOut:
    employee = await session.get(Employee, employee_id)
    if employee is None or employee.company_id != tenant.company.id:
        raise NotFound('Сотрудник')

    # Свой профиль правит любой сотрудник; чужой — только с правом на команду.
    own = tenant.employee_id == employee.id
    if not own:
        tenant.require(Permission.TEAM_MANAGE_ROLES)

    before = {'display_name': employee.display_name, 'active': employee.active}
    for field in ('display_name', 'role_title', 'bio'):
        value = getattr(payload, field)
        if value is not None:
            setattr(employee, field, clean(value, max_length=2000))
    if payload.phone is not None:
        employee.phone = normalize_phone(payload.phone)
    for field in ('takes_appointments', 'public'):
        value = getattr(payload, field)
        if value is not None:
            setattr(employee, field, value)
    if payload.active is not None and not own:
        employee.active = payload.active
    employee.updated_at = utcnow()

    if payload.branch_ids is not None or payload.service_ids is not None:
        if not own:
            tenant.require(Permission.TEAM_MANAGE_ROLES)
        await _assign_employee_links(
            session, tenant.company.id, employee.id, payload.branch_ids, payload.service_ids,
        )

    await audit.record(
        session, audit.AuditAction.EMPLOYEE_UPDATED,
        company_id=tenant.company.id, target_type='employee', target_id=employee.id,
        before=before, after={'display_name': employee.display_name, 'active': employee.active},
    )
    await session.commit()
    return (await _serialize_employees(session, tenant.company.id, [employee]))[0]


@router.post('/companies/{company_id}/employees/{employee_id}/terminate',
             response_model=s.TerminateOut)
async def terminate_employee(
    employee_id: uuid.UUID,
    payload: s.TerminateIn,
    session: DbSession,
    settings: AppSettings,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.TEAM_TERMINATE))],
) -> s.TerminateOut:
    """
    TEAM-005/006: увольнение закрывает доступ и обязательно решает судьбу
    будущих записей. Просто «выключить» сотрудника с чужими бронями нельзя.
    """
    employee = await session.get(Employee, employee_id)
    if employee is None or employee.company_id != tenant.company.id:
        raise NotFound('Сотрудник')

    membership = await session.scalar(
        select(Membership).where(
            Membership.company_id == tenant.company.id,
            Membership.employee_id == employee.id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    if membership is not None and membership.role == CompanyRole.OWNER:
        raise BusinessRuleViolation('Владельца компании нельзя уволить')

    now = utcnow()
    future = list((await session.execute(
        select(Appointment).where(
            Appointment.company_id == tenant.company.id,
            Appointment.employee_id == employee.id,
            Appointment.status.in_(list(BLOCKING_APPOINTMENT_STATUSES)),
            Appointment.starts_at > now,
        )
    )).scalars().all())

    if payload.future_appointments == 'reassign':
        if payload.reassign_to_employee_id is None:
            raise ValidationFailed(
                'Укажите, кому передать записи',
                fields={'reassign_to_employee_id': 'required'},
            )
        target = await session.get(Employee, payload.reassign_to_employee_id)
        if target is None or target.company_id != tenant.company.id or not target.active:
            raise NotFound('Сотрудник для переноса записей')
        from app.services import booking as booking_service
        for appointment in future:
            await booking_service.reschedule(
                session, appointment, settings,
                starts_at=appointment.service_starts_at,
                employee_id=target.id, staff=True, reason='employee_terminated',
            )
    elif payload.future_appointments == 'cancel':
        from app.services import booking as booking_service
        for appointment in future:
            await booking_service.cancel(
                session, appointment, by_client=False, reason=payload.reason,
                actor_user_id=tenant.principal.user.id, enforce_deadline=False,
            )
    elif future:
        raise ValidationFailed(
            'У сотрудника есть будущие записи — выберите, что с ними делать',
            fields={'future_appointments': 'pending', 'count': str(len(future))},
        )

    employee.active = False
    employee.takes_appointments = False
    employee.updated_at = now

    if membership is not None:
        membership.status = MembershipStatus.TERMINATED
        membership.terminated_at = now
        membership.terminated_reason = payload.reason
        # AUTH-009: доступ пропадает сразу, а не когда истечёт токен.
        await auth_service.revoke_all_sessions(session, membership.user_id, reason='terminated')

    await audit.record(
        session, audit.AuditAction.EMPLOYEE_TERMINATED,
        company_id=tenant.company.id, target_type='employee', target_id=employee.id,
        reason=payload.reason,
        after={'future_appointments': payload.future_appointments, 'affected': len(future)},
    )
    await session.commit()
    return s.TerminateOut(
        employee_id=employee.id,
        future_appointments_affected=len(future),
        action=payload.future_appointments,
    )


@router.post('/companies/{company_id}/memberships/{membership_id}/role', response_model=s.OkOut)
async def change_role(
    membership_id: uuid.UUID,
    role: Annotated[str, Query(pattern='^(manager|master)$')],
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.TEAM_MANAGE_ROLES))],
) -> s.OkOut:
    membership = await session.get(Membership, membership_id)
    if membership is None or membership.company_id != tenant.company.id:
        raise NotFound('Участник команды')
    if membership.role == CompanyRole.OWNER:
        raise BusinessRuleViolation('Роль владельца изменить нельзя')

    before = {'role': membership.role}
    membership.role = role
    membership.permissions = []
    # AUTH-009: новая роль действует немедленно, а не после истечения токена.
    await auth_service.revoke_all_sessions(session, membership.user_id, reason='role_changed')

    await audit.record(
        session, audit.AuditAction.MEMBERSHIP_ROLE_CHANGED,
        company_id=tenant.company.id, target_type='membership', target_id=membership.id,
        before=before, after={'role': role},
    )
    await session.commit()
    return s.OkOut()
