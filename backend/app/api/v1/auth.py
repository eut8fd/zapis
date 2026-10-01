"""Вход, сессии и профиль (ТЗ 12.2)."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import select

from app.api.deps import AppSettings, CurrentUser, DbSession
from app.api.v1 import schemas as s
from app.core import ratelimit
from app.core.errors import ValidationFailed
from app.core.security import hash_ip
from app.db.models import Appointment, Branch, Client, Company, Employee
from app.db.types import utcnow
from app.domain import AppointmentStatus, BLOCKING_APPOINTMENT_STATUSES
from app.services import audit, auth as auth_service
from app.services.timeutils import local
from app.utils.phone import normalize_phone

router = APIRouter(tags=['auth'])


def _client_ip(request: Request) -> str | None:
    # X-Forwarded-For доверяем только за собственным прокси; первый элемент —
    # реальный клиент. Сам адрес мы не храним, только его псевдоним.
    forwarded = request.headers.get('X-Forwarded-For')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.client.host if request.client else None


@router.post('/auth/telegram/exchange', response_model=s.TokenPair)
async def exchange(
    payload: s.TelegramExchangeIn, request: Request, session: DbSession, settings: AppSettings,
) -> s.TokenPair:
    """
    AUTH-002: единственная точка, где принимается initData. Дальше живёт
    серверная сессия, а initData больше никуда не отправляется.
    """
    ip = _client_ip(request)
    await ratelimit.check(
        f'auth:{ip or "unknown"}', settings.rate_limit_auth_per_minute, 60,
    )

    issued, identity = await auth_service.exchange_init_data(
        session, payload.init_data, settings,
        client=payload.client,
        user_agent=request.headers.get('User-Agent'),
        ip_hash=hash_ip(ip, settings.session_secret or settings.telegram_bot_token),
    )
    await session.commit()

    # start_param мы принимаем, но правами он не управляет: ссылка задаёт
    # только контекст компании для показа (ТЗ 7.1, шаг 3).
    return s.TokenPair(
        access_token=issued.access_token,
        refresh_token=issued.refresh_token,
        expires_in=issued.expires_in,
    )


@router.post('/auth/refresh', response_model=s.TokenPair)
async def refresh(
    payload: s.RefreshIn, request: Request, session: DbSession, settings: AppSettings,
) -> s.TokenPair:
    ip = _client_ip(request)
    await ratelimit.check(f'refresh:{ip or "unknown"}', settings.rate_limit_auth_per_minute, 60)

    issued = await auth_service.refresh_session(
        session, payload.refresh_token, settings,
        user_agent=request.headers.get('User-Agent'),
        ip_hash=hash_ip(ip, settings.session_secret or settings.telegram_bot_token),
    )
    await session.commit()
    return s.TokenPair(
        access_token=issued.access_token,
        refresh_token=issued.refresh_token,
        expires_in=issued.expires_in,
    )


@router.post('/auth/logout', response_model=s.OkOut, status_code=status.HTTP_200_OK)
async def logout(principal: CurrentUser, session: DbSession) -> s.OkOut:
    await auth_service.revoke_session(session, principal.session_id, reason='logout')
    await audit.record(
        session, audit.AuditAction.SESSION_REVOKED,
        target_type='session', target_id=principal.session_id,
    )
    await session.commit()
    return s.OkOut()


@router.get('/me', response_model=s.MeOut)
async def me(principal: CurrentUser, session: DbSession) -> s.MeOut:
    """
    ТЗ 9.5: роль и tenant приложение узнаёт отсюда. Ничего из локального
    состояния фронта на состав ответа не влияет.
    """
    await auth_service.touch_session(session, principal.session_id)
    await session.commit()
    return s.MeOut(
        user_id=principal.user.id,
        telegram_user_id=principal.user.telegram_user_id,
        display_name=principal.user.display_name,
        username=principal.user.username,
        language_code=principal.user.language_code,
        phone=principal.user.phone,
        platform_role=principal.user.platform_role,
        memberships=[
            s.MembershipOut(
                company_id=m.company_id,
                company_name=m.company_name,
                company_slug=m.company_slug,
                company_status=m.company_status,
                role=m.role,
                employee_id=m.employee_id,
                permissions=sorted(m.permissions),
            )
            for m in principal.memberships
        ],
    )


@router.patch('/me/profile', response_model=s.MeOut)
async def update_profile(
    payload: s.ProfileIn, principal: CurrentUser, session: DbSession,
) -> s.MeOut:
    user = principal.user
    if payload.first_name is not None:
        user.first_name = payload.first_name or None
    if payload.last_name is not None:
        user.last_name = payload.last_name or None
    if payload.language_code is not None:
        if payload.language_code not in ('ru', 'kk', 'en'):
            raise ValidationFailed('Язык не поддерживается', fields={'language_code': 'unsupported'})
        user.language_code = payload.language_code
    if payload.phone is not None:
        user.phone = normalize_phone(payload.phone) if payload.phone else None
    user.updated_at = utcnow()
    await session.commit()
    return await me(principal, session)


@router.get('/me/appointments', response_model=list[s.AppointmentOut])
async def my_appointments(
    principal: CurrentUser,
    session: DbSession,
    scope: Annotated[str, Query(pattern='^(upcoming|past|all)$')] = 'upcoming',
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[s.AppointmentOut]:
    """APT-007: только собственные записи, во всех компаниях сразу."""
    client_ids = (await session.execute(
        select(Client.id).where(Client.user_id == principal.user.id)
    )).scalars().all()
    if not client_ids:
        return []

    now = utcnow()
    stmt = select(Appointment).where(Appointment.client_id.in_(client_ids))
    if scope == 'upcoming':
        stmt = stmt.where(
            Appointment.service_starts_at >= now - timedelta(hours=2),
            Appointment.status.in_(list(BLOCKING_APPOINTMENT_STATUSES)),
        ).order_by(Appointment.starts_at)
    elif scope == 'past':
        stmt = stmt.where(Appointment.service_starts_at < now).order_by(Appointment.starts_at.desc())
    else:
        stmt = stmt.order_by(Appointment.starts_at.desc())

    appointments = list((await session.execute(stmt.limit(limit))).scalars().all())
    return [await serialize_appointment(session, a, for_client=True, now=now) for a in appointments]


async def serialize_appointment(
    session, appointment: Appointment, *, for_client: bool, now: datetime | None = None,
) -> s.AppointmentOut:
    """Общая сборка ответа: время всегда с зоной филиала, деньги — целым."""
    now = now or utcnow()
    branch = await session.get(Branch, appointment.branch_id)
    employee = await session.get(Employee, appointment.employee_id)
    company = await session.get(Company, appointment.company_id)
    tz_name = branch.timezone if branch else 'UTC'
    local_start = local(appointment.service_starts_at, tz_name)

    active = appointment.status in (AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING_PAYMENT)
    lead_ok = appointment.service_starts_at > now

    return s.AppointmentOut(
        id=appointment.id,
        company_id=appointment.company_id,
        branch_id=appointment.branch_id,
        client_id=appointment.client_id,
        employee_id=appointment.employee_id,
        employee_name=employee.display_name if employee else None,
        company_name=company.name if company else None,
        starts_at=appointment.service_starts_at,
        ends_at=appointment.service_ends_at,
        local_date=local_start.date().isoformat(),
        local_time=local_start.strftime('%H:%M'),
        timezone=tz_name,
        status=appointment.status,
        source=appointment.source,
        payment_status=appointment.payment_status,
        price_minor=appointment.price_minor,
        currency_code=appointment.currency_code,
        duration_minutes=appointment.duration_minutes,
        title=appointment.title_snapshot,
        client_comment=appointment.client_comment,
        internal_note=None if for_client else appointment.internal_note,
        version=appointment.version,
        can_cancel=active and lead_ok,
        can_reschedule=active and lead_ok,
        services=[
            s.AppointmentServiceOut(
                service_id=item.service_id,
                name=item.name_snapshot,
                price_minor=item.price_minor,
                duration_minutes=item.duration_minutes,
            )
            for item in sorted(appointment.services, key=lambda i: i.sort_order)
        ],
    )
