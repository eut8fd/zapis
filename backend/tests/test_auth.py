"""
Аутентификация и сессии (AUTH-001…AUTH-009).

Эти тесты — про то, чего система делать не должна: принимать подделанный
initData, верить просроченному, отдавать данные без сессии и оставлять
доступ после отзыва.
"""
from __future__ import annotations

import time

import pytest

from tests.conftest import init_data_for, login

pytestmark = pytest.mark.asyncio


async def test_valid_init_data_creates_session(client):
    response = await client.post(
        '/api/v1/auth/telegram/exchange',
        json={'init_data': init_data_for(700_100_001), 'client': 'miniapp'},
    )
    assert response.status_code == 200
    body = response.json()
    assert body['token_type'] == 'Bearer'
    assert body['expires_in'] <= 3600
    assert body['access_token'] and body['refresh_token']


async def test_tampered_hash_rejected(client):
    """AUTH-002: подпись проверяется, изменённые данные не проходят."""
    raw = init_data_for(700_100_002)
    tampered = raw.replace('700100002', '700100999')
    response = await client.post(
        '/api/v1/auth/telegram/exchange', json={'init_data': tampered, 'client': 'miniapp'},
    )
    assert response.status_code == 401
    assert response.json()['error']['code'] == 'invalid_telegram_auth'


async def test_foreign_token_signature_rejected(client):
    from app.core.security import build_init_data

    forged = build_init_data('999999:SOMEONE-ELSES-TOKEN', {'id': 700_100_003, 'first_name': 'X'})
    response = await client.post(
        '/api/v1/auth/telegram/exchange', json={'init_data': forged, 'client': 'miniapp'},
    )
    assert response.status_code == 401


async def test_expired_auth_date_rejected(client):
    """AUTH-003: старый initData не годится для создания сессии."""
    stale = init_data_for(700_100_004, auth_date=int(time.time()) - 3600)
    response = await client.post(
        '/api/v1/auth/telegram/exchange', json={'init_data': stale, 'client': 'miniapp'},
    )
    assert response.status_code == 401


async def test_me_requires_session(client):
    assert (await client.get('/api/v1/me')).status_code == 401
    assert (await client.get(
        '/api/v1/me', headers={'Authorization': 'Bearer not-a-token'},
    )).status_code == 401


async def test_me_returns_server_side_role(client):
    """AUTH-001: роль приходит с сервера; у нового пользователя её просто нет."""
    session = await login(client, 700_100_005, first_name='Клиент')
    response = await client.get('/api/v1/me', headers=session['headers'])
    assert response.status_code == 200
    body = response.json()
    assert body['memberships'] == []
    assert body['platform_role'] == 'none'


async def test_refresh_rotates_and_old_token_dies(client):
    session = await login(client, 700_100_006)
    first = await client.post(
        '/api/v1/auth/refresh', json={'refresh_token': session['refresh_token']},
    )
    assert first.status_code == 200
    assert first.json()['refresh_token'] != session['refresh_token']

    # Повторное использование старого токена — признак кражи: гасим всё.
    reuse = await client.post(
        '/api/v1/auth/refresh', json={'refresh_token': session['refresh_token']},
    )
    assert reuse.status_code == 401

    dead = await client.post(
        '/api/v1/auth/refresh', json={'refresh_token': first.json()['refresh_token']},
    )
    assert dead.status_code == 401, 'все сессии пользователя должны быть отозваны'


async def test_logout_invalidates_access_token(client):
    """AUTH-008: выход завершает сессию сразу, а не по истечении токена."""
    session = await login(client, 700_100_007)
    assert (await client.get('/api/v1/me', headers=session['headers'])).status_code == 200

    assert (await client.post('/api/v1/auth/logout', headers=session['headers'])).status_code == 200
    assert (await client.get('/api/v1/me', headers=session['headers'])).status_code == 401


async def test_profile_update_normalizes_phone(client):
    session = await login(client, 700_100_008)
    response = await client.patch(
        '/api/v1/me/profile', headers=session['headers'],
        json={'phone': '8 (701) 234-56-78', 'language_code': 'kk'},
    )
    assert response.status_code == 200
    assert response.json()['phone'] == '+77012345678'
    assert response.json()['language_code'] == 'kk'


async def test_profile_rejects_unsupported_language(client):
    session = await login(client, 700_100_009)
    response = await client.patch(
        '/api/v1/me/profile', headers=session['headers'], json={'language_code': 'de'},
    )
    assert response.status_code == 422


async def test_access_token_cannot_be_forged_with_alg_none(client):
    """Собственный формат токена не принимает alg:none — классическая дыра JWT."""
    import base64
    import json

    header = base64.urlsafe_b64encode(json.dumps({'alg': 'none'}).encode()).decode().rstrip('=')
    body = base64.urlsafe_b64encode(
        json.dumps({'sub': '00000000-0000-0000-0000-000000000001',
                    'sid': '00000000-0000-0000-0000-000000000002',
                    'exp': int(time.time()) + 999}).encode()
    ).decode().rstrip('=')
    forged = f'{header}.{body}.'

    response = await client.get('/api/v1/me', headers={'Authorization': f'Bearer {forged}'})
    assert response.status_code == 401
