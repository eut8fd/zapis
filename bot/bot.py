"""
Телеграм-бот Zapis — вход в Mini App и меню, разное для клиента и для бизнеса.

Что умеет:
  * человек пришёл по ссылке салона (?start=c1) — видит меню этого салона:
    записаться (в приложении или прямо в чате), свои записи, услуги, контакты;
  * владелец или мастер — меню своей компании: кабинет, календарь, ссылка
    для клиентов, очередь уведомлений;
  * новый человек без ссылки — короткое приветствие: открыть ссылку своего
    салона или создать свой бизнес.

Источник данных — сервер (`server/serve.py`): справочник салонов, свободные
окна, записи и их отмена. Своей базы у бота больше нет: запись из чата
создаёт сервер той же проверкой занятости, что и приложение, и он же
отправляет напоминания. Бот хранит только, кем человек представился
в последний раз (`users.json`), чтобы /start сразу открывал нужное меню.

Запуск:
  set BOT_TOKEN=...   (или файл .env рядом с проектом)
  set WEBAPP_URL=https://…
  python bot/bot.py
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import api  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))

try:  # корректный вывод кириллицы в консоли Windows
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:  # noqa: BLE001
    pass


def load_env():
    path = os.path.join(ROOT, '.env')
    if not os.path.exists(path):
        return
    with open(path, 'r', encoding='utf-8-sig') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            v = v.split(' #', 1)[0].strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)


load_env()
TOKEN = os.environ.get('BOT_TOKEN', '').strip()
URL = os.environ.get('WEBAPP_URL', '').strip().rstrip('/')
# Адрес Bot API переопределяется только в тестах — там вместо Telegram
# отвечает локальная заглушка.
API = '%s/bot%s/' % ((os.environ.get('TELEGRAM_API_BASE') or 'https://api.telegram.org').rstrip('/'), TOKEN)

BRAND = os.environ.get('BRAND_NAME', 'Zapis').strip() or 'Zapis'
BOT_NAME = os.environ.get('BOT_NAME', '').strip()
SUPPORT = os.environ.get('SUPPORT_USERNAME', '').strip().lstrip('@')
ADMIN_IDS = {int(x) for x in os.environ.get('ADMIN_TG_IDS', '').replace(';', ',').split(',')
             if x.strip().isdigit()}
ADMIN_CODE = os.environ.get('ADMIN_CODE', '').strip()
DATA_DIR = os.environ.get('DATA_DIR') or HERE
os.makedirs(DATA_DIR, exist_ok=True)

if not TOKEN:
    print('!! BOT_TOKEN не задан (env или .env)')
    sys.exit(1)

HTTPS = URL.startswith('https://')
BOT_USERNAME = ''
# Демо-салоны из сида (c1, c2…): их можно выбрать списком. Настоящие
# компании по списку не выдаём — к ним приходят по ссылке.
DEMO_ID = re.compile(r'^c\d+$')
COMPANY_ID = re.compile(r'^(c\d+|bg\d+|co_?[a-z0-9]+)$')
INVITE_ID = re.compile(r'^inv[a-z0-9]{8,}$')
SECTIONS = {'book', 'my', 'profile', 'cal', 'clients', 'sub', 'ai', 'more', 'team'}

WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
          'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']


def is_admin(user_id):
    return int(user_id) in ADMIN_IDS


# --------------------------------------------------------------------- локальная память
USERS_PATH = os.path.join(DATA_DIR, 'users.json')
try:
    with open(USERS_PATH, 'r', encoding='utf-8') as f:
        USERS = json.load(f)
except Exception:  # noqa: BLE001
    USERS = {}


def save_users():
    try:
        with open(USERS_PATH, 'w', encoding='utf-8') as f:
            json.dump(USERS, f, ensure_ascii=False, indent=1)
    except Exception as e:  # noqa: BLE001
        print('   users.json:', e)


def state(uid):
    return USERS.get(str(uid), {})


def set_state(uid, **kw):
    s = USERS.setdefault(str(uid), {})
    s.update(kw)
    save_users()
    return s


# --------------------------------------------------------------------- справочник
def companies():
    """Готовые салоны с сервера; при недоступности — пустой словарь, не падение."""
    try:
        return api.companies()
    except api.ServerError as e:
        print('   справочник недоступен:', e.message)
        return {}


def company(cid):
    cs = companies()
    if cid in cs:
        return cs[cid]
    try:
        return api.company(cid)
    except api.ServerError:
        return None


def company_id_of(uid):
    cid = state(uid).get('company')
    return cid if cid and company(cid) else None


# --------------------------------------------------------------------- Telegram API
def tg(method, **params):
    data = json.dumps(params).encode('utf-8')
    req = urllib.request.Request(API + method, data=data, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        if 'message is not modified' not in body:
            print('   API %s -> %s %s' % (method, e.code, body[:180]))
        return {'ok': False, 'error': body}
    except Exception as e:  # noqa: BLE001
        print('   API %s -> %s' % (method, e))
        return {'ok': False, 'error': str(e)}


def tg_retry(method, tries=3, **params):
    """Настроечные вызовы при старте — с повтором: сеть моргнула, и кнопка
    меню осталась бы стандартной «Menu» до следующего запуска."""
    last = None
    for attempt in range(tries):
        last = tg(method, **params)
        if last.get('ok'):
            return last
        if str(last.get('error', '')).startswith('{'):
            return last
        if attempt + 1 < tries:
            time.sleep(1.5 * (attempt + 1))
    return last or {'ok': False}


def app_url(param=''):
    if not param:
        return URL
    sep = '&' if '?' in URL else '?'
    return '%s%sstart=%s' % (URL, sep, param)


def admin_url():
    u = app_url('admin')
    if ADMIN_CODE:
        u += '&key=' + urllib.parse.quote(ADMIN_CODE)
    return u


def open_btn(text, param=''):
    """Кнопка запуска Mini App (или обычная ссылка, если адрес не https)."""
    url = app_url(param)
    return {'text': text, 'web_app': {'url': url}} if HTTPS else {'text': text, 'url': url}


def cb(text, data):
    return {'text': text, 'callback_data': data}


def esc(s):
    return str(s if s is not None else '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def money(n, cur='₸'):
    try:
        n = int(round(float(n)))
    except (TypeError, ValueError):
        return ''
    return '{:,}'.format(n).replace(',', ' ') + ' ' + esc(cur or '₸')


def dur_text(m):
    m = int(m or 0)
    if m < 60:
        return '%d мин' % m
    h, rest = divmod(m, 60)
    return '%d ч %d мин' % (h, rest) if rest else '%d ч' % h


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


def hours_text(hours):
    """«Пн–Пт 09:00–20:00 · Сб 10:00–18:00» из недельного графика."""
    if not isinstance(hours, dict):
        return ''
    names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
    order = [1, 2, 3, 4, 5, 6, 0]
    parts, run, prev = [], [], None

    def flush():
        if not run:
            return
        a, b = run[0], run[-1]
        days = names[order.index(a)] if a == b else '%s–%s' % (names[order.index(a)], names[order.index(b)])
        d = hours.get(str(a)) or hours.get(a) or {}
        parts.append('%s %s–%s' % (days, d.get('from', ''), d.get('to', '')))

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


def send(chat_id, text, kb=None):
    p = {'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if kb:
        p['reply_markup'] = kb
    return tg('sendMessage', **p)


def edit(chat_id, message_id, text, kb=None):
    p = {'chat_id': chat_id, 'message_id': message_id, 'text': text,
         'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if kb:
        p['reply_markup'] = kb
    r = tg('editMessageText', **p)
    if not r.get('ok') and 'not modified' not in str(r.get('error', '')):
        # сообщение могли удалить — отвечаем новым
        return send(chat_id, text, kb)
    return r


# --------------------------------------------------------------------- тексты
def offline_text():
    return ('<b>Сервер временно недоступен</b>\n\n'
            'Попробуйте через минуту. Если не поможет — откройте приложение: '
            'оно покажет, что сможет.')


def offline_kb():
    return {'inline_keyboard': [[open_btn('Открыть приложение')], [cb('Обновить', 'menu')]]}


def client_text(c):
    return (
        '<b>{name}</b>\n'
        '{cat} · {city}\n'
        '{addr}\n\n'
        '{about}'
        'Свободное время видно сразу — выберите услугу и запишитесь за полминуты.'
    ).format(name=esc(c['name']), cat=esc(c.get('cat')), city=esc(c.get('city')),
             addr=esc(c.get('addr')), about=(esc(c['about']) + '\n\n') if c.get('about') else '')


def client_kb(c, uid):
    cid = c['id']
    mine = my_bookings(uid)
    rows = [
        [open_btn('📅 Записаться', cid + '_book')],
        [cb('⚡ Быстрая запись в чате', 'bk::::')],
        [open_btn('Мои записи' + (' · %d' % len(mine) if mine else ''), cid + '_my')],
        [cb('Услуги и цены', 'services'), cb('Контакты', 'contacts')],
        [cb('Поддержка', 'support'), cb('‹ В меню', 'menu')],
    ]
    return {'inline_keyboard': rows}


def services_text(c):
    rows = '\n'.join('• %s — <b>%s</b> · %s' % (esc(s['name']), money(s['price'], c.get('currency')),
                                                 dur_text(s['duration'])) for s in c['services'][:25])
    tail = '\n\nЕщё %d — в приложении.' % (len(c['services']) - 25) if len(c['services']) > 25 else ''
    return '<b>Услуги и цены</b>\n<i>%s</i>\n\n%s%s' % (esc(c['name']), rows, tail)


def contacts_text(c):
    return (
        '<b>Как нас найти</b>\n<i>{name}</i>\n\n'
        '📍 {city}, {addr}\n'
        '📞 <code>{phone}</code>\n'
        '🕘 {hours}'
    ).format(name=esc(c['name']), city=esc(c.get('city')), addr=esc(c.get('addr')),
             phone=esc(c.get('phone')), hours=esc(hours_text(c.get('hours'))))


def client_back_kb(cid):
    return {'inline_keyboard': [[open_btn('📅 Записаться', cid + '_book')], [cb('‹ Назад', 'salon')]]}


# --------------------------------------------------------------------- запись в чате
def bk_state(data):
    """'bk:<svc>:<emp>:<день>:<время>' → кортеж; пустые поля = ещё не выбрано.
    Услуга и мастер — индексы в списках справочника (callback_data ограничен
    64 байтами), день — дата YYYY-MM-DD: индекс от «сегодня» сломался бы
    после полуночи и на хостинге в другом часовом поясе."""
    parts = (data.split(':') + ['', '', '', ''])[1:5]
    svc = int(parts[0]) if parts[0] != '' else None
    emp = parts[1] if parts[1] != '' else None
    day = parse_date(parts[2])
    tm = int(parts[3]) if parts[3] != '' else None
    return svc, emp, day, tm


def bk_data(svc='', emp='', day='', tm=''):
    return 'bk:%s:%s:%s:%s' % (svc, emp, day.isoformat() if isinstance(day, date) else day, tm)


def parse_date(s):
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


def staff_for(c, svc):
    ids = set(svc.get('employeeIds') or [])
    out = [i for i, e in enumerate(c['staff']) if e['id'] in ids]
    return out or list(range(len(c['staff'])))


def emp_id(c, emp):
    return None if emp in (None, 'x') else c['staff'][int(emp)]['id']


def bk_screen(c, uid, data):
    """(текст, клавиатура) для текущего шага записи в чате."""
    cid = c['id']
    svc, emp, day, tm = bk_state(data)
    today = date.today()

    if svc is None:
        if not c['services']:
            return ('<b>У салона пока нет услуг</b>\nЗагляните позже.', {'inline_keyboard': [[cb('‹ Назад', 'salon')]]})
        rows = [[cb('%s · %s' % (s['name'], money(s['price'], c.get('currency'))), bk_data(i))]
                for i, s in enumerate(c['services'][:40])]
        rows.append([cb('‹ Назад', 'salon')])
        return ('<b>Выберите услугу</b>\n<i>%s</i>' % esc(c['name']), {'inline_keyboard': rows})

    if svc >= len(c['services']):
        return ('<b>Услуга изменилась</b>\nВыберите заново.', {'inline_keyboard': [[cb('Выбрать услугу', bk_data())]]})
    s = c['services'][svc]

    if emp is None:
        cands = staff_for(c, s)
        rows = []
        if len(cands) > 1:
            rows.append([cb('Любой мастер — самое раннее время', bk_data(svc, 'x'))])
        for i in cands:
            st = c['staff'][i]
            rows.append([cb('%s · %s' % (st['name'].split(' ')[0], next_free_text(cid, s['id'], st['id'])),
                            bk_data(svc, i))])
        rows.append([cb('‹ Назад', bk_data())])
        return ('<b>Выберите мастера</b>\n%s · %s · %s' % (esc(s['name']), money(s['price'], c.get('currency')),
                                                          dur_text(s['duration'])), {'inline_keyboard': rows})

    who = 'любой мастер' if emp == 'x' else c['staff'][int(emp)]['name'].split(' ')[0]

    if day is None:
        try:
            days = api.days(cid, s['id'], emp_id(c, emp), n=7)
        except api.ServerError:
            return offline_text(), offline_kb()
        # «сегодня» — по салону: первый день в ответе сервера
        if days:
            today = date.fromisoformat(days[0]['date'])
        rows, line = [], []
        for d in days:
            dd = date.fromisoformat(d['date'])
            label = day_short(dd, today) + (' · %d' % d['free'] if d['free'] else ' · нет')
            line.append(cb(label, bk_data(svc, emp, dd) if d['free'] else 'noop'))
            if len(line) == 2:
                rows.append(line); line = []
        if line:
            rows.append(line)
        rows.append([open_btn('📅 Полный календарь', cid + '_book')])
        rows.append([cb('‹ Назад', bk_data(svc))])
        return ('<b>Выберите день</b>\n%s · %s\n\n<i>Здесь ближайшая неделя. Нужна дата дальше — '
                'откройте полный календарь.</i>' % (esc(s['name']), esc(who)), {'inline_keyboard': rows})

    d = day
    if tm is None:
        try:
            slots = api.slots(cid, s['id'], d.isoformat(), emp_id(c, emp))
        except api.ServerError:
            return offline_text(), offline_kb()
        if not slots:
            return ('<b>На этот день мест нет</b>\nВыберите другой день.',
                    {'inline_keyboard': [[cb('‹ К выбору дня', bk_data(svc, emp))]]})
        rows, line = [], []
        for sl in slots:
            line.append(cb(sl['t'], bk_data(svc, emp, day, sl['min'])))
            if len(line) == 3:
                rows.append(line); line = []
        if line:
            rows.append(line)
        rows.append([open_btn('📅 Полный календарь', cid + '_book')])
        rows.append([cb('‹ Назад', bk_data(svc, emp))])
        return ('<b>Выберите время</b>\n%s · %s · %s' % (esc(s['name']), esc(who), day_label(d, today)),
                {'inline_keyboard': rows})

    txt = (
        '<b>Проверьте запись</b>\n\n'
        'Услуга — <b>{svc}</b>\n'
        'Мастер — <b>{emp}</b>\n'
        'Когда — <b>{day}, {time}</b>\n'
        'Длительность — {dur}\n'
        'Стоимость — <b>{price}</b>\n\n'
        '{name}\n{addr}'
    ).format(svc=esc(s['name']), emp=esc(who), day=day_label(d, today), time=hm(tm),
             dur=dur_text(s['duration']), price=money(s['price'], c.get('currency')),
             name=esc(c['name']), addr=esc(c.get('addr')))
    return (txt, {'inline_keyboard': [
        [cb('✅ Подтвердить запись', 'bkok:%d:%s:%s:%d' % (svc, emp, d.isoformat(), tm))],
        [cb('‹ Изменить время', bk_data(svc, emp, d))],
    ]})


def next_free_text(cid, service_id, employee_id):
    try:
        days = api.days(cid, service_id, employee_id, n=14)
    except api.ServerError:
        return '—'
    today = date.today()
    for d in days:
        if d['free']:
            return '%s, %s' % (day_label(date.fromisoformat(d['date']), today), d['first'])
    return 'нет мест'


def bk_confirm(c, uid, user, data):
    _, svc, emp, day, tm = data.split(':')
    svc, tm = int(svc), int(tm)
    d = parse_date(day)
    if svc >= len(c['services']) or d is None:
        return ('<b>Услуга изменилась</b>\nВыберите заново.', {'inline_keyboard': [[cb('Выбрать услугу', bk_data())]]})
    s = c['services'][svc]
    try:
        a = api.book(c['id'], s['id'], d.isoformat(), tm, uid,
                     name=(user or {}).get('first_name', '') or 'Гость',
                     username=(user or {}).get('username', '') or '', employee_id=emp_id(c, emp))
    except api.ServerError as e:
        if e.status == 409:
            return ('<b>%s</b>\nВыберите другое время — свободные окна обновились.' % esc(e.message.capitalize()),
                    {'inline_keyboard': [[cb('Выбрать другое время', bk_data(svc, emp, day))]]})
        return offline_text(), offline_kb()
    txt = (
        '✅ <b>Готово! Вы записаны</b>\n\n'
        '<b>{svc}</b>\n'
        '{emp} · {when}\n'
        '{price} · {dur}\n\n'
        '{name}\n{addr}\n\n'
        'Напомним за день и за 2 часа до визита.'
    ).format(svc=esc(a['service']), emp=esc(a['employee']), when=esc(a['when']),
             price=money(a['price'], a.get('currency')), dur=dur_text(a['duration']),
             name=esc(a['companyName']), addr=esc(a['addr']))
    return (txt, {'inline_keyboard': [[cb('Мои записи', 'mine')], [cb('‹ В меню', 'menu')]]})


# --------------------------------------------------------------------- мои записи
def my_bookings(uid, only_future=True):
    try:
        rows = api.my(uid)
    except api.ServerError:
        return []
    out = []
    for a in rows:
        if a.get('status') != 'planned':
            continue
        try:
            when = datetime.fromisoformat(a['localStart'])
        except (TypeError, ValueError):
            continue
        if only_future and when < datetime.now() - timedelta(minutes=5):
            continue
        out.append((when, a))
    out.sort(key=lambda x: x[0])
    return out


def mine_screen(uid, cid=None):
    rows_all = my_bookings(uid)
    book_param = (cid + '_book') if cid else ''
    if not rows_all:
        kb = [[open_btn('🔴  Записаться онлайн', book_param)]] if cid else [[open_btn('Открыть приложение')]]
        if cid:
            kb.append([cb('⚡ Быстрая запись в чате', 'bk::::')])
        kb.append([cb('‹ В меню', 'menu')])
        return ('<b>Мои записи</b>\n\nЗаписей пока нет. Свободное время видно сразу — '
                'выберите услугу и время в приложении или запишитесь прямо в чате.',
                {'inline_keyboard': kb})
    lines, rows = [], []
    for when, a in rows_all:
        where = '' if a.get('companyId') == cid else ' · ' + esc(a.get('companyName', ''))
        lines.append('<b>%s</b>\n%s · %s · %s%s' % (
            esc(a['service']), esc(a['employee']), esc(a['when']), money(a['price'], a.get('currency')), where))
        rows.append([cb('Отменить: ' + a['when'], 'cxl:' + a['id'])])
    if cid:
        rows.append([open_btn('📅  Записаться ещё', book_param)])
        rows.append([cb('⚡ Быстрая запись в чате', 'bk::::')])
    else:
        rows.append([open_btn('Открыть приложение')])
    rows.append([cb('‹ В меню', 'menu')])
    return ('<b>Мои записи</b>\n\n' + '\n\n'.join(lines) + '\n\nНапомним за 24 часа и за 2 часа до визита.',
            {'inline_keyboard': rows})


# --------------------------------------------------------------------- меню бизнеса
def biz_info(uid):
    """Компании, где человек владелец или мастер — по данным сервера."""
    try:
        u = api.user(uid)
    except api.ServerError:
        return None
    return u


def biz_text(c, m):
    return (
        '<b>{name}</b>\n'
        '{cat} · {city} · тариф {plan}\n\n'
        'Ваш кабинет: расписание команды, клиенты, деньги и AI-помощник.\n'
        'Клиенты записываются сами — по ссылке ниже.'
    ).format(name=esc(c.get('name')), cat=esc(c.get('cat')), city=esc(c.get('city')), plan=esc(c.get('plan')))


def biz_kb(cid, uid, many=False):
    rows = [
        [open_btn('💼  Открыть кабинет', 'owner')],
        [open_btn('Календарь', 'owner_cal'), open_btn('Клиенты', 'owner_clients')],
        [cb('Ссылка для клиентов', 'link:' + cid)],
        [open_btn('Подписка', 'owner_sub'), cb('Поддержка', 'support')],
        [cb('🔔 Очередь уведомлений', 'reminders:' + cid)],
    ]
    tail = [cb('‹ В меню', 'menu')]
    if many:
        tail.insert(0, cb('Сменить компанию', 'switch'))
    rows.append(tail)
    if is_admin(uid):
        rows.append([{'text': '🛡 Панель администратора', 'web_app': {'url': admin_url()}}
                     if HTTPS else {'text': '🛡 Панель администратора', 'url': admin_url()}])
    return {'inline_keyboard': rows}


def link_text(c):
    link = 'https://t.me/%s?start=%s' % (BOT_USERNAME or 'bot', c['id'])
    return (
        '<b>Ссылка для клиентов</b>\n<i>{name}</i>\n\n'
        '<code>{link}</code>\n\n'
        'Поставьте её в шапку профиля, в сторис или отправьте в личном сообщении. '
        'По этой ссылке клиент сразу попадает на вашу страницу записи.'
    ).format(name=esc(c.get('name')), link=link)


def link_kb(cid):
    link = 'https://t.me/%s?start=%s' % (BOT_USERNAME or 'bot', cid)
    share = 'https://t.me/share/url?url=' + urllib.parse.quote(link) + \
            '&text=' + urllib.parse.quote('Записывайтесь онлайн — свободное время видно сразу')
    return {'inline_keyboard': [[{'text': '📤 Отправить ссылку', 'url': share}], [cb('‹ Назад', 'biz')]]}


def reminders_screen(cid):
    """Очередь сервера: что и когда уйдёт клиентам этой компании."""
    try:
        q = api.queue(cid)
    except api.ServerError:
        return offline_text(), offline_kb()
    q = [n for n in q if not n.get('cancelled')][:15]
    if not q:
        return ('<b>Очередь уведомлений</b>\n\nПока пусто: новые записи появятся здесь вместе с '
                'напоминаниями.', {'inline_keyboard': [[cb('‹ Назад', 'biz')]]})
    KIND = {'rem24': 'за сутки', 'rem2': 'за 2 часа', 'review': 'просьба об отзыве', 'new': 'новая запись',
            'cancel': 'отмена', 'move': 'перенос', 'moved': 'перенос', 'booked': 'подтверждение',
            'cancelled': 'отмена', 'digest': 'сводка', 'broadcast': 'рассылка', 'invite': 'команда'}
    lines = []
    for n in q:
        due = datetime.fromtimestamp(n['due_at']).strftime('%d.%m %H:%M')
        st = 'отправлено' if n.get('sent_at') else ('ошибка' if n.get('error') and n.get('attempts', 0) >= 6 else 'ждёт')
        lines.append('%s · %s · <i>%s</i>' % (esc(KIND.get(n['kind'], n['kind'])), due, st))
    return ('<b>Очередь уведомлений</b>\n\n' + '\n'.join(lines) +
            '\n\nСервер проверяет очередь каждые 15 секунд.',
            {'inline_keyboard': [[cb('Обновить', 'reminders:' + cid)], [cb('‹ Назад', 'biz')]]})


# --------------------------------------------------------------------- витрина
FEATURES_TEXT = (
    '<b>Возможности</b>\n\n'
    '<b>Онлайн-запись</b>\nКлиент выбирает услугу, мастера и время. Занятые слоты скрыты, '
    'напоминание приходит само.\n\n'
    '<b>Календарь</b>\nДень и неделя, вся команда на одном экране. Запись создаётся '
    'нажатием на свободный слот.\n\n'
    '<b>Клиенты</b>\nИстория визитов, средний чек, заметки. Видно, кто давно не приходил.\n\n'
    '<b>Команда</b>\nГрафик и услуги у каждого мастера, перерывы, отпуска, уровни доступа.\n\n'
    '<b>Деньги</b>\nДоходы, расходы, прибыль, аналитика по услугам и мастерам.\n\n'
    '<b>AI-помощник</b>\nИтоги недели, идеи для заполнения окон, тексты для сторис '
    'и голосовые заметки о клиентах.'
)

PRICES_TEXT = (
    '<b>Тарифы</b>\n\n'
    '<b>START</b> — 9 900 ₸ / месяц\nОдин мастер, онлайн-запись, база клиентов, напоминания.\n\n'
    '<b>PRO</b> — 19 900 ₸ / месяц\nДо 10 сотрудников, AI-помощник, рассылки, аналитика и финансы.\n\n'
    '<b>BUSINESS</b> — 39 900 ₸ / месяц\nБез ограничений, филиалы, интеграции, приоритетная поддержка.\n\n'
    'Первые 14 дней — бесплатно, карта не нужна.'
)

INVITE_TEXT = (
    '<b>Приглашение в команду</b>\n\n'
    'Вас зовут работать в салоне. Откройте приглашение — там будет видно, '
    'в какой салон и на какую роль. Ссылка одноразовая.'
)

SUPPORT_TEXT = (
    '<b>Поддержка</b>\n\n'
    'Поможем настроить услуги, график и страницу записи — обычно отвечаем '
    'в течение рабочего дня. Написать можно и из приложения: «Ещё» → «Поддержка».'
)

HELP_TEXT = (
    '<b>Помощь</b>\n\n'
    '/start — главное меню\n'
    '/app — открыть приложение\n'
    '/help — эта справка\n\n'
    'Кнопка <b>«Открыть»</b> рядом с полем ввода запускает приложение в любой момент.\n\n'
    'Если кнопка из старого сообщения не открывается, отправьте /start заново.'
)

SHORT_DESC = 'Онлайн-запись для салонов и мастеров: календарь, клиенты, напоминания и AI-помощник.'
FULL_DESC = (
    'Онлайн-запись прямо в Telegram.\n\n'
    'Клиенты выбирают услугу, мастера и удобное время за 30 секунд — без звонков '
    'и переписок. Бизнес получает календарь всей команды, базу клиентов с историей '
    'визитов, автоматические напоминания, финансы и аналитику.\n\n'
    'Нажмите «Запустить», чтобы открыть приложение.'
)

BIZ_START_TEXT = (
    '<b>Бизнесу</b>\n\n'
    'Соберите страницу записи за пару минут: услуги, мастера, часы работы. '
    'Дальше клиенты записываются сами, а вы видите расписание, клиентов '
    'и деньги в одном приложении.'
)


def biz_start_kb(demo=False):
    rows = [
        [open_btn('✨  Что вы получите', 'create')],
        [open_btn('Создать бизнес', 'onboarding')],
    ]
    if demo:
        rows.append([cb('Открыть демо-компанию', 'role_biz')])
    rows.append([cb('Возможности', 'features'), cb('Тарифы', 'prices')])
    rows.append([cb('‹ В меню', 'menu')])
    return {'inline_keyboard': rows}


def back_kb(extra=None, to='menu'):
    rows = []
    if extra:
        rows.append(extra)
    rows.append([cb('‹ Назад', to)])
    return {'inline_keyboard': rows}


def demo_companies():
    return {k: v for k, v in companies().items() if DEMO_ID.match(k)}


def pick_kb(prefix, back='menu'):
    rows = [[cb(c['name'], '%s:%s' % (prefix, k))] for k, c in demo_companies().items()]
    rows.append([cb('‹ Назад', back)])
    return {'inline_keyboard': rows}


# --------------------------------------------------------------------- главное меню
def main_menu(uid):
    """
    Главное меню: три действия и ничего лишнего.
      1) записаться — приложение с полным календарём;
      2) свои записи — прямо в чате;
      3) бизнес — кабинет, если он есть, иначе создание.
    """
    s = state(uid)
    cid = company_id_of(uid)
    c = company(cid) if cid else None
    mine = my_bookings(uid)
    info = biz_info(uid) or {}
    members = info.get('memberships') or []
    biz = members[0] if members else None

    lines = ['<b>%s — онлайн-запись в Telegram</b>' % esc(BRAND), '']
    if biz:
        lines.append('Ваш бизнес: <b>%s</b> · тариф %s' % (esc(biz['name']), esc(biz.get('plan') or '')))
    if c:
        lines.append('Салон: <b>%s</b> · %s' % (esc(c['name']), esc(c.get('city'))))
    elif not biz:
        lines.append('Откройте ссылку своего салона — она ведёт прямо на страницу записи.')
    if mine:
        when, a = mine[0]
        lines.append('Ближайшая запись: <b>%s</b> · %s · %s' % (esc(a['when']), esc(a['service']), esc(a['companyName'])))
    lines.append('')
    lines.append('Свободное время видно сразу — запись занимает полминуты.')

    rows = []
    if c:
        rows.append([open_btn('🔴  Записаться онлайн', cid + '_book')])
    elif demo_companies():
        rows.append([cb('🏠  Выбрать салон', 'role_client')])
    rows.append([cb('🗓  Мои записи' + (' · %d' % len(mine) if mine else ''), 'mine')])
    if biz:
        rows.append([cb('💼  Кабинет · %s' % biz['name'], 'biz')])
    else:
        rows.append([cb('💼  Создать бизнес', 'biz_start')])
    return '\n'.join(lines), {'inline_keyboard': rows}


def apply_menu_button(chat_id, uid):
    """Кнопка рядом с полем ввода — своя для клиента и для бизнеса."""
    if not HTTPS:
        return
    s = state(uid)
    cid = company_id_of(uid)
    if s.get('role') == 'biz':
        text, param = 'Кабинет', 'owner'
    elif cid:
        text, param = 'Записаться', cid + '_book'
    else:
        text, param = 'Открыть', ''
    tg_retry('setChatMenuButton', chat_id=chat_id,
             menu_button={'type': 'web_app', 'text': text, 'web_app': {'url': app_url(param)}})


# --------------------------------------------------------------------- настройка
def setup():
    global BOT_USERNAME
    print('bot: настройка…')
    try:
        h = api.health()
        print('   сервер: %s (seq %s)' % (api.server_url(), h.get('seq')))
    except api.ServerError as e:
        if e.status == 403:
            # неверный INTERNAL_TOKEN — это настройка, а не сеть: молча работать
            # «без справочника» бот не должен, иначе ошибку ищут неделями
            print('!! сервер отверг внутренний токен бота (403).')
            print('   Задайте INTERNAL_TOKEN одинаково для сервера и бота, либо дайте им общий DATA_DIR.')
            sys.exit(1)
        print('   !! сервер недоступен: %s' % e.message)
        print('      бот будет отвечать, но записи и справочник появятся, когда сервер поднимется')
    me = tg('getMe').get('result', {})
    BOT_USERNAME = me.get('username', '')
    if BOT_NAME:
        r = tg('setMyName', name=BOT_NAME)
        print('   имя бота:', 'ok' if r.get('ok') else 'пропущено (лимит Telegram)')
    tg('setMyShortDescription', short_description=SHORT_DESC)
    tg('setMyDescription', description=FULL_DESC)
    tg_retry('setMyCommands', commands=[
        {'command': 'start', 'description': 'Главное меню'},
        {'command': 'app', 'description': 'Открыть приложение'},
        {'command': 'help', 'description': 'Помощь и поддержка'},
    ])
    if HTTPS:
        r = tg_retry('setChatMenuButton', menu_button={
            'type': 'web_app', 'text': 'Открыть', 'web_app': {'url': app_url()}})
        print('   кнопка меню:', 'ok' if r.get('ok') else '!! не применилась: %s' % r.get('error'))
    else:
        print('   !! WEBAPP_URL не https — кнопки web_app недоступны, шлём обычную ссылку')
    if me:
        print('   бот: @%s (%s)' % (BOT_USERNAME, me.get('id')))
        print('   ссылка: https://t.me/%s' % BOT_USERNAME)
    for k, c in list(companies().items())[:10]:
        print('   ссылка салона %s: https://t.me/%s?start=%s' % (c.get('short') or c['name'], BOT_USERNAME, k))
    print('   супер-админы: %s' % (', '.join(str(i) for i in sorted(ADMIN_IDS)) or
                                   'не заданы (команда /admin покажет ваш ID)'))


# --------------------------------------------------------------------- сообщения
HIDDEN = {'/app': '', '/owner': 'owner', '/staff': 'employee'}


def remember(uid, user, company=None):
    """Сервер должен знать имя человека — для карточек клиентов и уведомлений."""
    try:
        api.touch_user(uid, name=' '.join(x for x in [(user or {}).get('first_name'), (user or {}).get('last_name')] if x),
                       username=(user or {}).get('username', '') or '', lang=(user or {}).get('language_code', ''),
                       company=company)
    except api.ServerError:
        pass


def handle_message(msg):
    chat = msg['chat']['id']
    user = msg.get('from') or {}
    uid = user.get('id', 0)
    text = (msg.get('text') or '').strip()
    low = text.lower().split('@')[0].split()[0] if text else ''

    if low == '/help':
        send(chat, HELP_TEXT, back_kb([open_btn('Открыть приложение')] if HTTPS else None))
        return

    if low == '/admin':
        if not is_admin(uid):
            send(chat, 'Панель администратора доступна только сотрудникам сервиса.\n\n'
                       'Ваш Telegram ID: <code>%s</code>' % uid)
            print('   отказ в доступе к панели: id=%s' % uid)
            return
        btn = {'text': '🛡 Открыть панель', 'web_app': {'url': admin_url()}} if HTTPS \
            else {'text': '🛡 Открыть панель', 'url': admin_url()}
        send(chat, '<b>Панель администратора</b>\n\nКомпании, подписки, обращения и очередь уведомлений.',
             {'inline_keyboard': [[btn]]})
        return

    if low in HIDDEN:
        send(chat, 'Открываю приложение.', {'inline_keyboard': [[open_btn('Открыть', HIDDEN[low])]]})
        return

    param = ''
    if low == '/start':
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            param = parts[1].strip().lower()

    # «<компания>_<раздел>» — ссылка приложения; компанию берём без хвоста
    base = param
    i = param.rfind('_')
    if i > 0 and param[i + 1:] in SECTIONS:
        base = param[:i]

    if base and COMPANY_ID.match(base) and company(base):
        set_state(uid, role='client', company=base)
        remember(uid, user, company=base)
        apply_menu_button(chat, uid)
        c = company(base)
        send(chat, client_text(c), client_kb(c, uid))
        return
    remember(uid, user)
    if param in ('biz', 'business', 'owner'):
        set_state(uid, role='biz')
        apply_menu_button(chat, uid)
        t, kb = biz_screen(uid)
        send(chat, t, kb)
        return
    if param == 'create':
        apply_menu_button(chat, uid)
        send(chat, BIZ_START_TEXT, biz_start_kb(bool(demo_companies())))
        return
    if INVITE_ID.match(param):
        apply_menu_button(chat, uid)
        send(chat, INVITE_TEXT, {'inline_keyboard': [[open_btn('👥  Открыть приглашение', param)],
                                                     [cb('‹ В меню', 'menu')]]})
        return
    if base and COMPANY_ID.match(base):
        # ссылка салона, которого сервер не знает (ещё не заполнен или удалён)
        apply_menu_button(chat, uid)
        send(chat, '<b>Страница записи</b>\n\nОткройте салон в приложении — там видно, что он уже предлагает.',
             {'inline_keyboard': [[open_btn('📅  Открыть страницу записи', param)], [cb('‹ В меню', 'menu')]]})
        return

    apply_menu_button(chat, uid)
    t, kb = main_menu(uid)
    send(chat, t, kb)


def biz_screen(uid):
    info = biz_info(uid)
    if info is None:
        return offline_text(), offline_kb()
    members = info.get('memberships') or []
    if not members:
        return BIZ_START_TEXT, biz_start_kb(bool(demo_companies()))
    want = state(uid).get('bizCompany')
    m = next((x for x in members if x['companyId'] == want), members[0])
    c = company(m['companyId']) or {'id': m['companyId'], 'name': m['name'], 'plan': m.get('plan')}
    return biz_text(c, m), biz_kb(m['companyId'], uid, many=len(members) > 1)


# --------------------------------------------------------------------- кнопки
def handle_callback(cq):
    data = cq.get('data') or ''
    msg = cq.get('message') or {}
    chat = (msg.get('chat') or {}).get('id')
    mid = msg.get('message_id')
    user = cq.get('from') or {}
    uid = user.get('id', 0)
    note = None

    if data.startswith('pick_c:') or data.startswith('pick_b:'):
        cid = data.split(':', 1)[1]
        if company(cid):
            if data.startswith('pick_c'):
                set_state(uid, role='client', company=cid)
                remember(uid, user, company=cid)
                apply_menu_button(chat, uid)
                note = 'Готово'
                data = 'salon'
            else:
                # демо-компания как бизнес: открываем кабинет в приложении
                set_state(uid, role='biz', bizCompany=cid)
                note = 'Готово'
                data = 'biz'
    if data.startswith('sw:'):
        set_state(uid, bizCompany=data.split(':', 1)[1])
        data = 'biz'

    if data == 'noop':
        tg('answerCallbackQuery', callback_query_id=cq['id'], text='В этот день мест нет')
        return

    tg('answerCallbackQuery', callback_query_id=cq['id'], text=note or None)
    if not chat:
        return

    cid = company_id_of(uid)
    c = company(cid) if cid else None

    # --- запись прямо в чате
    if data.startswith('bk:') or data.startswith('bkok:'):
        if not c:
            edit(chat, mid, 'Сначала откройте ссылку салона — тогда будет понятно, куда записывать.',
                 {'inline_keyboard': [[cb('‹ В меню', 'menu')]]})
            return
        if data.startswith('bk:'):
            t, kb = bk_screen(c, uid, data)
        else:
            t, kb = bk_confirm(c, uid, user, data)
        edit(chat, mid, t, kb)
        return
    if data == 'mine':
        t, kb = mine_screen(uid, cid)
        edit(chat, mid, t, kb)
        return
    if data.startswith('cxl:'):
        aid = data.split(':', 1)[1]
        try:
            api.cancel(aid, uid)
            head = '<b>Запись отменена</b>\nВремя снова свободно.\n\n'
        except api.ServerError as e:
            head = '<b>Не удалось отменить</b>\n%s\n\n' % esc(e.message)
        t, kb = mine_screen(uid, cid)
        edit(chat, mid, head + t, kb)
        return
    if data.startswith('reminders:'):
        t, kb = reminders_screen(data.split(':', 1)[1])
        edit(chat, mid, t, kb)
        return
    if data.startswith('link:'):
        cc = company(data.split(':', 1)[1])
        if cc:
            edit(chat, mid, link_text(cc), link_kb(cc['id']))
        return
    if data == 'biz':
        set_state(uid, role='biz')
        apply_menu_button(chat, uid)
        t, kb = biz_screen(uid)
        edit(chat, mid, t, kb)
        return
    if data == 'switch':
        info = biz_info(uid) or {}
        rows = [[cb(m['name'], 'sw:' + m['companyId'])] for m in info.get('memberships') or []]
        rows.append([cb('‹ Назад', 'biz')])
        edit(chat, mid, '<b>Выберите компанию</b>', {'inline_keyboard': rows})
        return
    if data == 'biz_start':
        edit(chat, mid, BIZ_START_TEXT, biz_start_kb(bool(demo_companies())))
        return
    if data == 'salon':
        if not c:
            data = 'menu'
        else:
            edit(chat, mid, client_text(c), client_kb(c, uid))
            return

    if data == 'menu':
        t, kb = main_menu(uid)
    elif data == 'role_client':
        t = '<b>Выберите салон</b>\n\nОбычно клиент попадает сюда по ссылке салона — тогда этот шаг не нужен.'
        kb = pick_kb('pick_c', 'menu')
    elif data == 'role_biz':
        t = '<b>Выберите компанию</b>\n\nЭто демо-компании с готовыми данными.'
        kb = pick_kb('pick_b', 'biz_start')
    elif data == 'services':
        if not c:
            t, kb = main_menu(uid)
        else:
            t, kb = services_text(c), client_back_kb(cid)
    elif data == 'contacts':
        if not c:
            t, kb = main_menu(uid)
        else:
            t, kb = contacts_text(c), client_back_kb(cid)
    elif data == 'features':
        t, kb = FEATURES_TEXT, back_kb([open_btn('Попробовать')] if HTTPS else None, 'biz_start')
    elif data == 'prices':
        t, kb = PRICES_TEXT, back_kb([open_btn('Начать бесплатно', 'onboarding')] if HTTPS else None, 'biz_start')
    elif data == 'support':
        extra = [{'text': '💬 Написать в поддержку', 'url': 'https://t.me/' + SUPPORT}] if SUPPORT else None
        t, kb = SUPPORT_TEXT, back_kb(extra)
    else:
        return
    edit(chat, mid, t, kb)


def main():
    setup()
    print('bot: слушаю обновления… (Ctrl+C для выхода)')
    print('     WEBAPP_URL =', URL or '(пусто)')
    offset = None
    conflicts = 0
    while True:
        try:
            r = tg('getUpdates', offset=offset, timeout=30, allowed_updates=['message', 'callback_query'])
            if not r.get('ok'):
                # Telegram разрешает опрашивать бота только одному процессу.
                if 'Conflict' in str(r.get('error', '')):
                    conflicts += 1
                    if conflicts == 3:
                        print('\n!! Этот бот уже запущен в другом месте. Один токен = один работающий бот.\n')
                    time.sleep(min(60, 5 * conflicts))
                    continue
                time.sleep(3)
                continue
            conflicts = 0
            for u in r.get('result', []):
                offset = u['update_id'] + 1
                try:
                    if 'callback_query' in u:
                        handle_callback(u['callback_query'])
                    elif 'message' in u:
                        handle_message(u['message'])
                except Exception as e:  # noqa: BLE001
                    print('   handle error:', e)
        except KeyboardInterrupt:
            print('\nbot: остановлен')
            return
        except Exception as e:  # noqa: BLE001
            print('   loop error:', e)
            time.sleep(3)


if __name__ == '__main__':
    main()
