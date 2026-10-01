"""
Общая обвязка тестов.

БД поднимается файловая, а не `:memory:`: тесту двойного бронирования
нужны два независимых соединения, а in-memory SQLite их не разделяет.
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import uuid
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault('APP_ENV', 'test')
os.environ.setdefault('BOT_TOKEN', '123456:TEST-BOT-TOKEN-FOR-UNIT-TESTS')
os.environ.setdefault('SESSION_SECRET', 'x' * 48)
os.environ.setdefault('RATE_LIMIT_ANON_PER_MIN', '100000')
os.environ.setdefault('RATE_LIMIT_USER_PER_MIN', '100000')
os.environ.setdefault('RATE_LIMIT_AUTH_PER_MIN', '100000')

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: E402

from app.config import get_settings, reset_settings_cache  # noqa: E402
from app.core.security import build_init_data  # noqa: E402
from app.db import base as db  # noqa: E402
from app.db.models import (  # noqa: E402
    Base, Branch, Company, Employee, EmployeeBranch, EmployeeService, Service, User,
    WeeklyScheduleRule,
)
from app.db.types import new_uuid, utcnow  # noqa: E402
from app.domain import CompanyStatus  # noqa: E402
from app.services import entitlements  # noqa: E402

BOT_TOKEN = os.environ['BOT_TOKEN']
TZ = 'Asia/Almaty'


@pytest.fixture(scope='session')
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def engine():
    reset_settings_cache()
    handle, path = tempfile.mkstemp(suffix='.db', prefix='zapis-test-')
    os.close(handle)
    os.environ['DATABASE_URL'] = f'sqlite+aiosqlite:///{Path(path).as_posix()}'
    reset_settings_cache()

    eng = db.create_engine(get_settings())
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    db.configure(eng)
    try:
        yield eng
    finally:
        # dispose_engine гасит именно сконфигурированный engine; повторный
        # dispose того же объекта на Windows ловит CancelledError в rollback.
        await db.dispose_engine()
        for _ in range(20):
            try:
                Path(path).unlink(missing_ok=True)
                break
            except PermissionError:
                # Windows держит файл, пока не закроется последний хэндл.
                await asyncio.sleep(0.05)


@pytest_asyncio.fixture
async def sessionmaker(engine) -> async_sessionmaker:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


@pytest_asyncio.fixture
async def seeded(sessionmaker):
    async with sessionmaker() as session:
        await entitlements.ensure_default_plans(session)
        await session.commit()
    return True


@pytest_asyncio.fixture
async def client(engine, seeded):
    from app.main import create_app

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as ac:
        yield ac


# --------------------------------------------------------------- помощники

_next_tg_id = iter(range(700_000_001, 700_010_000))


def init_data_for(telegram_id: int, *, first_name: str = 'Тест', username: str | None = None,
                  auth_date: int | None = None) -> str:
    return build_init_data(
        BOT_TOKEN,
        {'id': telegram_id, 'first_name': first_name, 'username': username, 'language_code': 'ru'},
        auth_date=auth_date,
    )


async def login(client: AsyncClient, telegram_id: int | None = None, **kw) -> dict:
    """Возвращает {'telegram_id', 'access_token', 'refresh_token', 'headers'}."""
    telegram_id = telegram_id or next(_next_tg_id)
    response = await client.post(
        '/api/v1/auth/telegram/exchange',
        json={'init_data': init_data_for(telegram_id, **kw), 'client': 'miniapp'},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return {
        'telegram_id': telegram_id,
        'access_token': body['access_token'],
        'refresh_token': body['refresh_token'],
        'headers': {'Authorization': f'Bearer {body["access_token"]}'},
    }


@pytest_asyncio.fixture
async def owner(client):
    return await login(client, first_name='Владелец')


async def make_company(
    client: AsyncClient, headers: dict, *, name: str = 'Салон Пример',
) -> dict:
    response = await client.post(
        '/api/v1/companies',
        headers=headers,
        json={
            'name': name,
            'category': 'beauty',
            'city': 'Алматы',
            'timezone': TZ,
            'currency_code': 'KZT',
            'default_locale': 'ru',
            'phone': '+7 701 000 00 00',
            'address': 'ул. Абая, 10',
            'accepted_terms_version': '1.0',
            'accepted_privacy_version': '1.0',
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def full_company(sessionmaker, client, headers, *, name: str = 'Салон Пример') -> dict:
    """
    Компания, готовая принимать записи: филиал, услуга, мастер, график.
    Собирается через БД — это фикстура, а не проверка API.
    """
    company = await make_company(client, headers, name=name)
    company_id = uuid.UUID(company['id'])

    async with sessionmaker() as session:
        branch = await session.scalar(
            __import__('sqlalchemy').select(Branch).where(Branch.company_id == company_id)
        )
        now = utcnow()

        service = Service(
            id=new_uuid(), company_id=company_id, name='Стрижка',
            price_minor=500000, currency_code='KZT', duration_minutes=60,
            buffer_before_minutes=0, buffer_after_minutes=15,
            active=True, public=True, created_at=now, updated_at=now,
        )
        session.add(service)

        employee = Employee(
            id=new_uuid(), company_id=company_id, display_name='Айгуль',
            takes_appointments=True, active=True, public=True,
            created_at=now, updated_at=now,
        )
        session.add(employee)
        await session.flush()

        session.add(EmployeeBranch(
            id=new_uuid(), company_id=company_id, employee_id=employee.id, branch_id=branch.id,
        ))
        session.add(EmployeeService(
            id=new_uuid(), company_id=company_id, employee_id=employee.id, service_id=service.id,
        ))

        for weekday in range(0, 7):
            session.add(WeeklyScheduleRule(
                id=new_uuid(), company_id=company_id, branch_id=branch.id, employee_id=None,
                weekday=weekday, start_local_time=time(10, 0), end_local_time=time(20, 0),
                active=True, created_at=now, updated_at=now,
            ))

        company_row = await session.get(Company, company_id)
        company_row.description = 'Уютный салон в центре'
        company_row.status = CompanyStatus.PUBLISHED
        company_row.published_at = now
        await session.commit()

        return {
            'company_id': str(company_id),
            'slug': company['slug'],
            'branch_id': str(branch.id),
            'service_id': str(service.id),
            'employee_id': str(employee.id),
            'timezone': TZ,
        }


def next_weekday_at(hour: int, minute: int = 0, *, days_ahead: int = 2) -> datetime:
    """Время в будущем, кратное сетке, внутри рабочего дня 10:00–20:00 Алматы."""
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(TZ)
    target = (datetime.now(tz) + timedelta(days=days_ahead)).replace(
        hour=hour, minute=minute, second=0, microsecond=0,
    )
    return target.astimezone(timezone.utc)


async def grant_platform_role(sessionmaker, telegram_id: int, role: str) -> None:
    import sqlalchemy as sa

    async with sessionmaker() as session:
        user = await session.scalar(sa.select(User).where(User.telegram_user_id == telegram_id))
        user.platform_role = role
        await session.commit()
