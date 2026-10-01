"""
Приглашения в команду (ТЗ 8.4, 12.7).

TEAM-001: токен генерируется криптостойко, в БД лежит только его hash,
а сам токен возвращается ровно один раз. Глобального списка приглашений
нет — `GET /invites` не существует намеренно.
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy import select, update

from app.api.deps import (
    AppSettings, CurrentUser, DbSession, TenantContext, require_permission,
)
from app.api.v1 import schemas as s
from app.core.errors import BusinessRuleViolation, NotFound
from app.core.security import hash_token, new_token
from app.db.models import Company, Employee, Membership, TeamInvite
from app.db.types import new_uuid, utcnow
from app.domain import (
    ALL_PERMISSIONS, CompanyRole, InviteStatus, MembershipStatus, Permission,
)
from app.services import audit, entitlements

router = APIRouter(tags=['invites'])


@router.post('/companies/{company_id}/invites', response_model=s.InviteCreatedOut,
             status_code=status.HTTP_201_CREATED)
async def create_invite(
    payload: s.InviteIn,
    session: DbSession,
    settings: AppSettings,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.TEAM_INVITE))],
) -> s.InviteCreatedOut:
    if payload.employee_id is not None:
        employee = await session.get(Employee, payload.employee_id)
        if employee is None or employee.company_id != tenant.company.id:
            raise NotFound('Сотрудник')
        if employee.user_id is not None:
            raise BusinessRuleViolation('У этого сотрудника уже есть доступ')

    # TEAM-008: место в тарифе проверяем при выдаче приглашения, а не только
    # при его принятии — иначе можно раздать больше, чем оплачено.
    await entitlements.require_capacity(
        session, tenant.company.id, entitlements.Key.MAX_EMPLOYEES, adding=0,
    )

    token = new_token(32)
    now = utcnow()
    invite = TeamInvite(
        id=new_uuid(),
        company_id=tenant.company.id,
        branch_id=payload.branch_id,
        employee_id=payload.employee_id,
        token_hash=hash_token(token),
        role=payload.role,
        permissions=[p for p in payload.permissions if p in ALL_PERMISSIONS],
        status=InviteStatus.PENDING,
        created_by_user_id=tenant.principal.user.id,
        created_at=now,
        expires_at=now + timedelta(hours=payload.expires_in_hours),
    )
    session.add(invite)

    await audit.record(
        session, audit.AuditAction.INVITE_CREATED,
        company_id=tenant.company.id, target_type='invite', target_id=invite.id,
        after={'role': invite.role, 'expires_at': invite.expires_at.isoformat()},
    )
    await session.commit()

    base = settings.webapp_url or settings.public_base_url
    return s.InviteCreatedOut(
        id=invite.id, role=invite.role, status=invite.status, expires_at=invite.expires_at,
        employee_id=invite.employee_id, created_at=invite.created_at,
        token=token,
        link=f'{base}/#/invite/{token}',
    )


@router.get('/companies/{company_id}/invites', response_model=list[s.InviteOut])
async def list_company_invites(
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.TEAM_READ))],
) -> list[s.InviteOut]:
    """TEAM-004: список в пределах компании и без токенов."""
    rows = (await session.execute(
        select(TeamInvite)
        .where(TeamInvite.company_id == tenant.company.id)
        .order_by(TeamInvite.created_at.desc())
        .limit(100)
    )).scalars().all()
    return [s.InviteOut.model_validate(row) for row in rows]


@router.post('/companies/{company_id}/invites/{invite_id}/revoke', response_model=s.OkOut)
async def revoke_invite(
    invite_id: uuid.UUID,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.TEAM_INVITE))],
) -> s.OkOut:
    invite = await session.get(TeamInvite, invite_id)
    if invite is None or invite.company_id != tenant.company.id:
        raise NotFound('Приглашение')
    if invite.status != InviteStatus.PENDING:
        raise BusinessRuleViolation('Приглашение уже использовано или отозвано')

    invite.status = InviteStatus.REVOKED
    invite.revoked_at = utcnow()
    await audit.record(
        session, audit.AuditAction.INVITE_REVOKED,
        company_id=tenant.company.id, target_type='invite', target_id=invite.id,
    )
    await session.commit()
    return s.OkOut()


async def _load_by_token(session, token: str) -> TeamInvite:
    invite = await session.scalar(
        select(TeamInvite).where(TeamInvite.token_hash == hash_token(token))
    )
    if invite is None:
        raise NotFound('Приглашение')
    return invite


@router.get('/invites/{token}/preview', response_model=s.InvitePreviewOut)
async def preview_invite(
    token: Annotated[str, Path(min_length=16, max_length=128)], session: DbSession,
) -> s.InvitePreviewOut:
    """Минимальное публичное превью: название компании и роль, ничего больше."""
    invite = await _load_by_token(session, token)
    company = await session.get(Company, invite.company_id)
    valid = (
        invite.status == InviteStatus.PENDING
        and invite.expires_at > utcnow()
        and company is not None
        and company.deleted_at is None
    )
    return s.InvitePreviewOut(
        company_name=company.name if company else '',
        role=invite.role,
        expires_at=invite.expires_at,
        valid=valid,
    )


@router.post('/invites/{token}/accept', response_model=s.InviteAcceptOut)
async def accept_invite(
    token: Annotated[str, Path(min_length=16, max_length=128)],
    session: DbSession,
    principal: CurrentUser,
) -> s.InviteAcceptOut:
    """
    TEAM-002: consume приглашения и создание membership — одна транзакция,
    и consume выполняется условным UPDATE. Два одновременных перехода по
    одной ссылке дадут ровно одно членство.
    """
    invite = await _load_by_token(session, token)
    now = utcnow()

    result = await session.execute(
        update(TeamInvite)
        .where(
            TeamInvite.id == invite.id,
            TeamInvite.status == InviteStatus.PENDING,
            TeamInvite.expires_at > now,
        )
        .values(status=InviteStatus.ACCEPTED, used_at=now, used_by_user_id=principal.user.id)
    )
    if result.rowcount != 1:
        raise BusinessRuleViolation('Ссылка недействительна или уже использована')

    company = await session.get(Company, invite.company_id)
    if company is None or company.deleted_at is not None:
        raise NotFound('Компания')

    existing = await session.scalar(
        select(Membership).where(
            Membership.company_id == invite.company_id,
            Membership.user_id == principal.user.id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    if existing is not None:
        await session.commit()
        return s.InviteAcceptOut(
            company_id=company.id, company_name=company.name,
            role=existing.role, employee_id=existing.employee_id,
        )

    await entitlements.require_capacity(
        session, invite.company_id, entitlements.Key.MAX_EMPLOYEES, adding=0,
    )

    employee_id = invite.employee_id
    if employee_id is None:
        # Приглашение без готовой карточки — заводим её из профиля человека.
        employee = Employee(
            id=new_uuid(),
            company_id=company.id,
            user_id=principal.user.id,
            display_name=principal.user.display_name,
            takes_appointments=invite.role == CompanyRole.MASTER,
            active=True, public=True,
            created_at=now, updated_at=now,
        )
        session.add(employee)
        await session.flush()
        employee_id = employee.id
    else:
        employee = await session.get(Employee, employee_id)
        if employee is not None:
            employee.user_id = principal.user.id
            employee.updated_at = now

    membership = Membership(
        id=new_uuid(),
        company_id=company.id,
        user_id=principal.user.id,
        employee_id=employee_id,
        role=invite.role,
        status=MembershipStatus.ACTIVE,
        permissions=invite.permissions or [],
        created_at=now,
        activated_at=now,
    )
    session.add(membership)

    await audit.record(
        session, audit.AuditAction.INVITE_ACCEPTED,
        company_id=company.id, target_type='invite', target_id=invite.id,
        after={'role': invite.role, 'user_id': str(principal.user.id)},
    )
    await session.commit()
    return s.InviteAcceptOut(
        company_id=company.id, company_name=company.name,
        role=invite.role, employee_id=employee_id,
    )
