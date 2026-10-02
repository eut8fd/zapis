"""
Клиент бота к серверу Zapis.

Раньше у бота была своя база: `bookings.json`, услуги по номеру в списке
и случайная «занятость» мастеров, чтобы слоты выглядели живыми. В боевом
режиме так нельзя — клиент записался бы на занятое время или к мастеру,
который в отпуске. Теперь единственный источник истины — сервер: он
считает слоты теми же правилами, что и приложение, сам создаёт запись
под замком и сам шлёт уведомления. Бот только показывает и спрашивает.

Внутренние маршруты закрыты токеном. На одной машине он читается из
файла в DATA_DIR (сервер кладёт его туда при старте), в контейнерах
передаётся переменной INTERNAL_TOKEN.

Без зависимостей.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))


class ServerError(Exception):
    def __init__(self, status, message, code='error'):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code


def _env(name, default=''):
    return (os.environ.get(name) or default).strip()


def server_url():
    """Адрес сервера. По умолчанию — тот же хост, где и бот."""
    u = _env('SERVER_URL')
    if u:
        return u.rstrip('/')
    port = _env('PORT', '8080')
    return 'http://127.0.0.1:%s' % port


def internal_token():
    tok = _env('INTERNAL_TOKEN')
    if tok:
        return tok
    data_dir = _env('DATA_DIR') or os.path.join(ROOT, '.run')
    try:
        with open(os.path.join(data_dir, 'internal.token'), encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return ''


def call(method, path, body=None, query=None, timeout=15):
    url = server_url() + '/api/v2/internal/' + path.lstrip('/')
    if query:
        url += '?' + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None and v != ''})
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, method=method, data=data, headers={
        'Content-Type': 'application/json', 'X-Internal-Token': internal_token(),
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode('utf-8')).get('error') or {}
        except Exception:  # noqa: BLE001
            err = {}
        raise ServerError(e.code, err.get('message') or ('HTTP %s' % e.code), err.get('code') or 'http')
    except Exception as e:  # noqa: BLE001
        raise ServerError(0, 'сервер недоступен: %s' % str(e)[:120], 'offline')


# ------------------------------------------------------------------ справочник
_cache = {'at': 0.0, 'companies': None}


def companies(force=False, ttl=30):
    """Готовые к записи салоны: id → карточка. Кэш на полминуты — меню
    открывают часто, а справочник меняется редко."""
    now = time.time()
    if not force and _cache['companies'] is not None and now - _cache['at'] < ttl:
        return _cache['companies']
    r = call('GET', 'catalog')
    out = {c['id']: c for c in r.get('companies', [])}
    _cache['companies'] = out
    _cache['at'] = now
    return out


def company(cid):
    """Одна компания, даже если ещё не готова (без адреса, без услуг)."""
    return call('GET', 'company/%s' % urllib.parse.quote(cid)).get('company')


def slots(cid, service_id, date, employee_id=None):
    r = call('GET', 'slots', query={'companyId': cid, 'serviceId': service_id,
                                    'date': date, 'employeeId': employee_id})
    return r.get('slots', [])


def days(cid, service_id, employee_id=None, n=7, start=None):
    r = call('GET', 'days', query={'companyId': cid, 'serviceId': service_id,
                                   'employeeId': employee_id, 'n': n, 'from': start})
    return r.get('days', [])


def book(cid, service_id, date, minute, tg_id, name, username='', employee_id=None, phone=''):
    return call('POST', 'book', body={
        'companyId': cid, 'serviceId': service_id, 'date': date, 'min': minute,
        'tgId': str(tg_id), 'name': name, 'username': username, 'employeeId': employee_id, 'phone': phone,
    }).get('appointment')


def my(tg_id):
    return call('GET', 'my', query={'tgId': str(tg_id)}).get('appointments', [])


def cancel(appointment_id, tg_id):
    return call('POST', 'cancel', body={'id': appointment_id, 'tgId': str(tg_id)}).get('appointment')


def touch_user(tg_id, name='', username='', lang='', company=None):
    return call('POST', 'user', body={'tgId': str(tg_id), 'name': name, 'username': username,
                                      'lang': lang, 'company': company}).get('user')


def user(tg_id):
    return call('GET', 'user', query={'tgId': str(tg_id)}).get('user')


def queue(cid=None):
    return call('GET', 'queue', query={'companyId': cid}).get('queue', [])


def health():
    return call('GET', 'health', timeout=5)
