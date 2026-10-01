"""
Песочница: вход без Telegram и доставка уведомлений на экран.

Главное здесь — не то, что песочница работает, а то, что она не может
оказаться включённой где-либо, кроме локальной машины.
"""
from __future__ import annotations

import json
import os

import pytest

from app.config import ConfigError, build_settings

pytestmark = pytest.mark.asyncio

BASE_ENV = {
    'APP_ENV': 'local',
    'DEV_AUTH_ENABLED': 'true',
    'NOTIFY_TRANSPORT': 'local',
    'SESSION_SECRET': 'z' * 48,
    'BOT_TOKEN': '',
    'DATABASE_URL': 'sqlite+aiosqlite:///sandbox-test.db',
}

PROD_ENV = {
    'DATABASE_URL': 'postgresql+asyncpg://u:p@h/db',
    'PUBLIC_BASE_URL': 'https://zapis.example',
    'REDIS_URL': 'redis://redis:6379/0',
    'EXPOSE_API_DOCS': 'false',
    'BOT_TOKEN': '1:aaa',
}


def _with_env(**overrides):
    """Подменяет окружение на время одного вызова build_settings()."""
    saved = dict(os.environ)
    os.environ.update({**BASE_ENV, **overrides})
    try:
        return build_settings()
    finally:
        os.environ.clear()
        os.environ.update(saved)


def _expect_config_error(**overrides) -> str:
    saved = dict(os.environ)
    os.environ.update({**BASE_ENV, **overrides})
    try:
        build_settings()
    except ConfigError as exc:
        return str(exc)
    finally:
        os.environ.clear()
        os.environ.update(saved)
    raise AssertionError('конфигурация должна была отказать')


async def test_sandbox_allowed_locally():
    settings = _with_env()
    assert settings.dev_auth_enabled
    assert settings.notify_transport == 'local'


async def test_bot_token_not_required_in_sandbox():
    """В песочнице Telegram не участвует — токен требовать не за что."""
    settings = _with_env(BOT_TOKEN='')
    assert settings.telegram_bot_token == ''


async def test_dev_auth_refused_in_production():
    message = _expect_config_error(APP_ENV='production', **PROD_ENV)
    assert 'DEV_AUTH_ENABLED' in message
    assert 'NOTIFY_TRANSPORT=local' in message


async def test_dev_auth_refused_in_staging():
    message = _expect_config_error(APP_ENV='staging', **PROD_ENV)
    assert 'DEV_AUTH_ENABLED' in message


async def test_unknown_transport_refused():
    message = _expect_config_error(NOTIFY_TRANSPORT='carrier_pigeon')
    assert 'NOTIFY_TRANSPORT' in message


async def test_sandbox_routes_absent_without_flag(client):
    """Без флага маршрутов песочницы не существует — не 403, а 404."""
    for path in ('/api/v1/dev/login', '/api/v1/dev/inbox', '/api/v1/dev/state'):
        response = await client.get(path)
        assert response.status_code == 404, path

    reset = await client.post('/api/v1/dev/reset')
    assert reset.status_code == 404


async def test_synthetic_id_is_stable_and_outside_real_range():
    from app.sandbox.routes import SYNTHETIC_BASE, synthetic_telegram_id

    first = synthetic_telegram_id('Айгуль Салонова')
    assert first == synthetic_telegram_id('  айгуль салонова ')
    assert first != synthetic_telegram_id('Ержан Клиентов')
    assert first >= SYNTHETIC_BASE


async def test_local_transport_writes_and_reads_back(tmp_path):
    from app.workers.transport import LocalInboxTransport, clear_inbox, read_inbox

    path = tmp_path / 'inbox.jsonl'
    async with LocalInboxTransport(path) as inbox:
        assert (await inbox.send_message(555, 'Вы записаны')).ok
        assert (await inbox.send_message(777, 'Напоминание')).ok

    everyone = read_inbox(path)
    assert [m['text'] for m in everyone] == ['Вы записаны', 'Напоминание']
    assert [m['to'] for m in read_inbox(path, recipient=777)] == [777]

    # Файл читается построчно: битая строка не должна ронять инбокс.
    with path.open('a', encoding='utf-8') as f:
        f.write('это не json\n')
    assert len(read_inbox(path)) == 2

    clear_inbox(path)
    assert read_inbox(path) == []


async def test_transport_factory_follows_config(tmp_path):
    from app.workers import transport
    from app.workers.telegram import TelegramClient

    local = _with_env(SANDBOX_INBOX_PATH=str(tmp_path / 'i.jsonl'))
    assert isinstance(transport.build(local), transport.LocalInboxTransport)

    telegram = _with_env(NOTIFY_TRANSPORT='telegram', BOT_TOKEN='1:aaa')
    assert isinstance(transport.build(telegram), TelegramClient)


async def test_inbox_record_shape(tmp_path):
    """Консоль читает файл напрямую — состав полей часть контракта."""
    from app.workers.transport import LocalInboxTransport

    path = tmp_path / 'inbox.jsonl'
    async with LocalInboxTransport(path) as inbox:
        await inbox.send_message(42, 'Привет')

    record = json.loads(path.read_text(encoding='utf-8').strip())
    assert set(record) == {'at', 'to', 'text'}
    assert record['to'] == 42
