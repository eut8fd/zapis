"""
Общий склад бота и Mini App.

Приложение выкладывает сюда справочник (компании, услуги, мастера, часы),
бот его читает — и знает все салоны каталога, а не три из файла. Записи
складываются в один список в формате приложения, поэтому напоминания
уходят и по тем, что сделаны в приложении, а не только в чате.

Файл один: `.run/shared.json`. Пишем через временный и переименование —
читатель не должен застать его наполовину записанным. Своей копии данных
модуль не держит: файл меняется снаружи, и кэш быстро разошёлся бы
с действительностью.

Без зависимостей.
"""
import json
import os
import threading

_HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.abspath(os.path.join(_HERE, '..', '.run', 'shared.json'))

_LOCK = threading.Lock()
_EMPTY = {'catalog': None, 'appointments': [], 'updatedAt': 0}

# Цена в формате приложения — число; в боте она везде строкой.
# Разделитель разрядов — неразрывный пробел (U+00A0), чтобы «6 000 ₸»
# не переносилось по строке в сообщении.
def money(n):
    try:
        n = int(round(float(n)))
    except Exception:                       # noqa: BLE001
        return ''
    s = '{:,}'.format(n).replace(',', ' ')
    return s + ' ₸'


def dur_text(m):
    m = int(m or 0)
    if m < 60:
        return '%d мин' % m
    h, rest = m // 60, m % 60
    return ('%d ч %d мин' % (h, rest)) if rest else ('%d ч' % h)


def read():
    try:
        with open(STORE, encoding='utf-8-sig') as f:
            data = json.load(f)
    except Exception:                       # noqa: BLE001 — файла ещё нет
        return dict(_EMPTY)
    for k, v in _EMPTY.items():
        data.setdefault(k, v)
    return data


def write(data):
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    tmp = STORE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, STORE)


def available():
    """Есть ли справочник от приложения."""
    return bool(read().get('catalog'))


# ------------------------------------------------------------------ справочник
def companies():
    """
    Справочник в том виде, в каком его ждёт бот, плюс два массива с
    настоящими идентификаторами. Бот внутри адресует услугу и мастера
    номером в списке — сохраняем этот порядок, а по номеру всегда можно
    достать id для общей записи.
    """
    cat = read().get('catalog')
    if not cat:
        return None
    out = {}
    for c in cat:
        svcs = c.get('services') or []
        staff = c.get('staff') or []
        if not svcs or not staff:
            continue
        out[c['id']] = {
            'name': c.get('name', ''), 'short': c.get('short') or c.get('name', ''),
            'cat': c.get('cat', ''), 'city': c.get('city', ''),
            'addr': c.get('addr', ''), 'phone': c.get('phone', ''),
            'rating': c.get('rating', 5.0), 'reviews': 0,
            'hours': hours_text(c.get('hours')),
            'plan': c.get('plan', 'PRO'), 'about': '',
            'staff': [{'name': (e.get('name') or '').split(' ')[0],
                       'role': e.get('role', 'Мастер'), 'cats': []} for e in staff],
            'services': [[s.get('name', ''), money(s.get('price')),
                          dur_text(s.get('duration')), int(s.get('duration') or 60),
                          s.get('cat', 'other')] for s in svcs],
            'more': [],
            # то, чего в старом файле не было
            'serviceIds': [s.get('id') for s in svcs],
            'staffIds': [e.get('id') for e in staff],
            'servicePrices': [int(s.get('price') or 0) for s in svcs],
            'staffFull': [e.get('name', '') for e in staff],
        }
    return out or None


WD_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']


def hours_text(hours):
    """«Пн–Пт 09:00–20:00 · Сб 10:00–18:00» из недельного графика."""
    if not isinstance(hours, dict):
        return ''
    order = [1, 2, 3, 4, 5, 6, 0]
    parts, run = [], []

    def flush():
        if not run:
            return
        a, b = run[0], run[-1]
        days = WD_RU[order.index(a)] if a == b else '%s–%s' % (WD_RU[order.index(a)], WD_RU[order.index(b)])
        d = hours.get(str(a)) or hours.get(a) or {}
        parts.append('%s %s–%s' % (days, d.get('from', ''), d.get('to', '')))

    prev = None
    for d in order:
        v = hours.get(str(d)) or hours.get(d) or {}
        key = (v.get('on'), v.get('from'), v.get('to'))
        if not v.get('on'):
            flush(); run = []; prev = None
            continue
        if prev is not None and key != prev:
            flush(); run = []
        run.append(d); prev = key
    flush()
    return ' · '.join(parts)


# ------------------------------------------------------------------ записи
def appointments():
    return read().get('appointments') or []


def put_appointment(rec):
    """Положить запись в общий список (или обновить по id)."""
    if not rec or not rec.get('id'):
        return False
    with _LOCK:
        data = read()
        rest = [a for a in data['appointments'] if a.get('id') != rec['id']]
        rest.append(rec)
        data['appointments'] = rest[-2000:]
        write(data)
    return True


def patch_appointment(aid, patch):
    with _LOCK:
        data = read()
        hit = False
        for a in data['appointments']:
            if a.get('id') == aid:
                a.update(patch)
                hit = True
        if hit:
            write(data)
    return hit


def mark_reminded(aid, kind):
    with _LOCK:
        data = read()
        for a in data['appointments']:
            if a.get('id') == aid:
                a.setdefault('reminded', {})[kind] = True
                write(data)
                return True
    return False
