"""
Аутентификация и сессии (ТЗ 6.2).

Схема: Mini App отдаёт initData ровно один раз — на обмен. Дальше живут
короткий access token и refresh token с ротацией. Роль, компания и права
приходят только из БД: ничего из того, что прислал фронт, доверием не
считается (AUTH-001).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.errors import SessionExpired, Unauthorized
from app.core.security import (
    TelegramIdentity, hash_token, issue_access_token, new_token, verify_init_data,
)
from app.db.models import Membership, Session as SessionRow, User
from app.db.types import new_uuid, utcnow
from app.domain import MembershipStatus, UserStatus, permissions_for
from app.services import audit


@dataclass(frozen=True)
class IssuedSession:
    access_token: str
    refresh_token: str
    expires_in: int
    session_id: uuid.UUID
    user: User


async def get_or_create_user(session: AsyncSession, identity: TelegramIdentity) -> User:
    """
    Пользователь заводится по telegram_user_id — он и есть подтверждённая
    личность. Имя и username обновляем: человек мог их сменить.
    """
    user = await session.scalar(
        select(User).where(User.telegram_user_id == identity.telegram_user_id)
    )
    now = utcnow()
    if user is None:
        user = User(
            id=new_uuid(),
            telegram_user_id=identity.telegram_user_id,
            username=identity.username,
            first_name=identity.first_name,
            last_name=identity.last_name,
            language_code=identity.language_code,
            status=UserStatus.ACTIVE,
            last_seen_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        await session.flush()
        return user

    user.username = identity.username
    user.first_name = identity.first_name
    user.last_name = identity.last_name
    if identity.language_code:
        user.language_code = identity.language_code
    user.last_seen_at = now
    return user


async def issue_session(
    session: AsyncSession,
    user: User,
    settings: Settings,
    *,
    client: str | None = None,
    user_agent: str | None = None,
    ip_hash: str | None = None,
    rotated_from: uuid.UUID | None = None,
) -> IssuedSession:
    refresh = new_token(32)
    now = utcnow()
    row = SessionRow(
        id=new_uuid(),
        user_id=user.id,
        refresh_token_hash=hash_token(refresh),
        rotated_from_id=rotated_from,
        client=client,
        user_agent=(user_agent or '')[:256] or None,
        ip_hash=ip_hash,
        created_at=now,
        expires_at=now + timedelta(seconds=settings.refresh_token_ttl_seconds),
        last_used_at=now,
    )
    session.add(row)
    await session.flush()

    access = issue_access_token(
        {'sub': str(user.id), 'sid': str(row.id), 'tg': user.telegram_user_id},
        settings.session_secret or settings.telegram_bot_token,
        settings.access_token_ttl_seconds,
    )
    return IssuedSession(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.access_token_ttl_seconds,
        session_id=row.id,
        user=user,
    )


async def exchange_init_data(
    session: AsyncSession,
    init_data: str,
    settings: Settings,
    *,
    client: str | None = None,
    user_agent: str | None = None,
    ip_hash: str | None = None,
) -> tuple[IssuedSession, TelegramIdentity]:
    identity = verify_init_data(
        init_data,
        settings.telegram_bot_token,
        max_age_seconds=settings.telegram_auth_max_age_seconds,
    )
    user = await get_or_create_user(session, identity)
    if user.status == UserStatus.BLOCKED:
        raise Unauthorized('Доступ заблокирован', code='user_blocked')
    if user.status == UserStatus.DELETED or user.deleted_at is not None:
        raise Unauthorized('Аккаунт удалён', code='user_deleted')

    issued = await issue_session(
        session, user, settings, client=client, user_agent=user_agent, ip_hash=ip_hash,
    )
    await audit.record(
        session, audit.AuditAction.SESSION_CREATED,
        target_type='session', target_id=issued.session_id,
        after={'client': client}, ip_hash=ip_hash,
    )
    return issued, identity


async def refresh_session(
    session: AsyncSession,
    refresh_token: str,
    settings: Settings,
    *,
    user_agent: str | None = None,
    ip_hash: str | None = None,
) -> IssuedSession:
    """
    Ротация refresh-токена. Повторное использование уже отозванного токена
    трактуем как компрометацию и гасим все сессии пользователя — это дешевле
    для человека, чем чужой вход.
    """
    token_hash = hash_token(refresh_token or '')
    row = await session.scalar(
        select(SessionRow).where(SessionRow.refresh_token_hash == token_hash)
    )
    if row is None:
        raise SessionExpired()

    now = utcnow()
    if row.revoked_at is not None:
        await revoke_all_sessions(session, row.user_id, reason='refresh_reuse')
        await audit.record(
            session, audit.AuditAction.SESSION_REUSE_DETECTED,
            target_type='session', target_id=row.id, ip_hash=ip_hash,
        )
        # Коммитим до исключения: иначе rollback обработчика вернёт
        # отозванные сессии к жизни, и защита от кражи токена не сработает.
        await session.commit()
        raise SessionExpired('Сессия отозвана')
    if row.expires_at <= now:
        raise SessionExpired()

    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise Unauthorized('Доступ заблокирован', code='user_blocked')

    row.revoked_at = now
    row.revoked_reason = 'rotated'
    row.last_used_at = now

    return await issue_session(
        session, user, settings,
        client=row.client, user_agent=user_agent or row.user_agent,
        ip_hash=ip_hash, rotated_from=row.id,
    )


async def revoke_session(session: AsyncSession, session_id: uuid.UUID, *, reason: str = 'logout') -> None:
    await session.execute(
        update(SessionRow)
        .where(SessionRow.id == session_id, SessionRow.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoked_reason=reason)
    )


async def revoke_all_sessions(session: AsyncSession, user_id: uuid.UUID, *, reason: str) -> None:
    """AUTH-009: блокировка пользователя или смена роли гасит доступ немедленно."""
    await session.execute(
        update(SessionRow)
        .where(SessionRow.user_id == user_id, SessionRow.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoked_reason=reason)
    )


async def load_session(session: AsyncSession, session_id: uuid.UUID) -> SessionRow:
    row = await session.get(SessionRow, session_id)
    now = utcnow()
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise SessionExpired()
    return row


@dataclass(frozen=True)
class MembershipView:
    company_id: uuid.UUID
    company_name: str
    company_slug: str
    company_status: str
    role: str
    employee_id: uuid.UUID | None
    permissions: frozenset[str]


async def load_memberships(session: AsyncSession, user_id: uuid.UUID) -> list[MembershipView]:
    """Активные членства пользователя. Это единственный источник прав в компании."""
    from app.db.models import Company

    rows = await session.execute(
        select(Membership, Company)
        .join(Company, Company.id == Membership.company_id)
        .where(
            Membership.user_id == user_id,
            Membership.status == MembershipStatus.ACTIVE,
            Membership.terminated_at.is_(None),
            Company.deleted_at.is_(None),
        )
        .order_by(Company.name)
    )
    views: list[MembershipView] = []
    for membership, company in rows.all():
        views.append(MembershipView(
            company_id=company.id,
            company_name=company.name,
            company_slug=company.slug,
            company_status=company.status,
            role=membership.role,
            employee_id=membership.employee_id,
            permissions=permissions_for(membership.role, membership.permissions or []),
        ))
    return views


async def touch_session(session: AsyncSession, session_id: uuid.UUID, when: datetime | None = None) -> None:
    await session.execute(
        update(SessionRow).where(SessionRow.id == session_id).values(last_used_at=when or utcnow())
    )
