"""
Изоляция арендаторов и права (AUTH-005, AUTH-006, ТЗ 39).

Проверяем ровно то, что ТЗ называет обязательным: пользователь одной
компании не достаёт данные другой, а фронт не может назначить себе роль.
"""
from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa

from app.db.types import utcnow
from tests.conftest import full_company, login, make_company, next_weekday_at

pytestmark = pytest.mark.asyncio


async def test_company_id_in_url_is_not_proof_of_access(client, sessionmaker, owner):
    """AUTH-006: подставить чужой company_id в URL недостаточно."""
    mine = await full_company(sessionmaker, client, owner['headers'], name='Мой салон')

    stranger = await login(client, first_name='Чужой')
    for path in (
        f'/api/v1/companies/{mine["company_id"]}',
        f'/api/v1/companies/{mine["company_id"]}/clients',
        f'/api/v1/companies/{mine["company_id"]}/employees',
        f'/api/v1/companies/{mine["company_id"]}/services',
    ):
        response = await client.get(path, headers=stranger['headers'])
        assert response.status_code == 403, path
        assert response.json()['error']['code'] == 'tenant_forbidden'


async def test_two_companies_do_not_see_each_others_clients(client, sessionmaker, owner):
    first = await full_company(sessionmaker, client, owner['headers'], name='Первый салон')

    other_owner = await login(client, first_name='Второй владелец')
    second = await full_company(sessionmaker, client, other_owner['headers'], name='Второй салон')

    created = await client.post(
        f'/api/v1/companies/{first["company_id"]}/clients',
        headers=owner['headers'],
        json={'display_name': 'Анна', 'phone': '+7 701 111 11 11'},
    )
    assert created.status_code == 201
    client_id = created.json()['id']

    # Прямое обращение к карточке из другой компании — 404, а не чужие данные.
    leak = await client.get(
        f'/api/v1/companies/{second["company_id"]}/clients/{client_id}',
        headers=other_owner['headers'],
    )
    assert leak.status_code == 404

    listing = await client.get(
        f'/api/v1/companies/{second["company_id"]}/clients', headers=other_owner['headers'],
    )
    assert listing.json()['items'] == []


async def test_nonexistent_company_looks_the_same_as_forbidden(client, owner):
    """Наружу не должно быть видно, существует ли компания."""
    response = await client.get(f'/api/v1/companies/{uuid.uuid4()}', headers=owner['headers'])
    assert response.status_code == 403


async def test_master_cannot_read_full_client_data(client, sessionmaker, owner):
    """ТЗ 39: мастеру положен базовый доступ к клиентам, но не полный."""
    company = await full_company(sessionmaker, client, owner['headers'])

    invite = await client.post(
        f'/api/v1/companies/{company["company_id"]}/invites',
        headers=owner['headers'], json={'role': 'master', 'expires_in_hours': 24},
    )
    assert invite.status_code == 201
    token = invite.json()['token']

    master = await login(client, first_name='Мастер')
    accepted = await client.post(f'/api/v1/invites/{token}/accept', headers=master['headers'])
    assert accepted.status_code == 200
    assert accepted.json()['role'] == 'master'

    await client.post(
        f'/api/v1/companies/{company["company_id"]}/clients',
        headers=owner['headers'], json={'display_name': 'Мария', 'phone': '+77011234567'},
    )

    listing = await client.get(
        f'/api/v1/companies/{company["company_id"]}/clients', headers=master['headers'],
    )
    assert listing.status_code == 200
    phone = listing.json()['items'][0]['phone']
    assert phone != '+77011234567', 'мастер не должен видеть телефон целиком'
    assert phone.endswith('4567')

    # Настройки компании мастер менять не может.
    forbidden = await client.patch(
        f'/api/v1/companies/{company["company_id"]}',
        headers=master['headers'], json={'name': 'Захвачено'},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()['error']['details']['required_permission'] == 'company.settings.write'


async def test_master_sees_only_own_calendar(client, sessionmaker, owner):
    """APT-008: без права на общий календарь мастер видит только себя."""
    company = await full_company(sessionmaker, client, owner['headers'])
    invite = await client.post(
        f'/api/v1/companies/{company["company_id"]}/invites',
        headers=owner['headers'], json={'role': 'master', 'expires_in_hours': 24},
    )
    master = await login(client, first_name='Мастер')
    await client.post(f'/api/v1/invites/{invite.json()["token"]}/accept', headers=master['headers'])

    guest = await login(client, first_name='Клиент')
    when = next_weekday_at(11)
    booked = await client.post(
        f'/api/v1/companies/{company["company_id"]}/appointments/self',
        headers=guest['headers'],
        json={
            'branch_id': company['branch_id'],
            'employee_id': company['employee_id'],
            'service_ids': [company['service_id']],
            'starts_at': when.isoformat(),
        },
    )
    assert booked.status_code == 201

    day = when.date().isoformat()
    owner_view = await client.get(
        f'/api/v1/companies/{company["company_id"]}/appointments',
        headers=owner['headers'], params={'date_from': day, 'date_to': day},
    )
    assert len(owner_view.json()) == 1

    master_view = await client.get(
        f'/api/v1/companies/{company["company_id"]}/appointments',
        headers=master['headers'], params={'date_from': day, 'date_to': day},
    )
    # Мастер-новичок в этой записи не участвует — чужой календарь ему не виден.
    assert master_view.json() == []


async def test_invite_token_is_single_use(client, sessionmaker, owner):
    """TEAM-002: consume приглашения атомарен, второй раз не сработает."""
    company = await full_company(sessionmaker, client, owner['headers'])
    invite = await client.post(
        f'/api/v1/companies/{company["company_id"]}/invites',
        headers=owner['headers'], json={'role': 'manager', 'expires_in_hours': 24},
    )
    token = invite.json()['token']

    first = await login(client, first_name='Первый')
    second = await login(client, first_name='Второй')

    assert (await client.post(f'/api/v1/invites/{token}/accept',
                              headers=first['headers'])).status_code == 200
    reused = await client.post(f'/api/v1/invites/{token}/accept', headers=second['headers'])
    assert reused.status_code == 422


async def test_invite_token_is_stored_only_as_hash(client, sessionmaker, owner):
    """TEAM-001: в БД лежит hash, сам токен наружу больше не отдаётся."""
    from app.db.models import TeamInvite

    company = await full_company(sessionmaker, client, owner['headers'])
    created = await client.post(
        f'/api/v1/companies/{company["company_id"]}/invites',
        headers=owner['headers'], json={'role': 'master', 'expires_in_hours': 24},
    )
    token = created.json()['token']

    async with sessionmaker() as session:
        rows = (await session.execute(sa.select(TeamInvite))).scalars().all()
    assert len(rows) == 1
    assert token not in rows[0].token_hash
    assert len(rows[0].token_hash) == 64

    listing = await client.get(
        f'/api/v1/companies/{company["company_id"]}/invites', headers=owner['headers'],
    )
    assert 'token' not in listing.json()[0]


async def test_termination_revokes_access_immediately(client, sessionmaker, owner):
    """AUTH-009 и TEAM-005: увольнение закрывает доступ, не дожидаясь токена."""
    company = await full_company(sessionmaker, client, owner['headers'])
    invite = await client.post(
        f'/api/v1/companies/{company["company_id"]}/invites',
        headers=owner['headers'], json={'role': 'manager', 'expires_in_hours': 24},
    )
    manager = await login(client, first_name='Менеджер')
    accepted = await client.post(
        f'/api/v1/invites/{invite.json()["token"]}/accept', headers=manager['headers'],
    )
    employee_id = accepted.json()['employee_id']

    assert (await client.get(
        f'/api/v1/companies/{company["company_id"]}/services', headers=manager['headers'],
    )).status_code == 200

    fired = await client.post(
        f'/api/v1/companies/{company["company_id"]}/employees/{employee_id}/terminate',
        headers=owner['headers'],
        json={'reason': 'окончание договора', 'future_appointments': 'keep'},
    )
    assert fired.status_code == 200

    after = await client.get(
        f'/api/v1/companies/{company["company_id"]}/services', headers=manager['headers'],
    )
    assert after.status_code == 401, 'сессия уволенного должна быть отозвана'


async def test_owner_cannot_be_terminated(client, sessionmaker, owner):
    company = await full_company(sessionmaker, client, owner['headers'])
    async with sessionmaker() as session:
        from app.db.models import Employee, Membership
        membership = await session.scalar(
            sa.select(Membership).where(
                Membership.company_id == uuid.UUID(company['company_id']),
                Membership.role == 'owner',
            )
        )
        employee = Employee(
            id=uuid.uuid4(), company_id=uuid.UUID(company['company_id']),
            display_name='Владелец', takes_appointments=False, active=True,
            created_at=utcnow(), updated_at=utcnow(),
        )
        session.add(employee)
        await session.flush()
        membership.employee_id = employee.id
        await session.commit()
        employee_id = str(employee.id)

    response = await client.post(
        f'/api/v1/companies/{company["company_id"]}/employees/{employee_id}/terminate',
        headers=owner['headers'],
        json={'reason': 'проверка', 'future_appointments': 'keep'},
    )
    assert response.status_code == 422
    assert 'Владельца' in response.json()['error']['message']


async def test_draft_company_is_invisible_in_catalog(client, sessionmaker, owner):
    """CAT-001: черновик снаружи не существует."""
    await make_company(client, owner['headers'], name='Черновик')

    catalog = await client.get('/api/v1/public/companies')
    assert catalog.status_code == 200
    assert catalog.json()['items'] == []


async def test_published_company_appears_with_public_fields_only(client, sessionmaker, owner):
    company = await full_company(sessionmaker, client, owner['headers'], name='Витрина')

    catalog = await client.get('/api/v1/public/companies', params={'q': 'Витрина'})
    items = catalog.json()['items']
    assert len(items) == 1
    assert set(items[0]) == {
        'id', 'slug', 'name', 'category', 'description', 'currency_code', 'city', 'address',
        'rating', 'reviews_count', 'min_price_minor', 'next_available_at', 'distance_km',
    }

    page = await client.get(f'/api/v1/public/companies/{company["slug"]}')
    assert page.status_code == 200
    assert 'owner_user_id' not in page.json()
    assert 'settings' not in page.json()


async def test_public_availability_needs_no_session(client, sessionmaker, owner):
    company = await full_company(sessionmaker, client, owner['headers'])
    when = next_weekday_at(11)

    response = await client.get(
        f'/api/v1/public/companies/{company["slug"]}/availability',
        params={'service_ids': company['service_id'], 'date_from': when.date().isoformat()},
    )
    assert response.status_code == 200
    assert response.json()['timezone'] == 'Asia/Almaty'
