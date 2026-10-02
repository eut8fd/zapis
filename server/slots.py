"""
Расчёт свободного времени — порт `slotsFor`/`slotFree`/`workWindow`
из `webapp/js/store.js`.

Зачем на сервере то, что уже есть в приложении. Два потребителя слотов
живут вне браузера: бот (запись прямо в чате) и сама проверка записи при
сохранении — сервер не должен принимать на веру, что присланное время
свободно. Логика та же, что в приложении, вплоть до правил: окно мастера
обрезается часами салона, перерывы и блокировки исключаются, занятые
записи — любые кроме отменённых, сегодня нельзя раньше чем через 10 минут.

Все моменты в базе — UTC в ISO. Здесь работаем в местном времени салона:
сетка слотов, часы работы и «сегодня» — понятия местного дня.
"""
from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

_TZ_CACHE = {}


def tzinfo_for(name, fallback_minutes=300):
    """Зона по имени; без базы зон — фиксированное смещение (UTC+5 Алматы)."""
    name = name or 'Asia/Almaty'
    if name in _TZ_CACHE:
        return _TZ_CACHE[name]
    tz = None
    if ZoneInfo is not None:
        try:
            tz = ZoneInfo(name)
        except Exception:  # noqa: BLE001 — нет такой зоны или нет tzdata
            tz = None
    if tz is None:
        tz = timezone(timedelta(minutes=fallback_minutes))
    _TZ_CACHE[name] = tz
    return tz


def valid_tz(name):
    """Известная ли это зона: без tzdata принимаем только UTC и Etc/*."""
    if not name or len(name) > 64 or ZoneInfo is None:
        return name in ('UTC',)
    try:
        ZoneInfo(name)
        return True
    except Exception:  # noqa: BLE001
        return False


def parse_iso(s):
    """ISO-строка приложения ('2026-10-01T09:00:00.000Z' или без зоны) → aware UTC."""
    if not s:
        return None
    try:
        if isinstance(s, (int, float)):
            return datetime.fromtimestamp(s / 1000.0, tz=timezone.utc)
        s = str(s)
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_iso(dt):
    """Как это делает браузер: миллисекунды и Z."""
    dt = dt.astimezone(timezone.utc)
    return dt.strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (dt.microsecond // 1000)


def local(dt, tz):
    return dt.astimezone(tz)


def to_min(hm):
    try:
        h, m = str(hm).split(':')
        return int(h) * 60 + int(m or 0)
    except ValueError:
        return 0


def to_hm(m):
    return '%02d:%02d' % (m // 60, m % 60)


def minutes_of(dt_local):
    return dt_local.hour * 60 + dt_local.minute


def day_key(dt_local):
    return dt_local.strftime('%Y-%m-%d')


def local_day_start(d, tz):
    """Начало местного дня d (date) как aware datetime."""
    return datetime(d.year, d.month, d.day, tzinfo=tz)


def at_minutes(d, minutes, tz):
    """Момент «день d, минута minutes» в зоне tz → aware UTC."""
    return (local_day_start(d, tz) + timedelta(minutes=minutes)).astimezone(timezone.utc)


# ------------------------------------------------------------------ окно
def work_day(emp, d):
    sch = emp.get('schedule') or {}
    # ключи графика — JS-дни недели 0..6, воскресенье = 0; в JSON они строки
    js_day = (d.weekday() + 1) % 7
    w = sch.get(str(js_day)) or sch.get(js_day)
    if not w or not w.get('on'):
        return None
    return w


def company_hours(company, d):
    hrs = (company or {}).get('hours') or {}
    js_day = (d.weekday() + 1) % 7
    h = hrs.get(str(js_day)) or hrs.get(js_day)
    return h if h and h.get('on') else None


def work_window(emp, company, d):
    """Окно мастера, обрезанное часами салона. None — не работает."""
    w = work_day(emp, d)
    if not w:
        return None
    hrs = (company or {}).get('hours') or {}
    js_day = (d.weekday() + 1) % 7
    ch = hrs.get(str(js_day)) or hrs.get(js_day)
    if ch is not None and not ch.get('on'):
        return None
    frm, to = to_min(w.get('from')), to_min(w.get('to'))
    if ch and ch.get('on'):
        frm = max(frm, to_min(ch.get('from')))
        to = min(to, to_min(ch.get('to')))
    if to - frm < 5:
        return None
    return {'from': frm, 'to': to, 'breaks': [(to_min(b.get('from')), to_min(b.get('to')))
                                             for b in (w.get('breaks') or [])]}


# ------------------------------------------------------------------ занятость
def busy_for(emp_id, d, tz, appointments, blocks, ignore_id=None):
    """Занятые отрезки мастера в местных минутах дня d."""
    out = []
    for a in appointments:
        if a.get('employeeId') != emp_id or a.get('status') == 'cancelled':
            continue
        if ignore_id and a.get('id') == ignore_id:
            continue
        st = parse_iso(a.get('start'))
        if not st:
            continue
        lst = local(st, tz)
        if lst.date() != d:
            continue
        s = minutes_of(lst)
        out.append((s, s + int(a.get('duration') or 60)))
    for b in blocks:
        if b.get('employeeId') not in (emp_id, None, ''):
            continue
        st, en = parse_iso(b.get('start')), parse_iso(b.get('end'))
        if not st or not en:
            continue
        lst = local(st, tz)
        if lst.date() != d:
            continue
        out.append((minutes_of(lst), minutes_of(local(en, tz))))
    return out


def slot_free(emp, company, d, start_min, duration, tz, appointments, blocks, now=None, ignore_id=None):
    w = work_window(emp, company, d)
    if not w:
        return False
    if start_min < w['from'] or start_min + duration > w['to']:
        return False
    for bf, bt in w['breaks']:
        if start_min < bt and start_min + duration > bf:
            return False
    for s, e in busy_for(emp['id'], d, tz, appointments, blocks, ignore_id):
        if start_min < e and start_min + duration > s:
            return False
    now = now or datetime.now(timezone.utc)
    ln = local(now, tz)
    if d < ln.date():
        return False
    if d == ln.date() and start_min < minutes_of(ln) + 10:
        return False
    return True


def slots_for(emps, company, d, duration, tz, appointments, blocks, step=30, now=None, ignore_id=None):
    """[{min, t, free, empId}] — как в приложении, по всем переданным мастерам."""
    emps = [e for e in emps if e]
    windows = [w for w in (work_window(e, company, d) for e in emps) if w]
    if not windows:
        return []
    frm = min(w['from'] for w in windows)
    to = max(w['to'] for w in windows)
    out = []
    m = ((frm + step - 1) // step) * step
    while m + duration <= to:
        who = None
        for e in emps:
            if slot_free(e, company, d, m, duration, tz, appointments, blocks, now, ignore_id):
                who = e
                break
        out.append({'min': m, 't': to_hm(m), 'free': who is not None, 'empId': who['id'] if who else None})
        m += step
    return out


def next_free(emp, company, duration, tz, appointments, blocks, days=14, now=None):
    now = now or datetime.now(timezone.utc)
    base = local(now, tz).date()
    for i in range(days):
        d = base + timedelta(days=i)
        for s in slots_for([emp], company, d, duration, tz, appointments, blocks, now=now):
            if s['free']:
                return {'date': d, 'min': s['min']}
    return None


def appointment_conflict(appt, appointments, blocks, emp, company, tz, now=None):
    """
    Почему запись нельзя сохранить. None — можно.
    Проверяем так же, как приложение, но на сервере: время свободно, мастер
    работает, не в прошлом. Это единственное место, где двойная запись
    физически не пройдёт — экраны лишь подсказывают.
    """
    st = parse_iso(appt.get('start'))
    if not st:
        return 'нет времени начала'
    lst = local(st, tz)
    d = lst.date()
    dur = int(appt.get('duration') or 60)
    if not emp:
        return 'мастер не найден'
    if not slot_free(emp, company, d, minutes_of(lst), dur, tz, appointments, blocks,
                     now=now, ignore_id=appt.get('id')):
        # различаем «не работает» и «занято» — человеку это разные ответы
        if not work_window(emp, company, d):
            return 'в этот день мастер не принимает'
        now_ = now or datetime.now(timezone.utc)
        if st < now_:
            return 'это время уже прошло'
        return 'это время уже занято'
    return None


def date_from_str(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None
