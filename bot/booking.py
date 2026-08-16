"""
Запись прямо в чате бота — без открытия приложения.

Держит собственную модель расписания, чтобы слоты выглядели живыми:
  * рабочие часы Пн–Сб, обед 13:00–14:00, воскресенье выходной;
  * часть слотов «занята» — детерминированно по (салон, мастер, дата),
    поэтому при каждом открытии картина одна и та же;
  * реальные брони из bookings.json занимают слоты по-настоящему.

Состояние выбора целиком лежит в callback_data, поэтому сессии не нужны.
"""
import hashlib
import json
import os
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
# DATA_DIR позволяет вынести изменяемые файлы на volume (Docker) или в /var/lib (VPS)
DATA_DIR = os.environ.get('DATA_DIR') or HERE
os.makedirs(DATA_DIR, exist_ok=True)
BOOKINGS_PATH = os.path.join(DATA_DIR, 'bookings.json')

OPEN_MIN = 9 * 60            # 09:00 в будни
CLOSE_MIN = 20 * 60          # 20:00 в будни
SAT_OPEN, SAT_CLOSE = 10 * 60, 18 * 60   # суббота 10:00–18:00
SUN_OPEN, SUN_CLOSE = 10 * 60, 17 * 60   # воскресенье 10:00–17:00
LUNCH = (13 * 60, 14 * 60)   # обед (только в будни)
STEP = 30                    # шаг сетки, минут
LEAD = 60                    # нельзя записаться раньше чем через час
DAYS_AHEAD = 7

WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
          'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']


def hm(minutes):
    return '%02d:%02d' % (minutes // 60, minutes % 60)


def day_label(d, today):
    delta = (d - today).days
    if delta == 0:
        return 'сегодня'
    if delta == 1:
        return 'завтра'
    return '%d %s' % (d.day, MONTHS[d.month - 1])


def day_short(d, today):
    delta = (d - today).days
    if delta == 0:
        return 'Сегодня'
    if delta == 1:
        return 'Завтра'
    return '%s %d' % (WD[d.weekday()], d.day)


# --------------------------------------------------------------- хранилище
def _load():
    try:
        with open(BOOKINGS_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return []


def _save(rows):
    try:
        with open(BOOKINGS_PATH, 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)
    except Exception as e:  # noqa: BLE001
        print('   bookings.json:', e)


BOOKINGS = _load()


def add_booking(rec):
    BOOKINGS.append(rec)
    _save(BOOKINGS)
    return rec


def user_bookings(uid, only_future=True):
    now = datetime.now()
    out = []
    for b in BOOKINGS:
        if str(b.get('uid')) != str(uid) or b.get('status') == 'cancelled':
            continue
        when = datetime.strptime(b['date'] + ' ' + hm(b['min']), '%Y-%m-%d %H:%M')
        if only_future and when < now:
            continue
        out.append((when, b))
    out.sort(key=lambda x: x[0])
    return out


def cancel_booking(uid, bid):
    for b in BOOKINGS:
        if b.get('id') == bid and str(b.get('uid')) == str(uid):
            b['status'] = 'cancelled'
            _save(BOOKINGS)
            return b
    return None


# --------------------------------------------------------------- расписание
def open_min(d):
    if d.weekday() == 5:
        return SAT_OPEN
    if d.weekday() == 6:
        return SUN_OPEN
    return OPEN_MIN


def close_min(d):
    if d.weekday() == 5:
        return SAT_CLOSE
    if d.weekday() == 6:
        return SUN_CLOSE
    return CLOSE_MIN


def has_lunch(d):
    return d.weekday() < 5


def is_workday(d):
    return True


def _busy_generated(cid, emp_idx, d):
    """Псевдослучайная, но стабильная занятость мастера в этот день."""
    key = '%s|%d|%s' % (cid, emp_idx, d.isoformat())
    h = hashlib.sha256(key.encode()).digest()
    busy = set()
    limit = close_min(d)
    i = 0
    m = open_min(d)
    while m < limit:
        # каждый слот занят примерно с вероятностью 45%
        if h[i % len(h)] % 100 < 45:
            busy.add(m)
        m += STEP
        i += 1
    return busy


def _busy_real(cid, emp_idx, d):
    out = set()
    ds = d.isoformat()
    for b in BOOKINGS:
        if b.get('status') == 'cancelled':
            continue
        if b['cid'] != cid or b['date'] != ds or b['emp'] != emp_idx:
            continue
        m = b['min']
        while m < b['min'] + b['dur']:
            out.add(m - m % STEP)
            m += STEP
    return out


def free_slots(company, cid, emp_idx, d, duration):
    """Свободные слоты одного мастера с учётом длительности услуги."""
    if not is_workday(d):
        return []
    busy = _busy_generated(cid, emp_idx, d) | _busy_real(cid, emp_idx, d)
    limit = close_min(d)
    lunch = has_lunch(d)
    now = datetime.now()
    today = now.date()
    earliest = (now.hour * 60 + now.minute + LEAD) if d == today else 0

    out = []
    m = open_min(d)
    while m + duration <= limit:
        ok = m >= earliest
        # услуга должна целиком поместиться в свободные слоты и не задеть обед
        k = m
        while ok and k < m + duration:
            if k in busy or (lunch and LUNCH[0] <= k < LUNCH[1]):
                ok = False
            k += STEP
        if ok:
            out.append(m)
        m += STEP
    return out


def masters_for(company, svc_idx):
    """Индексы мастеров, которые делают эту услугу."""
    cat = company['services'][svc_idx][4] if len(company['services'][svc_idx]) > 4 else None
    out = []
    for i, s in enumerate(company.get('staff', [])):
        if cat is None or cat in s.get('cats', []):
            out.append(i)
    return out or list(range(len(company.get('staff', []))))


def slots_for_choice(company, cid, svc_idx, emp, d):
    """
    Слоты для выбранного мастера или для «любого».
    Возвращает [(минуты, индекс мастера)] по возрастанию времени.
    """
    duration = company['services'][svc_idx][3]
    idxs = [emp] if emp != 'x' else masters_for(company, svc_idx)
    seen = {}
    for i in idxs:
        for m in free_slots(company, cid, i, d, duration):
            seen.setdefault(m, i)
    return sorted(seen.items())


def days_with_slots(company, cid, svc_idx, emp):
    """Ближайшие дни и число свободных слотов в каждом."""
    today = date.today()
    out = []
    for k in range(DAYS_AHEAD):
        d = today + timedelta(days=k)
        if not is_workday(d):
            continue
        n = len(slots_for_choice(company, cid, svc_idx, emp, d))
        out.append((d, n))
    return out


def next_free_text(company, cid, emp_idx, duration=60):
    """Короткая подпись «ближайшее — завтра, 10:00»."""
    today = date.today()
    for k in range(DAYS_AHEAD):
        d = today + timedelta(days=k)
        s = free_slots(company, cid, emp_idx, d, duration)
        if s:
            return '%s, %s' % (day_label(d, today), hm(s[0]))
    return 'нет мест'
