"""
Телеграм-бот Zapis — вход в Mini App и меню, разное для клиента и для бизнеса.

Логика меню:
  * человек пришёл по ссылке салона (?start=c1) — видит меню этого салона:
    записаться, мои записи, услуги и цены, адрес и контакты. Ничего лишнего;
  * человек выбрал «У меня бизнес» — видит меню своей компании:
    кабинет, календарь, клиенты, ссылка для клиентов, подписка;
  * новый человек без ссылки — короткая витрина с выбором «клиент / бизнес».

Роль запоминается в bot/users.json, поэтому следующий /start сразу открывает
нужное меню. Кнопка рядом с полем ввода тоже подстраивается под роль.

Запуск:
  set BOT_TOKEN=...   (или файл .env рядом с проектом)
  set WEBAPP_URL=https://....trycloudflare.com
  python bot/bot.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import booking as bk  # noqa: E402

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
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()
TOKEN = os.environ.get('BOT_TOKEN', '').strip()
URL = os.environ.get('WEBAPP_URL', '').strip().rstrip('/')
API = 'https://api.telegram.org/bot%s/' % TOKEN

BRAND = os.environ.get('BRAND_NAME', 'Zapis').strip() or 'Zapis'
BOT_NAME = os.environ.get('BOT_NAME', '').strip()
SUPPORT = os.environ.get('SUPPORT_USERNAME', '').strip().lstrip('@')

ADMIN_IDS = {int(x) for x in os.environ.get('ADMIN_TG_IDS', '').replace(';', ',').split(',')
             if x.strip().isdigit()}
ADMIN_CODE = os.environ.get('ADMIN_CODE', '').strip()

if not TOKEN:
    print('!! BOT_TOKEN не задан (env или .env)')
    sys.exit(1)

HTTPS = URL.startswith('https://')
BOT_USERNAME = ''


def is_admin(user_id):
    return int(user_id) in ADMIN_IDS


# --------------------------------------------------------------------- данные
with open(os.path.join(HERE, 'companies.json'), 'r', encoding='utf-8-sig') as f:
    COMPANIES = json.load(f)

USERS_PATH = os.path.join(bk.DATA_DIR, 'users.json')
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


def company_of(uid, default='c1'):
    return COMPANIES.get(state(uid).get('company') or default) or COMPANIES[default]


def company_id_of(uid, default='c1'):
    cid = state(uid).get('company')
    return cid if cid in COMPANIES else default


# --------------------------------------------------------------------- API
def api(method, **params):
    data = json.dumps(params).encode('utf-8')
    req = urllib.request.Request(API + method, data=data,
                                 headers={'Content-Type': 'application/json'})
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
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


# --------------------------------------------------------------------- меню клиента
def client_text(cid):
    c = COMPANIES[cid]
    return (
        '<b>{name}</b>\n'
        '{cat} · {city}\n'
        '{addr}\n\n'
        '{about}\n\n'
        'Свободное время видно сразу — выберите услугу и запишитесь за полминуты.'
    ).format(name=esc(c['name']), cat=esc(c['cat']),
             city=esc(c['city']), addr=esc(c['addr']), about=esc(c['about']))


def client_kb(cid, uid=None):
    mine = bk.user_bookings(uid) if uid is not None else []
    rows = [
        # основной путь — приложение: там полный календарь на месяцы вперёд
        [open_btn('📅 Записаться', cid + '_book')],
        # быстрый путь для тех, кто не хочет открывать приложение
        [cb('⚡ Быстрая запись в чате', 'bk::::')],
        [open_btn('Мои записи' + (' · %d' % len(mine) if mine else ''), cid + '_my')],
    ]
    rows.append([cb('Услуги и цены', 'services'), cb('Контакты', 'contacts')])
    rows.append([cb('Поддержка', 'support')])
    rows.append([cb('‹ Выбрать другой салон', 'landing')])
    return {'inline_keyboard': rows}


def services_text(cid):
    c = COMPANIES[cid]
    rows = '\n'.join('• %s — <b>%s</b> · %s' % (esc(s[0]), s[1], s[2]) for s in c['services'])
    tail = ('\n\nЕщё %d услуг — в приложении.' % c['more']) if c.get('more') else ''
    return '<b>Услуги и цены</b>\n<i>%s</i>\n\n%s%s' % (esc(c['name']), rows, tail)


def contacts_text(cid):
    c = COMPANIES[cid]
    return (
        '<b>Как нас найти</b>\n<i>{name}</i>\n\n'
        '📍 {city}, {addr}\n'
        '📞 <code>{phone}</code>\n'
        '🕘 {hours}'
    ).format(name=esc(c['name']), city=esc(c['city']), addr=esc(c['addr']),
             phone=c['phone'], hours=esc(c['hours']))


def client_back_kb(cid):
    return {'inline_keyboard': [
        [open_btn('📅 Записаться', cid + '_book')],
        [cb('‹ Назад', 'menu')],
    ]}


# --------------------------------------------------------------------- запись в чате
def bk_state(data):
    """'bk:<svc>:<emp>:<day>:<time>' -> кортеж, пустые поля = ещё не выбрано."""
    parts = (data.split(':') + ['', '', '', ''])[1:5]
    svc = int(parts[0]) if parts[0] != '' else None
    emp = parts[1] if parts[1] != '' else None
    day = int(parts[2]) if parts[2] != '' else None
    tm = int(parts[3]) if parts[3] != '' else None
    return svc, emp, day, tm


def bk_data(svc='', emp='', day='', tm=''):
    return 'bk:%s:%s:%s:%s' % (svc, emp, day, tm)


def bk_day(idx):
    return date.today() + timedelta(days=idx)


def bk_screen(cid, uid, data):
    """Возвращает (текст, клавиатура) для текущего шага записи."""
    c = COMPANIES[cid]
    svc, emp, day, tm = bk_state(data)
    today = date.today()

    # --- шаг 1: услуга
    if svc is None:
        rows = [[cb('%s · %s' % (s[0], s[1]), bk_data(i))] for i, s in enumerate(c['services'])]
        rows.append([cb('‹ Назад', 'menu')])
        return ('<b>Выберите услугу</b>\n<i>%s</i>' % esc(c['name']),
                {'inline_keyboard': rows})

    s = c['services'][svc]

    # --- шаг 2: мастер
    if emp is None:
        rows = [[cb('Любой мастер — самое раннее время', bk_data(svc, 'x'))]]
        for i in bk.masters_for(c, svc):
            st = c['staff'][i]
            rows.append([cb('%s · %s' % (st['name'], bk.next_free_text(c, cid, i, s[3])),
                            bk_data(svc, i))])
        rows.append([cb('‹ Назад', bk_data())])
        return ('<b>Выберите мастера</b>\n%s · %s · %s' % (esc(s[0]), s[1], s[2]),
                {'inline_keyboard': rows})

    who = 'любой мастер' if emp == 'x' else c['staff'][int(emp)]['name']

    # --- шаг 3: день
    if day is None:
        days = bk.days_with_slots(c, cid, svc, emp if emp == 'x' else int(emp))
        rows, line = [], []
        for d, n in days:
            idx = (d - today).days
            label = bk.day_short(d, today) + (' · %d' % n if n else ' · нет')
            line.append(cb(label, bk_data(svc, emp, idx) if n else 'noop'))
            if len(line) == 2:
                rows.append(line)
                line = []
        if line:
            rows.append(line)
        rows.append([open_btn('📅 Полный календарь', cid + '_book')])
        rows.append([cb('‹ Назад', bk_data(svc))])
        return ('<b>Выберите день</b>\n%s · %s\n\n'
                '<i>Здесь ближайшие дни. Нужна дата дальше — откройте полный календарь.</i>'
                % (esc(s[0]), esc(who)), {'inline_keyboard': rows})

    d = bk_day(day)

    # --- шаг 4: время
    if tm is None:
        slots = bk.slots_for_choice(c, cid, svc, emp if emp == 'x' else int(emp), d)
        if not slots:
            return ('<b>На этот день мест нет</b>\nВыберите другой день.',
                    {'inline_keyboard': [[cb('‹ К выбору дня', bk_data(svc, emp))]]})
        rows, line = [], []
        for m, _ in slots:
            line.append(cb(bk.hm(m), bk_data(svc, emp, day, m)))
            if len(line) == 3:
                rows.append(line)
                line = []
        if line:
            rows.append(line)
        rows.append([open_btn('📅 Полный календарь', cid + '_book')])
        rows.append([cb('‹ Назад', bk_data(svc, emp))])
        return ('<b>Выберите время</b>\n%s · %s · %s' % (
            esc(s[0]), esc(who), bk.day_label(d, today)), {'inline_keyboard': rows})

    # --- шаг 5: подтверждение
    slots = dict(bk.slots_for_choice(c, cid, svc, emp if emp == 'x' else int(emp), d))
    if tm not in slots:
        return ('<b>Это время только что заняли</b>\nВыберите другое.',
                {'inline_keyboard': [[cb('‹ К выбору времени', bk_data(svc, emp, day))]]})
    real_emp = slots[tm]
    st = c['staff'][real_emp]
    txt = (
        '<b>Проверьте запись</b>\n\n'
        'Услуга — <b>{svc}</b>\n'
        'Мастер — <b>{emp}</b>\n'
        'Когда — <b>{day}, {time}</b>\n'
        'Длительность — {dur}\n'
        'Стоимость — <b>{price}</b>\n\n'
        '{name}\n{addr}'
    ).format(svc=esc(s[0]), emp=esc(st['name']), day=bk.day_label(d, today), time=bk.hm(tm),
             dur=s[2], price=s[1], name=esc(c['name']), addr=esc(c['addr']))
    return (txt, {'inline_keyboard': [
        [cb('✅ Подтвердить запись', 'bkok:%d:%d:%d:%d' % (svc, real_emp, day, tm))],
        [cb('‹ Изменить время', bk_data(svc, emp, day))],
    ]})


def bk_confirm(cid, uid, user, data):
    c = COMPANIES[cid]
    _, svc, emp, day, tm = data.split(':')
    svc, emp, day, tm = int(svc), int(emp), int(day), int(tm)
    s = c['services'][svc]
    d = bk_day(day)

    free = dict(bk.slots_for_choice(c, cid, svc, emp, d))
    if tm not in free:
        return ('<b>Это время уже заняли</b>\nВыберите другое — свободные слоты обновились.',
                {'inline_keyboard': [[cb('Выбрать другое время', bk_data(svc, emp, day))]]})

    rec = bk.add_booking({
        'id': '%s%d' % (hex(int(time.time() * 1000))[2:], uid % 997),
        'uid': uid, 'cid': cid, 'svc': svc, 'emp': emp,
        'date': d.isoformat(), 'min': tm, 'dur': s[3],
        'name': (user or {}).get('first_name', ''), 'status': 'active',
    })
    st = c['staff'][emp]
    txt = (
        '✅ <b>Готово! Вы записаны</b>\n\n'
        '<b>{svc}</b>\n'
        '{emp} · {day}, {time}\n'
        '{price} · {dur}\n\n'
        '{name}\n{addr}\n\n'
        'Напомним за день и за 2 часа до визита.'
    ).format(svc=esc(s[0]), emp=esc(st['name']), day=bk.day_label(d, date.today()),
             time=bk.hm(tm), price=s[1], dur=s[2], name=esc(c['name']), addr=esc(c['addr']))
    return (txt, {'inline_keyboard': [
        [cb('Мои записи', 'mine')],
        [cb('‹ В меню', 'menu')],
    ]})


def mine_screen(cid, uid):
    rows_bk = bk.user_bookings(uid)
    if not rows_bk:
        return ('<b>Мои записи</b>\n\nЗаписей пока нет. Свободное время видно сразу — '
                'выберите услугу и время в приложении или запишитесь прямо в чате.',
                {'inline_keyboard': [
                    [open_btn('📅  Записаться онлайн', cid + '_book')],
                    [cb('⚡ Быстрая запись в чате', 'bk::::')],
                    [cb('‹ В меню', 'menu')],
                ]})
    lines, rows = [], []
    for when, b in rows_bk:
        c = COMPANIES.get(b['cid'], COMPANIES[cid])
        s = c['services'][b['svc']]
        st = c['staff'][b['emp']]
        lines.append('<b>%s</b>\n%s · %s, %s · %s' % (
            esc(s[0]), esc(st['name']), bk.day_label(when.date(), date.today()),
            bk.hm(b['min']), s[1]))
        rows.append([cb('Отменить: %s %s' % (bk.day_label(when.date(), date.today()), bk.hm(b['min'])),
                        'cxl:' + b['id'])])
    rows.append([open_btn('📅  Записаться ещё', cid + '_book')])
    rows.append([cb('⚡ Быстрая запись в чате', 'bk::::')])
    rows.append([cb('‹ В меню', 'menu')])
    return ('<b>Мои записи</b>\n\n' + '\n\n'.join(lines) +
            '\n\nНапомним за 24 часа и за 2 часа до визита.',
            {'inline_keyboard': rows})


# --------------------------------------------------------------------- меню бизнеса
def biz_text(cid):
    c = COMPANIES[cid]
    return (
        '<b>{name}</b>\n'
        '{cat} · {city} · тариф {plan}\n\n'
        'Ваш кабинет: расписание команды, клиенты, деньги и AI-помощник.\n'
        'Клиенты записываются сами — по ссылке ниже.'
    ).format(name=esc(c['name']), cat=esc(c['cat']), city=esc(c['city']), plan=c['plan'])


def biz_kb(cid, uid=None):
    rows = [
        [open_btn('💼  Открыть кабинет', 'owner')],
        [open_btn('Календарь', 'owner_cal'), open_btn('Клиенты', 'owner_clients')],
        [cb('Ссылка для клиентов', 'link')],
        [cb('Подписка', 'plan'), cb('Поддержка', 'support')],
        [cb('🔔 Очередь напоминаний', 'reminders')],
        [cb('Сменить компанию', 'switch'), cb('‹ В меню', 'menu')],
    ]
    if uid is not None and is_admin(uid):
        rows.append([{'text': '🛡 Панель администратора', 'web_app': {'url': admin_url()}}])
    return {'inline_keyboard': rows}


def link_text(cid):
    c = COMPANIES[cid]
    link = 'https://t.me/%s?start=%s' % (BOT_USERNAME or 'bot', cid)
    return (
        '<b>Ссылка для клиентов</b>\n<i>{name}</i>\n\n'
        '<code>{link}</code>\n\n'
        'Поставьте её в шапку профиля, в сторис или отправьте в личном сообщении. '
        'По этой ссылке клиент сразу попадает на вашу страницу записи.'
    ).format(name=esc(c['name']), link=link)


def link_kb(cid):
    link = 'https://t.me/%s?start=%s' % (BOT_USERNAME or 'bot', cid)
    share = 'https://t.me/share/url?url=' + urllib.parse.quote(link) + \
            '&text=' + urllib.parse.quote('Записывайтесь онлайн — свободное время видно сразу')
    return {'inline_keyboard': [
        [{'text': '📤 Отправить ссылку', 'url': share}],
        [cb('‹ Назад', 'menu')],
    ]}


def plan_text(cid):
    c = COMPANIES[cid]
    return (
        '<b>Подписка</b>\n<i>{name}</i>\n\n'
        'Текущий тариф — <b>{plan}</b>.\n\n'
        '<b>START</b> — 9 900 ₸ / месяц\nОдин мастер, онлайн-запись, база клиентов, напоминания.\n\n'
        '<b>PRO</b> — 19 900 ₸ / месяц\nДо 10 сотрудников, AI-помощник, рассылки, аналитика и финансы.\n\n'
        '<b>BUSINESS</b> — 39 900 ₸ / месяц\nБез ограничений, филиалы, интеграции, приоритетная поддержка.'
    ).format(name=esc(c['name']), plan=c['plan'])


def plan_kb():
    return {'inline_keyboard': [
        [open_btn('Управлять подпиской', 'owner_sub')],
        [cb('‹ Назад', 'menu')],
    ]}


# --------------------------------------------------------------------- витрина
def pick_kb(prefix, title_cb='landing'):
    rows = [[cb(COMPANIES[k]['name'], '%s:%s' % (prefix, k))] for k in COMPANIES]
    rows.append([cb('‹ Назад', title_cb)])
    return {'inline_keyboard': rows}


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

SUPPORT_TEXT = (
    '<b>Поддержка</b>\n\n'
    'Поможем настроить услуги, график и страницу записи — обычно отвечаем '
    'в течение рабочего дня.'
)

HELP_TEXT = (
    '<b>Помощь</b>\n\n'
    '/start — главное меню\n'
    '/app — открыть приложение\n'
    '/help — эта справка\n\n'
    'Кнопка <b>«Открыть»</b> рядом с полем ввода запускает приложение '
    'в любой момент — она всегда актуальна.\n\n'
    'Если кнопка из старого сообщения не открывается, отправьте /start '
    'заново: в демо адрес приложения периодически меняется, и кнопки '
    'в старых сообщениях перестают работать.'
)


SHORT_DESC = 'Онлайн-запись для салонов и мастеров: календарь, клиенты, напоминания и AI-помощник.'

FULL_DESC = (
    'Онлайн-запись прямо в Telegram.\n\n'
    'Клиенты выбирают услугу, мастера и удобное время за 30 секунд — без звонков '
    'и переписок. Бизнес получает календарь всей команды, базу клиентов с историей '
    'визитов, автоматические напоминания, финансы и аналитику.\n\n'
    'Нажмите «Запустить», чтобы открыть приложение.'
)


def back_kb(extra=None):
    rows = []
    if extra:
        rows.append(extra)
    rows.append([cb('‹ Назад', 'menu')])
    return {'inline_keyboard': rows}


# --------------------------------------------------------------------- отправка
def send(chat_id, text, kb=None):
    p = {'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if kb:
        p['reply_markup'] = kb
    return api('sendMessage', **p)


def edit(chat_id, message_id, text, kb=None):
    p = {'chat_id': chat_id, 'message_id': message_id, 'text': text,
         'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if kb:
        p['reply_markup'] = kb
    return api('editMessageText', **p)


# ------------------------------------------------------ напоминания (§16)
# Отдельного планировщика нет и не нужно: цикл getUpdates просыпается
# минимум раз в 30 секунд, поэтому очередь проверяем прямо в нём —
# не чаще раза в минуту, чтобы не дёргать файл на каждой итерации.
REMIND_EVERY = 60
_last_remind_check = 0.0


def reminder_text(b, kind, left_min):
    c = COMPANIES.get(b['cid'])
    if not c:
        return None
    try:
        s = c['services'][b['svc']]
        st = c['staff'][b['emp']]
    except Exception:  # noqa: BLE001
        return None
    d = date.fromisoformat(b['date'])
    when = '%s, %s' % (bk.day_label(d, date.today()), bk.hm(b['min']))
    if kind == '24h':
        head = '🔔 <b>Напоминание: завтра запись</b>'
        tail = 'Если планы изменились, отмените заранее — время займёт кто-то другой.'
    else:
        hours = max(1, int(round(left_min / 60.0)))
        head = '⏰ <b>Через %d %s — ваша запись</b>' % (
            hours, 'час' if hours == 1 else 'часа' if hours < 5 else 'часов')
        tail = 'Ждём вас! Если опаздываете — предупредите, мы придержим время.'
    return (
        '{head}\n\n'
        '<b>{svc}</b>\n'
        '{emp} · {when}\n'
        '{price} · {dur}\n\n'
        '{name}\n{addr}\n\n'
        '{tail}'
    ).format(head=head, svc=esc(s[0]), emp=esc(st['name']), when=when,
             price=s[1], dur=s[2], name=esc(c['name']), addr=esc(c['addr']), tail=tail)


def send_due_reminders():
    """Разослать созревшие напоминания. Возвращает, сколько отправлено."""
    sent = 0
    for b, kind, left in bk.due_reminders():
        txt = reminder_text(b, kind, left)
        if not txt:
            bk.mark_reminded(b.get('id'), kind)
            continue
        kb = {'inline_keyboard': [
            [cb('Мои записи', 'mine')],
            [cb('Отменить запись', 'cxl:' + b['id'])],
        ]}
        r = send(b['uid'], txt, kb)
        # если пользователь заблокировал бота, помечаем как отправленное:
        # иначе бот будет пытаться достучаться до него каждую минуту
        bk.mark_reminded(b.get('id'), kind)
        if r.get('ok'):
            sent += 1
        else:
            print('   напоминание не ушло:', r.get('error') or r)
    return sent


def tick_reminders():
    global _last_remind_check
    now = time.time()
    if now - _last_remind_check < REMIND_EVERY:
        return
    _last_remind_check = now
    try:
        n = send_due_reminders()
        if n:
            print('   напоминаний отправлено:', n)
    except Exception as e:  # noqa: BLE001
        print('   ошибка напоминаний:', e)


def reminders_screen(uid):
    """Служебная сводка: что и когда уйдёт клиентам. Помогает проверить §16."""
    rows = bk.upcoming_all(12)
    if not rows:
        return ('<b>Очередь напоминаний</b>\n\nБудущих записей нет — напоминать не о чем.',
                {'inline_keyboard': [[cb('‹ В меню', 'menu')]]})
    now = datetime.now()
    lines = []
    for when, b in rows:
        sent = b.get('reminded') or {}
        marks = []
        for kind, before in bk.REMINDERS:
            point = when - timedelta(minutes=before)
            label = 'за сутки' if kind == '24h' else 'за 2 часа'
            if sent.get(kind):
                marks.append('%s — отправлено' % label)
            elif point < now:
                marks.append('%s — пропущено' % label)
            else:
                marks.append('%s — %s' % (label, point.strftime('%d.%m %H:%M')))
        c = COMPANIES.get(b['cid'], {})
        svc = ''
        try:
            svc = c['services'][b['svc']][0]
        except Exception:  # noqa: BLE001
            svc = 'услуга'
        lines.append('<b>%s</b> · %s\n%s\n%s' % (
            esc(svc), when.strftime('%d.%m %H:%M'),
            esc(b.get('name') or 'клиент'), '\n'.join(marks)))
    return ('<b>Очередь напоминаний</b>\n\n' + '\n\n'.join(lines) +
            '\n\nБот проверяет очередь раз в минуту.',
            {'inline_keyboard': [[cb('Обновить', 'reminders')], [cb('‹ В меню', 'menu')]]})


def main_menu(uid):
    """
    Главное меню: три действия и ничего лишнего.

      1) записаться — приложение с полным календарём;
      2) свои записи — прямо в чате, без открытия приложения;
      3) бизнес — кабинет, если он есть, иначе создание.

    Второстепенное (услуги, контакты, тарифы) живёт внутри этих трёх
    экранов и в /help: на первом экране оно только рассеивает внимание.
    """
    s = state(uid)
    cid = company_id_of(uid)
    c = COMPANIES[cid]
    mine = bk.user_bookings(uid)
    biz_cid = s.get('company') if s.get('role') == 'biz' else None

    lines = ['<b>%s — онлайн-запись в Telegram</b>' % esc(BRAND), '']
    if biz_cid and biz_cid in COMPANIES:
        lines.append('Ваш бизнес: <b>%s</b> · тариф %s'
                     % (esc(COMPANIES[biz_cid]['name']), esc(COMPANIES[biz_cid]['plan'])))
    else:
        lines.append('Салон: <b>%s</b> · %s' % (esc(c['name']), esc(c['city'])))
    if mine:
        when, b = mine[0]
        # услугу берём из салона самой записи: она может быть не из текущего
        bc = COMPANIES.get(b['cid'], c)
        try:
            svc = bc['services'][b['svc']][0]
        except Exception:  # noqa: BLE001
            svc = 'визит'
        where = '' if b['cid'] == cid else ' · ' + esc(bc['name'])
        lines.append('Ближайшая запись: <b>%s, %s</b> · %s%s' % (
            bk.day_label(when.date(), date.today()), bk.hm(b['min']), esc(svc), where))
    lines.append('')
    lines.append('Свободное время видно сразу — запись занимает полминуты.')

    rows = [[open_btn('📅  Записаться онлайн', cid + '_book')]]
    rows.append([cb('🗓  Мои записи' + (' · %d' % len(mine) if mine else ''), 'mine')])
    if biz_cid and biz_cid in COMPANIES:
        rows.append([cb('💼  %s' % COMPANIES[biz_cid]['name'], 'biz')])
    else:
        rows.append([cb('💼  Создать бизнес', 'biz_start')])
    return '\n'.join(lines), {'inline_keyboard': rows}


BIZ_START_TEXT = (
    '<b>Бизнесу</b>\n\n'
    'Соберите страницу записи за пару минут: услуги, мастера, часы работы. '
    'Дальше клиенты записываются сами, а вы видите расписание, клиентов '
    'и деньги в одном приложении.\n\n'
    'Можно не настраивать с нуля — откройте готовую демо-компанию '
    'и посмотрите, как это выглядит с данными.'
)


def biz_start_kb():
    return {'inline_keyboard': [
        [open_btn('✨  Создать свой бизнес', 'onboarding')],
        [cb('Открыть демо-компанию', 'role_biz')],
        [cb('Возможности', 'features'), cb('Тарифы', 'prices')],
        [cb('‹ В меню', 'menu')],
    ]}


def menu_for(uid):
    """Текст и клавиатура главного меню."""
    return main_menu(uid)


def apply_menu_button(chat_id, uid):
    """Кнопка рядом с полем ввода — своя для клиента и для бизнеса."""
    if not HTTPS:
        return
    s = state(uid)
    if s.get('role') == 'client':
        text, param = 'Записаться', company_id_of(uid) + '_book'
    elif s.get('role') == 'biz':
        text, param = 'Кабинет', 'owner'
    else:
        text, param = 'Открыть', ''
    api('setChatMenuButton', chat_id=chat_id,
        menu_button={'type': 'web_app', 'text': text, 'web_app': {'url': app_url(param)}})


# --------------------------------------------------------------------- настройка
def setup():
    global BOT_USERNAME
    print('bot: настройка…')
    me = api('getMe').get('result', {})
    BOT_USERNAME = me.get('username', '')

    if BOT_NAME:
        r = api('setMyName', name=BOT_NAME)
        print('   имя бота:', 'ok' if r.get('ok') else 'пропущено (лимит Telegram)')
    api('setMyShortDescription', short_description=SHORT_DESC)
    api('setMyDescription', description=FULL_DESC)
    api('setMyCommands', commands=[
        {'command': 'start', 'description': 'Главное меню'},
        {'command': 'app', 'description': 'Открыть приложение'},
        {'command': 'salons', 'description': 'Выбрать салон'},
        {'command': 'help', 'description': 'Помощь и поддержка'},
    ])
    if HTTPS:
        r = api('setChatMenuButton', menu_button={
            'type': 'web_app', 'text': 'Открыть', 'web_app': {'url': app_url()}})
        print('   кнопка меню:', 'ok' if r.get('ok') else r)
    else:
        print('   !! WEBAPP_URL не https — кнопки web_app недоступны, шлём обычную ссылку')

    if me:
        print('   бот: @%s (%s)' % (BOT_USERNAME, me.get('id')))
        print('   ссылка: https://t.me/%s' % BOT_USERNAME)
    for k in COMPANIES:
        print('   ссылка салона %s: https://t.me/%s?start=%s' % (COMPANIES[k]['short'], BOT_USERNAME, k))
    print('   супер-админы: %s' % (', '.join(str(i) for i in sorted(ADMIN_IDS)) or
                                   'не заданы (команда /admin покажет ваш ID)'))


# --------------------------------------------------------------------- сообщения
HIDDEN = {'/app': '', '/owner': 'owner', '/staff': 'employee'}


def handle_message(msg):
    chat = msg['chat']['id']
    uid = (msg.get('from') or {}).get('id', 0)
    text = (msg.get('text') or '').strip()
    low = text.lower().split('@')[0].split()[0] if text else ''

    if low == '/help':
        send(chat, HELP_TEXT, back_kb([open_btn('Открыть приложение')] if HTTPS else None))
        return

    if low == '/salons':
        send(chat, '<b>Демо-салоны</b>\n\nВыберите, от чьего имени смотреть запись.',
             pick_kb('pick_c', 'menu'))
        return

    if low == '/admin':
        if not is_admin(uid):
            send(chat, 'Панель администратора доступна только сотрудникам сервиса.\n\n'
                       'Ваш Telegram ID: <code>%s</code>' % uid)
            print('   отказ в доступе к панели: id=%s' % uid)
            return
        kb = {'inline_keyboard': [[{'text': '🛡 Открыть панель', 'web_app': {'url': admin_url()}}]]} \
            if HTTPS else {'inline_keyboard': [[{'text': '🛡 Открыть панель', 'url': admin_url()}]]}
        send(chat, '<b>Панель администратора</b>\n\nКомпании, подписки, MRR и активность.', kb)
        return

    if low in HIDDEN:
        send(chat, 'Открываю приложение.', {'inline_keyboard': [[open_btn('Открыть', HIDDEN[low])]]})
        return

    # /start [param]
    param = ''
    if low == '/start':
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            param = parts[1].strip()

    if param in COMPANIES:                       # пришёл по ссылке салона
        set_state(uid, role='client', company=param)
    elif param in ('biz', 'business', 'owner'):  # ссылка «для бизнеса»
        set_state(uid, role='biz', company=company_id_of(uid))

    apply_menu_button(chat, uid)
    t, kb = menu_for(uid)
    send(chat, t, kb)


# --------------------------------------------------------------------- кнопки
def handle_callback(cq):
    data = cq.get('data') or ''
    msg = cq.get('message') or {}
    chat = (msg.get('chat') or {}).get('id')
    mid = msg.get('message_id')
    uid = (cq.get('from') or {}).get('id', 0)
    note = None

    if data.startswith('pick_c:') or data.startswith('pick_b:'):
        cid = data.split(':', 1)[1]
        if cid in COMPANIES:
            set_state(uid, role='client' if data.startswith('pick_c') else 'biz', company=cid)
            apply_menu_button(chat, uid)
            note = 'Готово'
        data = 'menu'

    if data == 'noop':
        api('answerCallbackQuery', callback_query_id=cq['id'], text='В этот день мест нет')
        return

    api('answerCallbackQuery', callback_query_id=cq['id'], text=note or None)
    if not chat:
        return

    cid = company_id_of(uid)
    role = state(uid).get('role')

    # --- запись прямо в чате
    if data.startswith('bk:'):
        if role != 'client':
            set_state(uid, role='client', company=cid)
        t, kb = bk_screen(cid, uid, data)
        edit(chat, mid, t, kb)
        return
    if data.startswith('bkok:'):
        t, kb = bk_confirm(cid, uid, cq.get('from'), data)
        edit(chat, mid, t, kb)
        return
    if data == 'mine':
        t, kb = mine_screen(cid, uid)
        edit(chat, mid, t, kb)
        return
    if data == 'reminders':
        t, kb = reminders_screen(uid)
        edit(chat, mid, t, kb)
        return
    if data == 'biz':
        # бизнес уже выбран — показываем его название и быстрые действия
        t, kb = biz_text(company_id_of(uid)), biz_kb(company_id_of(uid), uid)
        edit(chat, mid, t, kb)
        return
    if data == 'biz_start':
        edit(chat, mid, BIZ_START_TEXT, biz_start_kb())
        return
    if data.startswith('cxl:'):
        rec = bk.cancel_booking(uid, data.split(':', 1)[1])
        t, kb = mine_screen(cid, uid)
        if rec:
            t = '<b>Запись отменена</b>\nВремя снова свободно.\n\n' + t
        edit(chat, mid, t, kb)
        return

    if data == 'menu':
        t, kb = menu_for(uid)
    elif data == 'landing':
        USERS.pop(str(uid), None)
        save_users()
        apply_menu_button(chat, uid)
        t, kb = menu_for(uid)
    elif data == 'role_client':
        t = '<b>Выберите салон</b>\n\nОбычно клиент попадает сюда по ссылке салона — ' \
            'тогда этот шаг не нужен.'
        kb = pick_kb('pick_c', 'menu')
    elif data == 'role_biz':
        t = '<b>Выберите компанию</b>\n\nЭто демо-компании с готовыми данными: ' \
            'расписанием, клиентами и финансами.'
        kb = pick_kb('pick_b', 'biz_start')
    elif data == 'switch':
        t = '<b>Выберите компанию</b>'
        kb = pick_kb('pick_b', 'biz')
    elif data == 'services':
        t, kb = services_text(cid), client_back_kb(cid)
    elif data == 'contacts':
        t, kb = contacts_text(cid), client_back_kb(cid)
    elif data == 'link':
        t, kb = link_text(cid), link_kb(cid)
    elif data == 'plan':
        t, kb = plan_text(cid), plan_kb()
    elif data == 'features':
        t, kb = FEATURES_TEXT, back_kb([open_btn('Попробовать')] if HTTPS else None)
    elif data == 'prices':
        t, kb = PRICES_TEXT, back_kb([open_btn('Начать бесплатно')] if HTTPS else None)
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
            tick_reminders()
            r = api('getUpdates', offset=offset, timeout=30,
                    allowed_updates=['message', 'callback_query'])
            if not r.get('ok'):
                # Telegram разрешает опрашивать бота только одному процессу.
                # Если токен запущен ещё где-то (например, на втором ноутбуке),
                # экземпляры будут бесконечно выбивать друг друга.
                if 'Conflict' in str(r.get('error', '')):
                    conflicts += 1
                    if conflicts == 3:
                        print('')
                        print('!! Этот бот уже запущен на другом компьютере.')
                        print('   Один токен = один работающий бот.')
                        print('   Остановите демо на второй машине '
                              '(4 ОСТАНОВИТЬ.cmd) и запустите здесь заново.')
                        print('')
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
