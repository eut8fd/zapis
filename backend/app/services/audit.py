"""
Аудит (ADM-005, AUTH-011).

Событие пишется той же сессией, что и бизнес-изменение: либо в БД есть и
изменение, и запись о нём, либо нет ни того, ни другого.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.context import Actor, get_actor, get_correlation_id
from app.core.logging import redact
from app.db.models import AuditEvent
from app.db.types import new_uuid, utcnow


class AuditAction:
    """Коды действий. Строки стабильны — по ним строятся выборки в поддержке."""
    COMPANY_CREATED = 'company.created'
    COMPANY_UPDATED = 'company.updated'
    COMPANY_PUBLISHED = 'company.published'
    COMPANY_SUSPENDED = 'company.suspended'

    BRANCH_CREATED = 'branch.created'
    BRANCH_UPDATED = 'branch.updated'

    SERVICE_CREATED = 'service.created'
    SERVICE_UPDATED = 'service.updated'
    SERVICE_DEACTIVATED = 'service.deactivated'

    EMPLOYEE_CREATED = 'employee.created'
    EMPLOYEE_UPDATED = 'employee.updated'
    EMPLOYEE_TERMINATED = 'employee.terminated'

    INVITE_CREATED = 'invite.created'
    INVITE_ACCEPTED = 'invite.accepted'
    INVITE_REVOKED = 'invite.revoked'

    MEMBERSHIP_ROLE_CHANGED = 'membership.role_changed'
    MEMBERSHIP_TERMINATED = 'membership.terminated'

    SCHEDULE_UPDATED = 'schedule.updated'
    SCHEDULE_EXCEPTION_CREATED = 'schedule.exception_created'
    SCHEDULE_EXCEPTION_DELETED = 'schedule.exception_deleted'

    APPOINTMENT_CREATED = 'appointment.created'
    APPOINTMENT_RESCHEDULED = 'appointment.rescheduled'
    APPOINTMENT_CANCELLED = 'appointment.cancelled'
    APPOINTMENT_COMPLETED = 'appointment.completed'
    APPOINTMENT_NO_SHOW = 'appointment.no_show'

    CLIENT_CREATED = 'client.created'
    CLIENT_UPDATED = 'client.updated'
    CLIENT_NOTE_READ = 'client.note_read'
    CLIENT_EXPORTED = 'client.exported'
    CLIENT_ANONYMIZED = 'client.anonymized'

    REVIEW_CREATED = 'review.created'
    REVIEW_MODERATED = 'review.moderated'

    BROADCAST_SENT = 'broadcast.sent'

    PAYMENT_ORDER_CREATED = 'payment.order_created'
    PAYMENT_CONFIRMED = 'payment.confirmed'
    PAYMENT_REFUNDED = 'payment.refunded'
    SUBSCRIPTION_CHANGED = 'subscription.changed'

    SESSION_CREATED = 'session.created'
    SESSION_REVOKED = 'session.revoked'
    SESSION_REUSE_DETECTED = 'session.refresh_reuse_detected'

    ADMIN_IMPERSONATION_STARTED = 'admin.impersonation_started'
    ADMIN_COMPANY_SUSPENDED = 'admin.company_suspended'
    ADMIN_PLAN_CHANGED = 'admin.plan_changed'

    SECURITY_SIGNAL = 'security.signal'


async def record(
    session: AsyncSession,
    action: str,
    *,
    company_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: str | uuid.UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
    actor: Actor | None = None,
    ip_hash: str | None = None,
) -> AuditEvent:
    actor = actor or get_actor()
    event = AuditEvent(
        id=new_uuid(),
        company_id=company_id or (actor.company_id if actor else None),
        actor_user_id=actor.user_id if actor else None,
        actor_role=(actor.company_role or actor.platform_role) if actor else None,
        actor_kind=actor.kind if actor else 'system',
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        before=redact(before) if before else None,
        after=redact(after) if after else None,
        reason=reason,
        correlation_id=get_correlation_id(),
        ip_hash=ip_hash,
        created_at=utcnow(),
    )
    session.add(event)
    return event
