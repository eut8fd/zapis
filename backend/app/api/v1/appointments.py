"""
Записи (ТЗ 8.6, 12.5).

Два входа с разными правилами:
- клиент записывает себя сам — `POST /companies/{id}/appointments/self`;
- сотрудник заводит запись для клиента — `POST /companies/{id}/appointments`.

Оба идут через один booking service, поэтому проверка занятости, снимок
цены и события истории у них одинаковые.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import select

from app.api.deps import (
    AppSettings, ClientBooking, CurrentUser, DbSession, Tenant, TenantContext,
    require_permission,
)
from app.api.v1 import schemas as s
from app.api.v1.auth import serialize_appointment
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.db.models import Appointment, AppointmentEvent, Branch, Client, Company
from app.db.types import new_uuid, utcnow
from app.domain import (
    AppointmentSource, BLOCKING_APPOINTMENT_STATUSES, ClientStatus, ConsentStatus, Permission,
)
from app.services import booking as booking_service
from app.services.timeutils import end_of_local_day, start_of_local_day
from app.utils.phone import normalize_phone
from app.utils.text import clean

router = APIRouter(tags=['appointments'])


async def _client_for_user(
    session, company: Company, user, *, create: bool,
) -> Client | None:
    """
    ТЗ 7.1, шаги 4–5: карточка клиента ищется по подтверждённому user_id в
    рамках компании. Новая создаётся только при осмысленном действии —
    и никогда не подхватывает чужую по совпадению имени или телефона.
    """
    client = await session.scalar(
        select(Client).where(Client.company_id == company.id, Client.user_id == user.id)
    )
    if client is not None or not create:
        return client

    now = utcnow()
    client = Client(
        id=new_uuid(),
        company_id=company.id,
        user_id=user.id,
        display_name=user.display_name,
        phone_normalized=user.phone,
        telegram_username=user.username,
        source='miniapp',
        status=ClientStatus.ACTIVE,
        consent_status=ConsentStatus.UNKNOWN,
        created_at=now, updated_at=now,
    )
    session.add(client)
    await session.flush()
    return client


@router.post('/companies/{company_id}/appointments/self', response_model=s.AppointmentOut,
             status_code=status.HTTP_201_CREATED)
async def create_own_appointment(
    payload: s.AppointmentCreateIn,
    session: DbSession,
    settings: AppSettings,
    principal: CurrentUser,
    context: ClientBooking,
    idempotency_key: Annotated[str | None, Header(alias='Idempotency-Key')] = None,
) -> s.AppointmentOut:
    """
    Клиент записывает себя. Членства в компании у него нет и не появляется:
    контекст подтверждает только то, что компания принимает записи.
    """
    company = context.company
    branch = await session.get(Branch, payload.branch_id)
    if branch is None or branch.company_id != company.id:
        raise NotFound('Филиал')

    client = await _client_for_user(session, company, principal.user, create=True)

    request = booking_service.BookingRequest(
        company=company,
        branch=branch,
        client=client,
        employee_id=payload.employee_id,
        service_ids=payload.service_ids,
        starts_at=payload.starts_at,
        source=AppointmentSource.CLIENT_APP,
        client_comment=clean(payload.client_comment, max_length=1000),
        idempotency_key=idempotency_key,
        availability_token=payload.availability_token,
        created_by_user_id=principal.user.id,
        requires_prepayment=bool(company.setting('require_prepayment', False)),
    )
    result = await booking_service.create_appointment(session, request, settings)
    await session.commit()
    await session.refresh(result.appointment)
    return await serialize_appointment(session, result.appointment, for_client=True)


@router.post('/companies/{company_id}/appointments', response_model=s.AppointmentOut,
             status_code=status.HTTP_201_CREATED)
async def create_staff_appointment(
    payload: s.StaffAppointmentCreateIn,
    session: DbSession,
    settings: AppSettings,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.APPOINTMENTS_CREATE))],
    idempotency_key: Annotated[str | None, Header(alias='Idempotency-Key')] = None,
) -> s.AppointmentOut:
    """ТЗ 7.5: сотрудник заводит запись — с поиском клиента или созданием нового."""
    if not tenant.entitled:
        from app.core.errors import SubscriptionInactive
        raise SubscriptionInactive()

    company = tenant.company
    branch = await session.get(Branch, payload.branch_id)
    if branch is None or branch.company_id != company.id:
        raise NotFound('Филиал')

    # Мастер без права на общий календарь заводит записи только себе.
    if not tenant.has(Permission.CALENDAR_ALL_READ) and tenant.employee_id:
        if payload.employee_id != tenant.employee_id:
            raise Forbidden('Можно создавать записи только в своём календаре')

    if payload.client_id is not None:
        client = await session.get(Client, payload.client_id)
        if client is None or client.company_id != company.id:
            raise NotFound('Клиент')
    else:
        if not payload.new_client_name:
            raise ValidationFailed(
                'Выберите клиента или укажите имя нового',
                fields={'client_id': 'required', 'new_client_name': 'required'},
            )
        tenant.require(Permission.CLIENTS_WRITE)
        now = utcnow()
        client = Client(
            id=new_uuid(),
            company_id=company.id,
            display_name=clean(payload.new_client_name, max_length=160),
            phone_normalized=normalize_phone(payload.new_client_phone),
            phone_raw=payload.new_client_phone,
            source='staff',
            status=ClientStatus.ACTIVE,
            consent_status=ConsentStatus.UNKNOWN,
            created_at=now, updated_at=now,
        )
        session.add(client)
        await session.flush()

    request = booking_service.BookingRequest(
        company=company,
        branch=branch,
        client=client,
        employee_id=payload.employee_id,
        service_ids=payload.service_ids,
        starts_at=payload.starts_at,
        source=AppointmentSource.STAFF,
        client_comment=clean(payload.client_comment, max_length=1000),
        internal_note=clean(payload.internal_note, max_length=1000),
        idempotency_key=idempotency_key,
        created_by_user_id=tenant.principal.user.id,
    )
    result = await booking_service.create_appointment(session, request, settings)
    await session.commit()
    await session.refresh(result.appointment)
    return await serialize_appointment(session, result.appointment, for_client=False)


@router.get('/companies/{company_id}/appointments', response_model=list[s.AppointmentOut])
async def list_appointments(
    session: DbSession,
    tenant: Tenant,
    date_from: Annotated[date, Query()],
    date_to: Annotated[date | None, Query()] = None,
    employee_id: Annotated[uuid.UUID | None, Query()] = None,
    client_id: Annotated[uuid.UUID | None, Query()] = None,
    include_cancelled: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 300,
) -> list[s.AppointmentOut]:
    """
    Календарь компании. APT-008: мастер без права на общий календарь видит
    только свои записи — фильтр ставит сервер, а не интерфейс.
    """
    if not tenant.has(Permission.CALENDAR_ALL_READ) and not tenant.has(Permission.CALENDAR_OWN_READ):
        raise Forbidden('Календарь недоступен')

    branch = await session.scalar(
        select(Branch).where(Branch.company_id == tenant.company.id)
        .order_by(Branch.sort_order).limit(1)
    )
    tz_name = branch.timezone if branch else 'UTC'
    date_to = date_to or date_from
    if (date_to - date_from).days > 62:
        raise ValidationFailed('Период не может превышать 62 дня', fields={'date_to': 'too_wide'})

    stmt = select(Appointment).where(
        Appointment.company_id == tenant.company.id,
        Appointment.starts_at < end_of_local_day(date_to, tz_name),
        Appointment.ends_at > start_of_local_day(date_from, tz_name),
    )
    if not include_cancelled:
        stmt = stmt.where(Appointment.status.in_(list(BLOCKING_APPOINTMENT_STATUSES)))

    if not tenant.has(Permission.CALENDAR_ALL_READ):
        if tenant.employee_id is None:
            return []
        stmt = stmt.where(Appointment.employee_id == tenant.employee_id)
    elif employee_id is not None:
        stmt = stmt.where(Appointment.employee_id == employee_id)

    if client_id is not None:
        stmt = stmt.where(Appointment.client_id == client_id)

    rows = list((await session.execute(
        stmt.order_by(Appointment.starts_at).limit(limit)
    )).scalars().all())
    now = utcnow()
    return [await serialize_appointment(session, a, for_client=False, now=now) for a in rows]


async def _load_appointment(session, tenant, appointment_id: uuid.UUID) -> Appointment:
    appointment = await session.get(Appointment, appointment_id)
    if appointment is None or appointment.company_id != tenant.company.id:
        raise NotFound('Запись')
    if not tenant.has(Permission.CALENDAR_ALL_READ):
        if tenant.employee_id is None or appointment.employee_id != tenant.employee_id:
            raise Forbidden('Эта запись вам не видна')
    return appointment


@router.get('/companies/{company_id}/appointments/{appointment_id}', response_model=s.AppointmentOut)
async def get_appointment(
    appointment_id: uuid.UUID, session: DbSession, tenant: Tenant,
) -> s.AppointmentOut:
    appointment = await _load_appointment(session, tenant, appointment_id)
    return await serialize_appointment(session, appointment, for_client=False)


@router.get('/companies/{company_id}/appointments/{appointment_id}/history',
            response_model=list[s.AppointmentEventOut])
async def appointment_history(
    appointment_id: uuid.UUID, session: DbSession, tenant: Tenant,
) -> list[s.AppointmentEventOut]:
    appointment = await _load_appointment(session, tenant, appointment_id)
    rows = (await session.execute(
        select(AppointmentEvent)
        .where(AppointmentEvent.appointment_id == appointment.id)
        .order_by(AppointmentEvent.created_at)
    )).scalars().all()
    return [s.AppointmentEventOut.model_validate(row) for row in rows]


@router.post('/companies/{company_id}/appointments/{appointment_id}/reschedule',
             response_model=s.AppointmentOut)
async def reschedule_appointment(
    appointment_id: uuid.UUID,
    payload: s.RescheduleIn,
    session: DbSession,
    settings: AppSettings,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.APPOINTMENTS_UPDATE))],
) -> s.AppointmentOut:
    appointment = await _load_appointment(session, tenant, appointment_id)
    result = await booking_service.reschedule(
        session, appointment, settings,
        starts_at=payload.starts_at, employee_id=payload.employee_id,
        staff=True, reason=payload.reason,
    )
    await session.commit()
    await session.refresh(result)
    return await serialize_appointment(session, result, for_client=False)


@router.post('/companies/{company_id}/appointments/{appointment_id}/cancel',
             response_model=s.AppointmentOut)
async def cancel_appointment(
    appointment_id: uuid.UUID,
    payload: s.CancelIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.APPOINTMENTS_CANCEL))],
) -> s.AppointmentOut:
    appointment = await _load_appointment(session, tenant, appointment_id)
    result = await booking_service.cancel(
        session, appointment, by_client=False, reason=payload.reason,
        actor_user_id=tenant.principal.user.id, enforce_deadline=False,
    )
    await session.commit()
    return await serialize_appointment(session, result, for_client=False)


@router.post('/companies/{company_id}/appointments/{appointment_id}/complete',
             response_model=s.AppointmentOut)
async def complete_appointment(
    appointment_id: uuid.UUID,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.APPOINTMENTS_COMPLETE))],
) -> s.AppointmentOut:
    appointment = await _load_appointment(session, tenant, appointment_id)
    result = await booking_service.complete(session, appointment)
    await session.commit()
    return await serialize_appointment(session, result, for_client=False)


@router.post('/companies/{company_id}/appointments/{appointment_id}/no-show',
             response_model=s.AppointmentOut)
async def no_show_appointment(
    appointment_id: uuid.UUID,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.APPOINTMENTS_COMPLETE))],
) -> s.AppointmentOut:
    appointment = await _load_appointment(session, tenant, appointment_id)
    result = await booking_service.mark_no_show(session, appointment)
    await session.commit()
    return await serialize_appointment(session, result, for_client=False)


# ------------------------------------------------- клиентские действия

async def _own_appointment(session, principal, appointment_id: uuid.UUID) -> Appointment:
    """APT-007: клиент работает только со своими записями."""
    appointment = await session.get(Appointment, appointment_id)
    if appointment is None:
        raise NotFound('Запись')
    client = await session.get(Client, appointment.client_id)
    if client is None or client.user_id != principal.user.id:
        raise NotFound('Запись')
    return appointment


@router.post('/appointments/{appointment_id}/cancel', response_model=s.AppointmentOut)
async def cancel_own_appointment(
    appointment_id: uuid.UUID,
    payload: s.CancelIn,
    session: DbSession,
    principal: CurrentUser,
) -> s.AppointmentOut:
    """ТЗ 7.7: клиент отменяет сам, но с проверкой дедлайна компании."""
    appointment = await _own_appointment(session, principal, appointment_id)
    result = await booking_service.cancel(
        session, appointment, by_client=True, reason=clean(payload.reason, max_length=255),
        actor_user_id=principal.user.id, enforce_deadline=True,
    )
    await session.commit()
    return await serialize_appointment(session, result, for_client=True)


@router.post('/appointments/{appointment_id}/reschedule', response_model=s.AppointmentOut)
async def reschedule_own_appointment(
    appointment_id: uuid.UUID,
    payload: s.RescheduleIn,
    session: DbSession,
    settings: AppSettings,
    principal: CurrentUser,
) -> s.AppointmentOut:
    appointment = await _own_appointment(session, principal, appointment_id)
    company = await session.get(Company, appointment.company_id)
    if company is not None and not booking_service.cancellation_deadline_ok(
        company, appointment, utcnow(),
    ):
        from app.core.errors import BusinessRuleViolation
        raise BusinessRuleViolation(
            'Перенести уже нельзя, свяжитесь с салоном', code='reschedule_deadline_passed',
        )

    result = await booking_service.reschedule(
        session, appointment, settings,
        starts_at=payload.starts_at, employee_id=payload.employee_id,
        staff=False, reason='client_request',
    )
    await session.commit()
    await session.refresh(result)
    return await serialize_appointment(session, result, for_client=True)


@router.get('/companies/{company_id}/appointments/{appointment_id}/reschedule-options',
            response_model=s.AvailabilityOut)
async def reschedule_options(
    appointment_id: uuid.UUID,
    session: DbSession,
    settings: AppSettings,
    tenant: Tenant,
    date_from: Annotated[date, Query()],
    date_to: Annotated[date | None, Query()] = None,
) -> s.AvailabilityOut:
    """Слоты для переноса: своя же запись не считается занятостью."""
    from app.api.v1 import public as public_api

    appointment = await _load_appointment(session, tenant, appointment_id)
    service_ids = [item.service_id for item in sorted(appointment.services, key=lambda i: i.sort_order)]
    return await public_api.compute_availability(
        session, settings, tenant.company,
        service_ids=service_ids, date_from=date_from, date_to=date_to,
        branch_id=appointment.branch_id, employee_id=appointment.employee_id,
        max_horizon_days=62, ignore_appointment_id=appointment.id,
    )
