"""
Зависимости FastAPI: сессия БД, текущий пользователь, tenant scope и права.

Здесь собран весь контроль доступа. Ни один обработчик не должен сам
разбирать заголовки или сверять company_id — только объявить, что ему нужно.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated, AsyncIterator, Callable

from fastapi import Depends, Path, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.core.context import Actor, set_actor
from app.core.errors import (
    Forbidden, NotFound, PermissionDenied, SubscriptionInactive, TenantMismatch, Unauthorized,
)
from app.core.security import read_access_token
from app.db.base import session_scope
from app.db.models import Company, Subscription, User
from app.domain import (
    CompanyStatus, ENTITLED_SUBSCRIPTION_STATUSES, Permission, PlatformRole,
)
from app.services import auth as auth_service


async def db_session() -> AsyncIterator[AsyncSession]:
    async for session in session_scope():
        yield session


DbSession = Annotated[AsyncSession, Depends(db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@dataclass
class Principal:
    """Кто пришёл. Собран сервером, фронт на состав не влияет."""
    user: User
    session_id: uuid.UUID
    memberships: list[auth_service.MembershipView]

    @property
    def platform_role(self) -> str:
        return self.user.platform_role

    @property
    def is_platform_staff(self) -> bool:
        return self.platform_role in (
            PlatformRole.SUPPORT_AGENT, PlatformRole.PLATFORM_ADMIN, PlatformRole.SUPER_ADMIN,
        )

    def membership_for(self, company_id: uuid.UUID) -> auth_service.MembershipView | None:
        for m in self.memberships:
            if m.company_id == company_id:
                return m
        return None


def _bearer(request: Request) -> str:
    header = request.headers.get('Authorization', '')
    scheme, _, token = header.partition(' ')
    if scheme.lower() != 'bearer' or not token.strip():
        raise Unauthorized()
    return token.strip()


async def current_principal(
    request: Request, session: DbSession, settings: AppSettings,
) -> Principal:
    token = _bearer(request)
    claims = read_access_token(token, settings.session_secret or settings.telegram_bot_token)

    try:
        user_id = uuid.UUID(str(claims.get('sub')))
        session_id = uuid.UUID(str(claims.get('sid')))
    except (ValueError, TypeError) as exc:
        raise Unauthorized('Некорректный токен') from exc

    # AUTH-008/009: сессия проверяется в БД на каждом запросе. Отозвали —
    # действующий access token перестаёт работать сразу, а не через 15 минут.
    await auth_service.load_session(session, session_id)

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise Unauthorized('Доступ заблокирован', code='user_blocked')

    memberships = await auth_service.load_memberships(session, user.id)
    principal = Principal(user=user, session_id=session_id, memberships=memberships)

    set_actor(Actor(user_id=user.id, kind='user', platform_role=user.platform_role))
    request.state.principal = principal
    return principal


CurrentUser = Annotated[Principal, Depends(current_principal)]


async def optional_principal(
    request: Request, session: DbSession, settings: AppSettings,
) -> Principal | None:
    """Для публичных страниц: если вошёл — покажем персональное, если нет — гость."""
    if 'authorization' not in request.headers:
        return None
    try:
        return await current_principal(request, session, settings)
    except Unauthorized:
        return None


MaybeUser = Annotated[Principal | None, Depends(optional_principal)]


@dataclass
class TenantContext:
    """Компания, к которой уже подтверждён доступ, и права внутри неё."""
    company: Company
    membership: auth_service.MembershipView | None
    principal: Principal
    permissions: frozenset[str]
    subscription: Subscription | None

    @property
    def company_id(self) -> uuid.UUID:
        return self.company.id

    @property
    def role(self) -> str | None:
        return self.membership.role if self.membership else None

    @property
    def employee_id(self) -> uuid.UUID | None:
        return self.membership.employee_id if self.membership else None

    def has(self, permission: str) -> bool:
        return permission in self.permissions

    def require(self, permission: str) -> None:
        if permission not in self.permissions:
            raise PermissionDenied(permission)

    @property
    def entitled(self) -> bool:
        """Подписка позволяет менять данные и принимать записи."""
        if self.company.status == CompanyStatus.SUSPENDED:
            return False
        if self.subscription is None:
            return False
        return self.subscription.status in ENTITLED_SUBSCRIPTION_STATUSES


async def tenant_context(
    company_id: Annotated[uuid.UUID, Path()],
    principal: CurrentUser,
    session: DbSession,
) -> TenantContext:
    """
    AUTH-006: company_id из URL — это только адрес. Доступ подтверждается
    членством, найденным сервером. Нет членства — 403 без намёка на то,
    существует ли компания вообще.
    """
    membership = principal.membership_for(company_id)
    platform_override = principal.platform_role in (
        PlatformRole.PLATFORM_ADMIN, PlatformRole.SUPER_ADMIN,
    )
    if membership is None and not platform_override:
        raise TenantMismatch()

    company = await session.get(Company, company_id)
    if company is None or company.deleted_at is not None:
        raise TenantMismatch()

    subscription = await session.scalar(
        select(Subscription).where(Subscription.company_id == company.id)
    )

    if membership is not None:
        permissions = membership.permissions
    else:
        # Платформенный админ смотрит, но не работает от имени компании:
        # запись и рассылки ему не положены без impersonation с аудитом.
        permissions = frozenset({
            Permission.COMPANY_SETTINGS_READ, Permission.TEAM_READ, Permission.SERVICES_READ,
            Permission.CALENDAR_ALL_READ, Permission.BILLING_READ, Permission.AUDIT_READ,
        })

    set_actor(Actor(
        user_id=principal.user.id,
        kind='user',
        platform_role=principal.platform_role,
        company_id=company.id,
        company_role=membership.role if membership else None,
    ))
    return TenantContext(
        company=company,
        membership=membership,
        principal=principal,
        permissions=permissions,
        subscription=subscription,
    )


Tenant = Annotated[TenantContext, Depends(tenant_context)]


def require_permission(permission: str) -> Callable[[TenantContext], TenantContext]:
    """Объявление вида `_: None = Depends(require_permission(Permission.X))`."""
    async def dependency(tenant: Tenant) -> TenantContext:
        tenant.require(permission)
        return tenant

    return dependency


def require_entitlement() -> Callable[[TenantContext], TenantContext]:
    """
    COM-005/14.4: заблокированная или неоплаченная компания не пишет данные.
    Оплата, экспорт и поддержка остаются доступны — они идут мимо этой проверки.
    """
    async def dependency(tenant: Tenant) -> TenantContext:
        if not tenant.entitled:
            raise SubscriptionInactive(
                details={
                    'company_status': tenant.company.status,
                    'subscription_status': tenant.subscription.status if tenant.subscription else None,
                },
            )
        return tenant

    return dependency


def require_platform_role(*roles: str) -> Callable[[Principal], Principal]:
    async def dependency(principal: CurrentUser) -> Principal:
        if principal.platform_role not in roles:
            raise Forbidden('Раздел доступен только сотрудникам платформы')
        return principal

    return dependency


@dataclass
class BookingContext:
    """
    Контекст клиента у чужой компании. Членства здесь нет и быть не должно:
    человек записывается в салон, а не работает в нём (ТЗ 7.1, CAT-006).
    """
    company: Company
    subscription: Subscription | None
    principal: Principal

    @property
    def company_id(self) -> uuid.UUID:
        return self.company.id

    @property
    def entitled(self) -> bool:
        if self.company.status != CompanyStatus.PUBLISHED:
            return False
        if self.subscription is None:
            return False
        return self.subscription.status in ENTITLED_SUBSCRIPTION_STATUSES


async def booking_context(
    company_id: Annotated[uuid.UUID, Path()],
    principal: CurrentUser,
    session: DbSession,
) -> BookingContext:
    """
    CAT-005: неопубликованная, заблокированная или просроченная по тарифу
    компания новых записей не принимает — решение принимает сервер.
    """
    company = await session.get(Company, company_id)
    if company is None or company.deleted_at is not None:
        raise NotFound('Компания')

    subscription = await session.scalar(
        select(Subscription).where(Subscription.company_id == company.id)
    )
    context = BookingContext(company=company, subscription=subscription, principal=principal)
    if not context.entitled:
        raise SubscriptionInactive(
            'Компания сейчас не принимает онлайн-записи',
            details={'company_status': company.status},
        )

    set_actor(Actor(user_id=principal.user.id, kind='user', company_id=company.id))
    return context


ClientBooking = Annotated[BookingContext, Depends(booking_context)]


async def published_company(
    slug: Annotated[str, Path()], session: DbSession,
) -> Company:
    """
    CAT-001: публичный слой отдаёт только опубликованные компании.
    Черновик и заблокированная компания снаружи не существуют.
    """
    company = await session.scalar(select(Company).where(Company.slug == slug))
    if company is None or company.deleted_at is not None or company.status != CompanyStatus.PUBLISHED:
        raise NotFound('Компания')
    return company


PublicCompany = Annotated[Company, Depends(published_company)]
