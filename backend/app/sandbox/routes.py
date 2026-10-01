"""
Локальная песочница: вход без Telegram и доставленные уведомления на экране.

Зачем она есть. Продукт целиком завязан на Telegram — identity приходит из
initData, уведомления уходят через Bot API. Проверить на живом продукте
запись, перенос, отмену и напоминания нельзя, не заведя бота и не пустив
в него людей. Песочница заменяет ровно две вещи: способ доказать, кто ты,
и способ доставить сообщение. Всё остальное — те же таблицы, те же права,
тот же slot engine, та же очередь.

Контур включается двумя флагами и только при `APP_ENV=local`; конфигурация
не даёт запустить с ними staging или production (`app/config.py`).
"""
from __future__ import annotations

import zlib
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import Field
from sqlalchemy import delete, select

from app.api.deps import AppSettings, CurrentUser, DbSession
from app.api.v1 import schemas as s
from app.core.errors import Forbidden, ValidationFailed
from app.core.security import hash_ip
from app.db import models as M
from app.db.types import utcnow
from app.domain import UserStatus
from app.services import auth as auth_service, entitlements
from app.utils.text import clean
from app.workers import transport

router = APIRouter(prefix='/dev', tags=['sandbox'])

#: Диапазон синтетических Telegram ID. Настоящие id людей начинаются
#: гораздо ниже — пересечься с реальным пользователем невозможно.
SYNTHETIC_BASE = 900_000_000


def _guard(settings) -> None:  # noqa: ANN001
    """Вторая линия после конфигурации: маршрут не работает без флага."""
    if not settings.dev_auth_enabled or settings.env != 'local':
        raise Forbidden('Песочница выключена')


def synthetic_telegram_id(name: str) -> int:
    """
    Стабильный id по имени: повторный вход тем же именем — тот же человек.
    Иначе каждый вход заводил бы нового пользователя, и «мои записи»
    оказывались бы пустыми ровно так же, как без него.
    """
    digest = zlib.crc32(name.strip().lower().encode('utf-8'))
    return SYNTHETIC_BASE + digest % 90_000_000


class DevLoginIn(s.Schema):
    name: str = Field(min_length=2, max_length=80)
    phone: str | None = Field(default=None, max_length=32)
    language_code: str = Field(default='ru', max_length=8)


class DevUserOut(s.Schema):
    name: str
    telegram_user_id: int
    companies: list[str] = []


class InboxItemOut(s.Schema):
    at: datetime
    to: int
    text: str


@router.post('/login', response_model=s.TokenPair)
async def dev_login(
    payload: DevLoginIn, request: Request, session: DbSession, settings: AppSettings,
) -> s.TokenPair:
    """
    Вход по имени. Дальше — обычная серверная сессия: тот же access token,
    тот же refresh с ротацией, те же права из membership.
    """
    _guard(settings)

    name = clean(payload.name, max_length=80)
    if not name:
        raise ValidationFailed('Укажите имя', fields={'name': 'required'})

    telegram_id = synthetic_telegram_id(name)
    parts = name.split(' ', 1)

    user = await session.scalar(
        select(M.User).where(M.User.telegram_user_id == telegram_id)
    )
    now = utcnow()
    if user is None:
        user = M.User(
            telegram_user_id=telegram_id,
            username=None,
            first_name=parts[0],
            last_name=parts[1] if len(parts) > 1 else None,
            language_code=payload.language_code,
            phone=payload.phone,
            status=UserStatus.ACTIVE,
            last_seen_at=now, created_at=now, updated_at=now,
        )
        session.add(user)
        await session.flush()
    else:
        user.first_name = parts[0]
        user.last_name = parts[1] if len(parts) > 1 else None
        user.last_seen_at = now

    issued = await auth_service.issue_session(
        session, user, settings,
        client='sandbox',
        user_agent=request.headers.get('User-Agent'),
        ip_hash=hash_ip('127.0.0.1', settings.session_secret),
    )
    await session.commit()
    return s.TokenPair(
        access_token=issued.access_token,
        refresh_token=issued.refresh_token,
        expires_in=issued.expires_in,
    )


@router.get('/users', response_model=list[DevUserOut])
async def dev_users(session: DbSession, settings: AppSettings) -> list[DevUserOut]:
    """Кто уже заходил — чтобы переключаться между клиентом и владельцем."""
    _guard(settings)

    users = list((await session.execute(
        select(M.User)
        .where(M.User.telegram_user_id >= SYNTHETIC_BASE)
        .order_by(M.User.created_at)
    )).scalars().all())

    out: list[DevUserOut] = []
    for user in users:
        names = (await session.execute(
            select(M.Company.name)
            .join(M.Membership, M.Membership.company_id == M.Company.id)
            .where(M.Membership.user_id == user.id, M.Membership.status == 'active')
        )).scalars().all()
        out.append(DevUserOut(
            name=user.display_name,
            telegram_user_id=user.telegram_user_id,
            companies=list(names),
        ))
    return out


@router.get('/inbox', response_model=list[InboxItemOut])
async def dev_inbox(
    settings: AppSettings,
    recipient: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[InboxItemOut]:
    """
    Что worker реально доставил. Это не список запланированных задач —
    сюда попадает только то, что прошло очередь и получило подтверждение
    доставки, ровно как с Telegram.
    """
    _guard(settings)
    items = transport.read_inbox(settings.sandbox_inbox_path, recipient=recipient, limit=limit)
    return [InboxItemOut(**item) for item in items]


@router.delete('/inbox', response_model=s.OkOut)
async def clear_inbox(settings: AppSettings) -> s.OkOut:
    _guard(settings)
    transport.clear_inbox(settings.sandbox_inbox_path)
    return s.OkOut()


@router.get('/queue')
async def dev_queue(session: DbSession, settings: AppSettings) -> list[dict]:
    """
    Очередь уведомлений как есть: когда сработает, сколько было попыток,
    в каком статусе. Напоминание за сутки видно здесь задолго до доставки.
    """
    _guard(settings)
    jobs = list((await session.execute(
        select(M.NotificationJob)
        .order_by(M.NotificationJob.scheduled_at.desc())
        .limit(100)
    )).scalars().all())
    return [
        {
            'template': job.template,
            'status': job.status,
            'scheduled_at': job.scheduled_at.isoformat(),
            'attempts': job.attempt_count,
            'recipient': job.recipient_telegram_id,
            'error': job.last_error,
        }
        for job in jobs
    ]


@router.get('/state')
async def dev_state(session: DbSession, settings: AppSettings) -> dict:
    """Сводка: сколько чего в базе. Нужна, чтобы видеть, что база чистая."""
    _guard(settings)
    from sqlalchemy import func

    async def count(model) -> int:  # noqa: ANN001
        return int(await session.scalar(select(func.count()).select_from(model)) or 0)

    return {
        'server_time': utcnow().isoformat(),
        'users': await count(M.User),
        'companies': await count(M.Company),
        'services': await count(M.Service),
        'employees': await count(M.Employee),
        'clients': await count(M.Client),
        'appointments': await count(M.Appointment),
        'notifications': await count(M.NotificationJob),
        'delivered': len(transport.read_inbox(settings.sandbox_inbox_path, limit=10000)),
    }


#: Порядок важен: сначала то, что ссылается, потом то, на что ссылаются.
#: Тарифы не трогаем — это справочник платформы, а не данные теста.
_WIPE_ORDER = (
    M.AppointmentEvent, M.AppointmentService, M.Review, M.Appointment,
    M.ClientTagLink, M.ClientTag, M.ClientNote, M.Client,
    M.NotificationJob, M.BroadcastRecipient, M.Broadcast, M.SuppressionEntry,
    M.OutboxEvent, M.InboxEvent, M.IdempotencyRecord, M.AuditEvent,
    M.ScheduleBreak, M.ScheduleException, M.WeeklyScheduleRule,
    M.EmployeeService, M.EmployeeBranch, M.Employee,
    M.Service, M.ServiceCategory,
    M.FinanceTransaction, M.Refund, M.PaymentTransaction, M.PaymentOrder,
    M.EntitlementUsage, M.Subscription,
    M.TeamInvite, M.Membership, M.Branch, M.Company,
    M.TicketMessage, M.SupportTicket, M.MediaAsset,
    M.UserConsent, M.Session, M.User,
)


@router.post('/reset', response_model=s.OkOut)
async def dev_reset(session: DbSession, settings: AppSettings) -> s.OkOut:
    """Стереть всё и начать с чистого листа. Тарифы остаются."""
    _guard(settings)

    for model in _WIPE_ORDER:
        await session.execute(delete(model))
    await entitlements.ensure_default_plans(session)
    await session.commit()
    transport.clear_inbox(settings.sandbox_inbox_path)
    return s.OkOut()


@router.get('/whoami', response_model=s.MeOut)
async def dev_whoami(principal: CurrentUser, session: DbSession, settings: AppSettings) -> s.MeOut:
    """То же, что `/me`, но с явной проверкой песочницы — для консоли."""
    _guard(settings)
    from app.api.v1.auth import me
    return await me(principal, session)
