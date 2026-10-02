"""
Кто пришёл: проверка подписи Telegram initData.

Mini App получает от Telegram строку initData, подписанную HMAC-SHA256
ключом, который выводится из токена бота. Проверив подпись, сервер знает
telegram-id человека наверняка — поля initDataUnsafe на стороне приложения
доказательством не являются: их подставит кто угодно.

Алгоритм официальный: secret = HMAC_SHA256("WebAppData", bot_token),
hash = HMAC_SHA256(secret, "k1=v1\nk2=v2…" по отсортированным ключам).

Для разработки есть вход без Telegram (DEV_AUTH=1): обычный браузер
представляется заголовком X-Dev-User. В бою флаг выключен.
"""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


class AuthError(Exception):
    pass


def _secret_key(bot_token):
    return hmac.new(b'WebAppData', bot_token.encode('utf-8'), hashlib.sha256).digest()


def verify_init_data(init_data, bot_token, max_age=86400, now=None):
    """Возвращает dict user из initData или бросает AuthError."""
    if not init_data:
        raise AuthError('initData пуст')
    if not bot_token:
        raise AuthError('сервер без BOT_TOKEN не может проверить подпись')
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        raise AuthError('initData повреждён')
    data = dict(pairs)
    received = data.pop('hash', None)
    if not received:
        raise AuthError('initData без подписи')
    # Ed25519-вариант подписи в контрольную строку не входит
    data.pop('signature', None)
    check = '\n'.join('%s=%s' % (k, data[k]) for k in sorted(data))
    expected = hmac.new(_secret_key(bot_token), check.encode('utf-8'), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise AuthError('подпись не сходится')
    try:
        auth_date = int(data.get('auth_date', '0'))
    except ValueError:
        raise AuthError('auth_date некорректен')
    cur = now if now is not None else int(time.time())
    if auth_date <= 0 or cur - auth_date > max_age:
        raise AuthError('данные Telegram устарели, откройте приложение заново')
    if auth_date - cur > 120:
        raise AuthError('auth_date из будущего')
    try:
        user = json.loads(data.get('user') or '')
    except ValueError:
        raise AuthError('initData без пользователя')
    if not isinstance(user, dict) or not isinstance(user.get('id'), int):
        raise AuthError('initData без идентификатора')
    user = dict(user)
    user['start_param'] = data.get('start_param') or ''
    return user


def build_init_data(bot_token, user, auth_date=None, start_param=None):
    """Подписанный initData — для тестов и локальной проверки."""
    from urllib.parse import urlencode
    fields = {
        'auth_date': str(auth_date or int(time.time())),
        'query_id': 'AAtest',
        'user': json.dumps(user, ensure_ascii=False, separators=(',', ':')),
    }
    if start_param:
        fields['start_param'] = start_param
    check = '\n'.join('%s=%s' % (k, fields[k]) for k in sorted(fields))
    fields['hash'] = hmac.new(_secret_key(bot_token), check.encode('utf-8'), hashlib.sha256).hexdigest()
    return urlencode(fields)


def parse_dev_user(header):
    """
    X-Dev-User: JSON {"id": 1, "first_name": "Тест", "username": "test"}
    или короткая форма "1:Имя". Только при DEV_AUTH=1.
    """
    if not header:
        raise AuthError('нет X-Dev-User')
    # HTTP-заголовки — latin-1; кириллицу в имени шлют percent-encoded
    from urllib.parse import unquote
    header = unquote(header).strip()
    if header.startswith('{'):
        try:
            u = json.loads(header)
        except ValueError:
            raise AuthError('X-Dev-User не JSON')
    else:
        parts = header.split(':', 1)
        u = {'id': parts[0], 'first_name': parts[1] if len(parts) > 1 else 'Тест'}
    try:
        u['id'] = int(u['id'])
    except (KeyError, ValueError, TypeError):
        raise AuthError('X-Dev-User без id')
    u.setdefault('first_name', 'Тест')
    u.setdefault('username', '')
    u.setdefault('start_param', '')
    return u


class Identity:
    """Проверенный человек на время одного запроса."""

    __slots__ = ('tg_id', 'name', 'username', 'lang', 'is_admin', 'raw', 'dev')

    def __init__(self, user, admin_ids=(), dev=False):
        self.tg_id = str(user['id'])
        self.name = ' '.join(x for x in [user.get('first_name'), user.get('last_name')] if x).strip() or 'Гость'
        self.username = (user.get('username') or '').lstrip('@')
        self.lang = (user.get('language_code') or 'ru')[:8]
        self.is_admin = self.tg_id in set(map(str, admin_ids))
        self.raw = user
        self.dev = dev

    def as_dict(self):
        return {
            'tgId': self.tg_id, 'name': self.name, 'username': self.username,
            'lang': self.lang, 'isAdmin': self.is_admin,
        }
