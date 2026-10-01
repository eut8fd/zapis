"""Отзывы (ТЗ 8.8)."""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, Tenant, TenantContext, require_permission
from app.api.v1 import schemas as s
from app.core.errors import BusinessRuleViolation, NotFound
from app.db.models import Appointment, Client, Employee, Review
from app.db.types import new_uuid, utcnow
from app.domain import AppointmentStatus, Permission, ReviewStatus
from app.services import audit
from app.utils.text import clean

router = APIRouter(tags=['reviews'])

#: REV-001: окно, в течение которого отзыв ещё принимается после визита.
REVIEW_WINDOW_DAYS = 30


@router.post('/reviews', response_model=s.ReviewOut, status_code=status.HTTP_201_CREATED)
async def create_review(
    payload: s.ReviewIn, session: DbSession, principal: CurrentUser,
) -> s.ReviewOut:
    """
    REV-001/002: отзыв оставляет только клиент завершённой записи, повторная
    отправка идемпотентна — второй отзыв на ту же запись не появляется.
    """
    appointment = await session.get(Appointment, payload.appointment_id)
    if appointment is None:
        raise NotFound('Запись')

    client = await session.get(Client, appointment.client_id)
    if client is None or client.user_id != principal.user.id:
        raise NotFound('Запись')
    if appointment.status != AppointmentStatus.COMPLETED:
        raise BusinessRuleViolation('Отзыв можно оставить после завершённого визита')
    if appointment.completed_at and utcnow() - appointment.completed_at > timedelta(days=REVIEW_WINDOW_DAYS):
        raise BusinessRuleViolation('Срок для отзыва истёк')

    existing = await session.scalar(
        select(Review).where(Review.appointment_id == appointment.id)
    )
    if existing is not None:
        return s.ReviewOut.model_validate(existing)

    review = Review(
        id=new_uuid(),
        company_id=appointment.company_id,
        branch_id=appointment.branch_id,
        appointment_id=appointment.id,
        client_id=client.id,
        employee_id=appointment.employee_id,
        rating=payload.rating,
        comment=clean(payload.comment, max_length=2000),
        status=ReviewStatus.PUBLISHED,
        created_at=utcnow(),
    )
    session.add(review)

    # REV-003: рейтинг мастера пересчитывает сервер, накопительными полями.
    employee = await session.get(Employee, appointment.employee_id)
    if employee is not None:
        employee.rating_sum += payload.rating
        employee.rating_count += 1

    await audit.record(
        session, audit.AuditAction.REVIEW_CREATED,
        company_id=appointment.company_id, target_type='review', target_id=review.id,
        after={'rating': review.rating},
    )
    await session.commit()
    return s.ReviewOut.model_validate(review)


@router.get('/companies/{company_id}/reviews', response_model=list[s.ReviewOut])
async def list_reviews(
    session: DbSession,
    tenant: Tenant,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[s.ReviewOut]:
    rows = list((await session.execute(
        select(Review)
        .where(Review.company_id == tenant.company.id)
        .order_by(Review.created_at.desc())
        .limit(limit)
    )).scalars().all())

    out: list[s.ReviewOut] = []
    for review in rows:
        client = await session.get(Client, review.client_id)
        out.append(s.ReviewOut(
            id=review.id, appointment_id=review.appointment_id, rating=review.rating,
            comment=review.comment, status=review.status, reply_body=review.reply_body,
            created_at=review.created_at,
            client_name=client.display_name if client else None,
        ))
    return out


class ReplyIn(s.Schema):
    body: str


@router.post('/companies/{company_id}/reviews/{review_id}/reply', response_model=s.ReviewOut)
async def reply_to_review(
    review_id: uuid.UUID,
    payload: ReplyIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.COMPANY_SETTINGS_WRITE))],
) -> s.ReviewOut:
    """REV-004/005: компания отвечает, но оценку клиента не переписывает."""
    review = await session.get(Review, review_id)
    if review is None or review.company_id != tenant.company.id:
        raise NotFound('Отзыв')

    review.reply_body = clean(payload.body, max_length=2000)
    review.reply_author_user_id = tenant.principal.user.id
    review.reply_at = utcnow()
    review.updated_at = utcnow()
    await session.commit()
    return s.ReviewOut.model_validate(review)
