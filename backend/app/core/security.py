"""
Криптография и проверка Telegram identity.

AUTH-002: initData проверяется официальным алгоритмом подписи на backend.
Ни одно поле `initDataUnsafe` не считается доказательством личности.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl

from app.core.errors import InvalidTelegramAuth

# --------------------------------------------------------------------- хэши

def sha256_hex(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode('utf-8')
    return hashlib.sha256(value).hexdigest()


def hash_token(token: str) -> str:
    """Токены в БД лежат только хэшем — дамп не даёт войти."""
    return sha256_hex(token)


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


def hash_ip(ip: str | None, secret: str) -> str | None:
    """IP в журнале — только псевдоним: сам адрес нам для диагностики не нужен."""
    if not ip:
        return None
    return hmac.new(secret.encode('utf-8'), ip.encode('utf-8'), hashlib.sha256).hexdigest()[:32]


# ------------------------------------------------------- Telegram initData

@dataclass(frozen=True)
class TelegramIdentity:
    telegram_user_id: int
    first_name: str | None
    last_name: str | None
    username: str | None
    language_code: str
    is_premium: bool
    auth_date: int
    start_param: str | None
    chat_instance: str | None
    raw_user: dict[str, Any]


def _webapp_secret_key(bot_token: str) -> bytes:
    # Telegram: secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
    return hmac.new(b'WebAppData', bot_token.encode('utf-8'), hashlib.sha256).digest()


def verify_init_data(
    init_data: str,
    bot_token: str,
    *,
    max_age_seconds: int,
    now: int | None = None,
) -> TelegramIdentity:
    """
    Проверяет подпись и срок initData. Возвращает identity или падает
    InvalidTelegramAuth — без деталей наружу, чтобы не подсказывать подбор.
    """
    if not init_data:
        raise InvalidTelegramAuth('initData пуст')
    if not bot_token:
        raise InvalidTelegramAuth('Сервер не сконфигурирован для проверки Telegram')

    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise InvalidTelegramAuth('initData повреждён') from exc

    data = dict(pairs)
    received_hash = data.pop('hash', None)
    if not received_hash:
        raise InvalidTelegramAuth('initData без подписи')
    # signature — поле Telegram Ed25519-варианта, в контрольную строку HMAC не входит.
    data.pop('signature', None)

    check_string = '\n'.join(f'{k}={data[k]}' for k in sorted(data))
    secret = _webapp_secret_key(bot_token)
    expected = hmac.new(secret, check_string.encode('utf-8'), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, received_hash):
        raise InvalidTelegramAuth()

    # AUTH-003: просроченный initData не годится для создания сессии.
    try:
        auth_date = int(data.get('auth_date', '0'))
    except ValueError as exc:
        raise InvalidTelegramAuth('Некорректный auth_date') from exc
    current = now if now is not None else int(time.time())
    if auth_date <= 0 or current - auth_date > max_age_seconds:
        raise InvalidTelegramAuth('Данные Telegram устарели, откройте приложение заново')
    # Небольшой допуск вперёд: часы клиента и сервера расходятся.
    if auth_date - current > 60:
        raise InvalidTelegramAuth('Некорректный auth_date')

    raw_user = data.get('user')
    if not raw_user:
        raise InvalidTelegramAuth('initData без пользователя')
    try:
        user = json.loads(raw_user)
    except json.JSONDecodeError as exc:
        raise InvalidTelegramAuth('initData повреждён') from exc

    telegram_user_id = user.get('id')
    if not isinstance(telegram_user_id, int):
        raise InvalidTelegramAuth('initData без идентификатора пользователя')

    return TelegramIdentity(
        telegram_user_id=telegram_user_id,
        first_name=user.get('first_name'),
        last_name=user.get('last_name'),
        username=user.get('username'),
        language_code=(user.get('language_code') or 'ru')[:8],
        is_premium=bool(user.get('is_premium')),
        auth_date=auth_date,
        start_param=data.get('start_param'),
        chat_instance=data.get('chat_instance'),
        raw_user=user,
    )


def build_init_data(bot_token: str, user: dict[str, Any], *, auth_date: int | None = None,
                    start_param: str | None = None) -> str:
    """
    Собирает подписанный initData. Нужен тестам и локальной разработке —
    в production-путь не входит, но живёт рядом с проверкой, чтобы алгоритм
    правился в одном месте.
    """
    from urllib.parse import urlencode

    fields: dict[str, str] = {
        'auth_date': str(auth_date or int(time.time())),
        'query_id': 'AAtest',
        'user': json.dumps(user, ensure_ascii=False, separators=(',', ':')),
    }
    if start_param:
        fields['start_param'] = start_param
    check_string = '\n'.join(f'{k}={fields[k]}' for k in sorted(fields))
    secret = _webapp_secret_key(bot_token)
    fields['hash'] = hmac.new(secret, check_string.encode('utf-8'), hashlib.sha256).hexdigest()
    return urlencode(fields)


# ------------------------------------------------------------ access token

def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')


def _b64url_decode(value: str) -> bytes:
    padding = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def issue_access_token(payload: dict[str, Any], secret: str, ttl_seconds: int,
                       *, now: int | None = None) -> str:
    """
    Компактный подписанный токен (HMAC-SHA256), формат совместим с JWT HS256.
    Своя реализация вместо библиотеки: нужен ровно один алгоритм, и подмена
    `alg: none` в таком коде физически невозможна.
    """
    issued = now if now is not None else int(time.time())
    header = {'alg': 'HS256', 'typ': 'JWT'}
    body = dict(payload, iat=issued, exp=issued + ttl_seconds)
    head_b64 = _b64url(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    body_b64 = _b64url(json.dumps(body, separators=(',', ':'), default=str).encode('utf-8'))
    signing_input = f'{head_b64}.{body_b64}'.encode('ascii')
    signature = hmac.new(secret.encode('utf-8'), signing_input, hashlib.sha256).digest()
    return f'{head_b64}.{body_b64}.{_b64url(signature)}'


def read_access_token(token: str, secret: str, *, now: int | None = None) -> dict[str, Any]:
    """Проверяет подпись и срок. Любая проблема — SessionExpired/Unauthorized."""
    from app.core.errors import SessionExpired, Unauthorized

    parts = token.split('.')
    if len(parts) != 3:
        raise Unauthorized('Некорректный токен')
    head_b64, body_b64, sig_b64 = parts

    signing_input = f'{head_b64}.{body_b64}'.encode('ascii')
    expected = hmac.new(secret.encode('utf-8'), signing_input, hashlib.sha256).digest()
    try:
        given = _b64url_decode(sig_b64)
    except (ValueError, TypeError) as exc:
        raise Unauthorized('Некорректный токен') from exc
    if not hmac.compare_digest(expected, given):
        raise Unauthorized('Некорректный токен')

    try:
        header = json.loads(_b64url_decode(head_b64))
        body = json.loads(_b64url_decode(body_b64))
    except (ValueError, TypeError) as exc:
        raise Unauthorized('Некорректный токен') from exc

    if header.get('alg') != 'HS256':
        raise Unauthorized('Некорректный токен')

    current = now if now is not None else int(time.time())
    if int(body.get('exp', 0)) <= current:
        raise SessionExpired()
    return body
