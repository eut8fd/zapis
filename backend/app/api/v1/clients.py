"""
CRM клиентов (ТЗ 8.7, 12.6).

Ключевое ограничение: карточка принадлежит компании. Любая выборка
начинается с company_id из подтверждённого tenant scope, а не из тела
запроса — поэтому «увидеть клиента соседнего салона» технически некуда.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, or_, select

from app.api.deps import DbSession, TenantContext, require_permission
from app.api.v1 import schemas as s
from app.core.errors import NotFound
from app.db.models import Appointment, Client, ClientNote
from app.db.types import new_uuid, utcnow
from app.domain import AppointmentStatus, ClientStatus, ConsentStatus, Permission
from app.services import audit
from app.utils.phone import mask_phone, normalize_phone
from app.utils.text import clean

router = APIRouter(tags=['clients'])


async def _visit_stats(session, company_id: uuid.UUID, client_ids: list[uuid.UUID]) -> dict:
    if not client_ids:
        return {}
    rows = (await session.execute(
        select(
            Appointment.client_id,
            func.count(Appointment.id),
            func.max(Appointment.service_starts_at),
        )
        .where(
            Appointment.company_id == company_id,
            Appointment.client_id.in_(client_ids),
            Appointment.status == AppointmentStatus.COMPLETED,
        )
        .group_by(Appointment.client_id)
    )).all()
    return {client_id: (count, last) for client_id, count, last in rows}


def _serialize(client: Client, stats: tuple | None, *, full: bool) -> s.ClientOut:
    count, last = stats or (0, None)
    return s.ClientOut(
        id=client.id,
        display_name=client.display_name,
        # CRM-001/ТЗ 18.2: полный телефон видит только тот, кому положено.
        phone=client.phone_normalized if full else mask_phone(client.phone_normalized),
        telegram_username=client.telegram_username if full else None,
        status=client.status,
        consent_status=client.consent_status,
        source=client.source,
        created_at=client.created_at,
        visits_count=count,
        last_visit_at=last,
    )


@router.get('/companies/{company_id}/clients', response_model=s.Page)
async def list_clients(
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.CLIENTS_READ_BASIC))],
    q: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=10000)] = 0,
) -> s.Page:
    """CRM-004: поиск по имени, телефону и Telegram username."""
    stmt = select(Client).where(
        Client.company_id == tenant.company.id,
        Client.status != ClientStatus.ANONYMIZED,
    )
    if q:
        needle = q.strip().lower()
        phone_needle = ''.join(ch for ch in needle if ch.isdigit())
        conditions = [
            func.lower(Client.display_name).like(f'%{needle}%'),
            func.lower(func.coalesce(Client.telegram_username, '')).like(f'%{needle.lstrip("@")}%'),
        ]
        if phone_needle:
            conditions.append(
                func.coalesce(Client.phone_normalized, '').like(f'%{phone_needle}%')
            )
        stmt = stmt.where(or_(*conditions))

    rows = list((await session.execute(
        stmt.order_by(Client.display_name).offset(offset).limit(limit + 1)
    )).scalars().all())
    has_more = len(rows) > limit
    rows = rows[:limit]

    stats = await _visit_stats(session, tenant.company.id, [r.id for r in rows])
    full = tenant.has(Permission.CLIENTS_READ_FULL)
    return s.Page(
        items=[_serialize(row, stats.get(row.id), full=full) for row in rows],
        has_more=has_more,
        next_cursor=str(offset + limit) if has_more else None,
    )


@router.post('/companies/{company_id}/clients', response_model=s.ClientOut,
             status_code=status.HTTP_201_CREATED)
async def create_client(
    payload: s.ClientIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.CLIENTS_WRITE))],
) -> s.ClientOut:
    now = utcnow()
    client = Client(
        id=new_uuid(),
        company_id=tenant.company.id,
        display_name=clean(payload.display_name, max_length=160),
        phone_normalized=normalize_phone(payload.phone),
        phone_raw=payload.phone,
        telegram_username=(payload.telegram_username or '').lstrip('@') or None,
        source=payload.source or 'staff',
        status=ClientStatus.ACTIVE,
        consent_status=ConsentStatus.UNKNOWN,
        created_at=now, updated_at=now,
    )
    session.add(client)
    await audit.record(
        session, audit.AuditAction.CLIENT_CREATED,
        company_id=tenant.company.id, target_type='client', target_id=client.id,
    )
    await session.commit()
    return _serialize(client, None, full=True)


@router.get('/companies/{company_id}/clients/{client_id}', response_model=s.ClientOut)
async def get_client(
    client_id: uuid.UUID,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.CLIENTS_READ_BASIC))],
) -> s.ClientOut:
    client = await session.get(Client, client_id)
    if client is None or client.company_id != tenant.company.id:
        raise NotFound('Клиент')
    stats = await _visit_stats(session, tenant.company.id, [client.id])
    return _serialize(client, stats.get(client.id), full=tenant.has(Permission.CLIENTS_READ_FULL))


@router.patch('/companies/{company_id}/clients/{client_id}', response_model=s.ClientOut)
async def update_client(
    client_id: uuid.UUID,
    payload: s.ClientIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.CLIENTS_WRITE))],
) -> s.ClientOut:
    client = await session.get(Client, client_id)
    if client is None or client.company_id != tenant.company.id:
        raise NotFound('Клиент')

    before = {'display_name': client.display_name}
    client.display_name = clean(payload.display_name, max_length=160)
    if payload.phone is not None:
        client.phone_normalized = normalize_phone(payload.phone)
        client.phone_raw = payload.phone
    if payload.telegram_username is not None:
        client.telegram_username = (payload.telegram_username or '').lstrip('@') or None
    client.updated_at = utcnow()

    await audit.record(
        session, audit.AuditAction.CLIENT_UPDATED,
        company_id=tenant.company.id, target_type='client', target_id=client.id,
        before=before, after={'display_name': client.display_name},
    )
    await session.commit()
    return _serialize(client, None, full=True)


@router.get('/companies/{company_id}/clients/{client_id}/appointments',
            response_model=list[s.AppointmentOut])
async def client_history(
    client_id: uuid.UUID,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.CLIENTS_READ_BASIC))],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[s.AppointmentOut]:
    from app.api.v1.auth import serialize_appointment

    client = await session.get(Client, client_id)
    if client is None or client.company_id != tenant.company.id:
        raise NotFound('Клиент')

    rows = (await session.execute(
        select(Appointment)
        .where(Appointment.company_id == tenant.company.id, Appointment.client_id == client.id)
        .order_by(Appointment.starts_at.desc())
        .limit(limit)
    )).scalars().all()
    return [await serialize_appointment(session, a, for_client=False) for a in rows]


class NoteIn(s.Schema):
    body: str
    sensitive: bool = False


class NoteOut(s.Schema):
    id: uuid.UUID
    body: str
    sensitive: bool
    author_user_id: uuid.UUID | None
    created_at: datetime


@router.get('/companies/{company_id}/clients/{client_id}/notes', response_model=list[NoteOut])
async def list_notes(
    client_id: uuid.UUID,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.CLIENTS_READ_FULL))],
) -> list[NoteOut]:
    """CRM-006/007: чтение заметок журналируется, чувствительные требуют полного доступа."""
    client = await session.get(Client, client_id)
    if client is None or client.company_id != tenant.company.id:
        raise NotFound('Клиент')

    rows = list((await session.execute(
        select(ClientNote)
        .where(ClientNote.client_id == client.id, ClientNote.deleted_at.is_(None))
        .order_by(ClientNote.created_at.desc())
    )).scalars().all())

    if any(note.sensitive for note in rows):
        await audit.record(
            session, audit.AuditAction.CLIENT_NOTE_READ,
            company_id=tenant.company.id, target_type='client', target_id=client.id,
            after={'sensitive_notes': sum(1 for n in rows if n.sensitive)},
        )
        await session.commit()
    return [NoteOut.model_validate(row) for row in rows]


@router.post('/companies/{company_id}/clients/{client_id}/notes', response_model=NoteOut,
             status_code=status.HTTP_201_CREATED)
async def create_note(
    client_id: uuid.UUID,
    payload: NoteIn,
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.CLIENTS_WRITE))],
) -> NoteOut:
    client = await session.get(Client, client_id)
    if client is None or client.company_id != tenant.company.id:
        raise NotFound('Клиент')

    note = ClientNote(
        id=new_uuid(),
        company_id=tenant.company.id,
        client_id=client.id,
        author_user_id=tenant.principal.user.id,
        body=clean(payload.body, max_length=4000) or '',
        sensitive=payload.sensitive,
        created_at=utcnow(),
    )
    session.add(note)
    await session.commit()
    return NoteOut.model_validate(note)


@router.post('/companies/{company_id}/clients/{client_id}/consent', response_model=s.ClientOut)
async def set_consent(
    client_id: uuid.UUID,
    granted: Annotated[bool, Query()],
    session: DbSession,
    tenant: Annotated[TenantContext, Depends(require_permission(Permission.CLIENTS_WRITE))],
) -> s.ClientOut:
    """MSG-001: согласие фиксируется явно, с датой — по нему считается аудитория."""
    client = await session.get(Client, client_id)
    if client is None or client.company_id != tenant.company.id:
        raise NotFound('Клиент')

    before = {'consent_status': client.consent_status}
    client.consent_status = ConsentStatus.GRANTED if granted else ConsentStatus.REVOKED
    client.consent_updated_at = utcnow()
    client.updated_at = utcnow()

    await audit.record(
        session, audit.AuditAction.CLIENT_UPDATED,
        company_id=tenant.company.id, target_type='client', target_id=client.id,
        before=before, after={'consent_status': client.consent_status},
    )
    await session.commit()
    return _serialize(client, None, full=True)
