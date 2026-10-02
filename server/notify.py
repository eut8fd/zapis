"""
Уведомления в Telegram: что, кому и когда.

Раньше напоминания слал бот из своей очереди, а новая запись из приложения
до владельца не доходила вовсе. Теперь всё происходит на сервере в момент
изменения данных: приложение сохранило запись — сервер поставил в очередь
напоминания клиенту и сразу сообщил бизнесу. Отправкой занимается поток
Sender: он один держит токен бота для `sendMessage`, а long polling
остаётся у бота — Telegram не против двух процессов, если getUpdates
зовёт только один.

Правила:
  * клиенту: подтверждение (если записал салон), напоминание за сутки
    и за 2 часа, просьба об отзыве после визита, отмена и перенос салоном;
  * бизнесу (владелец + мастер): новая запись, отмена и перенос клиентом,
    утренняя сводка на день (если включена в настройках);
  * платформе (ADMIN_TG_IDS): новая компания, заявка на оплату, жалоба.
Каждое уведомление имеет уникальный ключ, поэтому повторный запуск,
перенос записи или двойное сохранение второго сообщения не создают.
Напоминание, проспанное сервером больше чем на 40 минут, не досылается:
«напомним за сутки» через полдня после срока выглядит поломкой.
"""
import html
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import config
import slots

REMINDERS = (('rem24', 24 * 60), ('rem2', 2 * 60))
LATE_LIMIT_MIN = 40
MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
          'сентября', 'октября', 'ноября', 'декабря']
WD = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']

_bot_username = ''


def esc(s):
    return html.escape(str(s if s is not None else ''), quote=False)


def company_tz(company):
    return slots.tzinfo_for((company or {}).get('tz') or config.TZ)


def when_text(dt_utc, tz, now=None):
    now = now or datetime.now(timezone.utc)
    l, n = dt_utc.astimezone(tz), now.astimezone(tz)
    delta = (l.date() - n.date()).days
    hm = l.strftime('%H:%M')
    if delta == 0:
        return 'сегодня, ' + hm
    if delta == 1:
        return 'завтра, ' + hm
    return '%d %s, %s' % (l.day, MONTHS[l.month - 1], hm)


def app_button(text, param=''):
    url = config.WEBAPP_URL
    if not url:
        return None
    if param:
        url += ('&' if '?' in url else '?') + 'start=' + urllib.parse.quote(param)
    if url.startswith('https://'):
        return {'text': text, 'web_app': {'url': url}}
    return {'text': text, 'url': url}


def buttons(*rows):
    out = []
    for row in rows:
        r = [b for b in row if b]
        if r:
            out.append(r)
    return out


def money(n, currency='₸'):
    try:
        n = int(round(float(n)))
    except (TypeError, ValueError):
        return ''
    # валюту задаёт владелец — в HTML сообщения она идёт только экранированной
    return '{:,}'.format(n).replace(',', ' ') + ' ' + esc(currency or '₸')


def duration_text(m):
    m = int(m or 0)
    if m < 60:
        return '%d мин' % m
    h, rest = divmod(m, 60)
    return '%d ч %d мин' % (h, rest) if rest else '%d ч' % h


# ------------------------------------------------------------------ контекст записи
class ApptView:
    """Всё, что нужно для текста: салон, клиент, мастер, услуги, время."""

    def __init__(self, store, a):
        self.a = a
        self.company = store.body('companies', a.get('companyId')) or {}
        self.client = store.body('clients', a.get('clientId')) or {}
        self.emp = store.body('employees', a.get('employeeId')) or {}
        self.services = [s for s in (store.body('services', i) for i in (a.get('serviceIds') or [])) if s]
        self.tz = company_tz(self.company)
        self.start = slots.parse_iso(a.get('start'))

    @property
    def title(self):
        return ' + '.join(s.get('name', '') for s in self.services) or 'Услуга'

    @property
    def client_tg(self):
        return str(self.client.get('tgId') or '')

    @property
    def when(self):
        return when_text(self.start, self.tz) if self.start else ''

    @property
    def end(self):
        return self.start + timedelta(minutes=int(self.a.get('duration') or 60)) if self.start else None

    def business_tgs(self):
        """Кому в салоне сообщать: мастер записи и владелец, без дублей."""
        out = []
        if self.emp.get('tgId'):
            out.append(str(self.emp['tgId']))
        for e in self.company_employees():
            if e.get('isOwner') and e.get('tgId') and str(e['tgId']) not in out:
                out.append(str(e['tgId']))
        return out

    def company_employees(self):
        if not hasattr(self, '_emps'):
            self._emps = []
        return self._emps

    def card(self, for_client=True):
        """Строки карточки визита под заголовком."""
        lines = ['<b>%s</b>' % esc(self.title)]
        who = self.emp.get('name', '')
        if for_client:
            lines.append('%s · %s' % (esc(who), esc(self.when)) if who else esc(self.when))
            lines.append('%s · %s' % (money(self.a.get('price'), self.company.get('currency')),
                                      duration_text(self.a.get('duration'))))
            lines.append('')
            lines.append(esc(self.company.get('name', '')))
            if self.company.get('addr'):
                lines.append(esc(self.company['addr']))
        else:
            lines.append('%s · %s' % (esc(self.client.get('name') or 'Клиент'), esc(self.when)))
            if who:
                lines.append('Мастер — %s' % esc(who))
            if self.client.get('phone'):
                lines.append('Телефон — <code>%s</code>' % esc(self.client['phone']))
            lines.append('%s · %s' % (money(self.a.get('price'), self.company.get('currency')),
                                      duration_text(self.a.get('duration'))))
        return '\n'.join(lines)


def notify_settings(company):
    n = (company or {}).get('notify') or {}
    return {
        'rem24': n.get('rem24', True), 'rem2': n.get('rem2', True),
        'review': n.get('review', True), 'digest': n.get('digest', False),
    }


# ------------------------------------------------------------------ постановка
def schedule_client_reminders(store, v):
    a = v.a
    tg = v.client_tg
    if not tg or not v.start or a.get('status') != 'planned':
        return
    st = notify_settings(v.company)
    cid = v.company.get('id')
    kb = buttons([app_button('Мои записи', '%s_my' % cid)])
    # Ключ включает время визита: перенесённая запись получает новое
    # напоминание, даже если старое уже отправлено.
    stamp = int(v.start.timestamp())
    for kind, before in REMINDERS:
        if not st[kind]:
            continue
        due = v.start - timedelta(minutes=before)
        if due < datetime.now(timezone.utc) - timedelta(minutes=5):
            continue
        if kind == 'rem24':
            text = '🔔 <b>Напоминание: завтра запись</b>\n\n%s\n\nЕсли планы изменились, перенесите ' \
                   'или отмените запись заранее — время займёт кто-то другой.' % v.card()
        else:
            text = '⏰ <b>Через 2 часа — ваша запись</b>\n\n%s\n\nЖдём вас! Если опаздываете, ' \
                   'предупредите салон.' % v.card()
        store.schedule('%s:%s:%d' % (kind, a['id'], stamp), tg, kind, text, due.timestamp(),
                       ref=a['id'], company_id=cid, buttons=kb)
    if st['review'] and v.end:
        due = v.end + timedelta(minutes=90)
        text = '⭐ <b>Как всё прошло?</b>\n\n%s\n\nОцените визит — это займёт полминуты. ' \
               'Оценку увидит только владелец салона.' % v.card()
        store.schedule('review:%s:%d' % (a['id'], stamp), tg, 'review', text, due.timestamp(), ref=a['id'],
                       company_id=cid, buttons=buttons([app_button('Оценить визит', '%s_my' % cid)]))


def cancel_client_reminders(store, appt_id):
    store.cancel_notifications(appt_id, kinds=['rem24', 'rem2', 'review'])


def company_inbox(store, company_id, kind, title, text, go_to=None, ref_id=None):
    """Карточка в «Уведомлениях» владельца — колокольчик в приложении."""
    rec = {
        'id': 'in_%s_%s' % (kind, ref_id or int(time.time() * 1000)),
        'companyId': company_id, 'kind': kind, 'title': title, 'text': text,
        'goTo': go_to, 'refId': ref_id, 'at': slots.to_iso(datetime.now(timezone.utc)), 'readAt': None,
    }
    # один и тот же id при повторной записи — одна карточка
    store.put('inbox', rec, by='server')
    return rec


def notify_business(store, v, kind, head, tail=''):
    cid = v.company.get('id')
    text = '%s\n\n%s' % (head, v.card(for_client=False))
    if tail:
        text += '\n\n' + tail
    kb = buttons([app_button('Открыть календарь', 'owner_cal')])
    n = 0
    v._emps = store.bodies('employees', cid)
    for tg in v.business_tgs():
        # мастер и владелец получают по одному сообщению на событие
        store.schedule('%s:%s:%s' % (kind, v.a['id'], tg), tg, kind, text, time.time(),
                       ref=v.a['id'], company_id=cid, buttons=kb)
        n += 1
    return n


def notify_client(store, v, kind, head, tail='', param_suffix='_my'):
    tg = v.client_tg
    if not tg:
        return 0
    cid = v.company.get('id')
    text = '%s\n\n%s' % (head, v.card())
    if tail:
        text += '\n\n' + tail
    store.schedule('%s:%s:%d' % (kind, v.a['id'], int(time.time())), tg, kind, text, time.time(),
                   ref=v.a['id'], company_id=cid,
                   buttons=buttons([app_button('Мои записи', '%s%s' % (cid, param_suffix))]))
    return 1


def on_appointment(store, old, new, actor_role):
    """
    Реакция на сохранение записи. actor_role — кто сохранил:
    'client' (сам клиент, из приложения или чата) либо роль салона.
    """
    v = ApptView(store, new)
    if not v.company:
        return
    cid = v.company['id']
    by_client = actor_role in ('client', 'bot')
    created = old is None or (old.get('status') != 'planned' and new.get('status') == 'planned')
    status, old_status = new.get('status'), (old or {}).get('status')

    if created and status == 'planned':
        schedule_client_reminders(store, v)
        if by_client:
            notify_business(store, v, 'new', '🆕 <b>Новая запись</b>')
            company_inbox(store, cid, 'booking',
                          'Новая запись: %s' % (v.client.get('name') or 'клиент'),
                          '%s · %s · %s' % (v.title, v.when, v.emp.get('name', '')),
                          go_to='o.cal', ref_id=new['id'])
        else:
            notify_client(store, v, 'booked', '✅ <b>Вас записали</b>',
                          'Напомним за сутки и за 2 часа до визита.')
        return

    if status == 'cancelled' and old_status != 'cancelled':
        cancel_client_reminders(store, new['id'])
        if by_client or new.get('cancelledBy') == 'client':
            notify_business(store, v, 'cancel', '❌ <b>Клиент отменил запись</b>',
                            'Время снова свободно.')
            company_inbox(store, cid, 'cancel',
                          'Отмена: %s' % (v.client.get('name') or 'клиент'),
                          '%s · %s' % (v.title, v.when), go_to='o.cal', ref_id=new['id'])
        else:
            notify_client(store, v, 'cancelled', '❌ <b>Запись отменена салоном</b>',
                          'Приносим извинения. Выберите другое время — свободные окна видно сразу.',
                          param_suffix='_book')
        return

    if status == 'planned' and old_status == 'planned' and (
            old.get('start') != new.get('start') or old.get('employeeId') != new.get('employeeId')):
        cancel_client_reminders(store, new['id'])
        schedule_client_reminders(store, v)
        if by_client:
            notify_business(store, v, 'move', '🔁 <b>Клиент перенёс запись</b>')
            company_inbox(store, cid, 'booking',
                          'Перенос: %s' % (v.client.get('name') or 'клиент'),
                          '%s · теперь %s' % (v.title, v.when), go_to='o.cal', ref_id=new['id'])
        else:
            notify_client(store, v, 'moved', '🔁 <b>Запись перенесена</b>',
                          'Новое время уже в «Моих записях». Напомним заранее.')
        return

    if status == 'done' and old_status == 'planned':
        # визит закрыли раньше расчётного конца — просьбу об отзыве подвинем
        if v.client_tg and notify_settings(v.company)['review'] and v.start:
            due = datetime.now(timezone.utc) + timedelta(minutes=60)
            text = '⭐ <b>Как всё прошло?</b>\n\n%s\n\nОцените визит — это займёт полминуты. ' \
                   'Оценку увидит только владелец салона.' % v.card()
            store.schedule('review:%s:%d' % (new['id'], int(v.start.timestamp())), v.client_tg, 'review', text,
                           due.timestamp(), ref=new['id'], company_id=cid,
                           buttons=buttons([app_button('Оценить визит', '%s_my' % cid)]))


def notify_admins(store, kind, ref, text, kb=None):
    n = 0
    for tg in sorted(config.ADMIN_TG_IDS):
        store.schedule('%s:%s:%s' % (kind, ref, tg), tg, kind, text, time.time(), ref=ref, buttons=kb or [])
        n += 1
    return n


def on_company_created(store, company, identity):
    text = ('🏢 <b>Новая компания</b>\n\n<b>%s</b>\n%s · %s\n\nВладелец: %s%s'
            % (esc(company.get('name')), esc(company.get('cat')), esc(company.get('city')),
               esc(identity.name), (' (@%s)' % esc(identity.username)) if identity.username else ''))
    notify_admins(store, 'admin_company', company['id'], text,
                  buttons([app_button('Открыть панель', 'admin')]))


def on_ticket(store, ticket, identity):
    topic = ticket.get('topic')
    company = store.body('companies', ticket.get('companyId')) or {}
    msg = (ticket.get('messages') or [{}])[0].get('text', '')
    if topic == 'billing':
        head = '💳 <b>Заявка на оплату</b>'
    elif topic == 'complaint':
        head = '⚠️ <b>Жалоба клиента</b>'
    else:
        head = '💬 <b>Обращение в поддержку</b>'
    text = '%s\n\n<b>%s</b>\n%s\n\n%s\n\nОт: %s%s' % (
        head, esc(ticket.get('subject') or ''), esc(company.get('name') or 'без компании'),
        esc(msg[:600]), esc(identity.name), (' (@%s)' % esc(identity.username)) if identity.username else '')
    notify_admins(store, 'admin_ticket', ticket['id'], text, buttons([app_button('Открыть панель', 'admin')]))


def on_invite_accepted(store, employee, company):
    """Владельцу — что в команде появился человек."""
    owners = [e for e in store.bodies('employees', company['id']) if e.get('isOwner') and e.get('tgId')]
    for o in owners:
        if str(o['tgId']) == str(employee.get('tgId')):
            continue
        store.schedule('invite:%s:%s' % (employee['id'], o['tgId']), o['tgId'], 'invite',
                       '👥 <b>%s присоединился к команде</b>\n\n%s · %s'
                       % (esc(employee.get('name')), esc(employee.get('role')), esc(company.get('name'))),
                       time.time(), ref=employee['id'], company_id=company['id'],
                       buttons=buttons([app_button('Команда', 'owner_more')]))
    company_inbox(store, company['id'], 'system', '%s в команде' % employee.get('name'),
                  'Вошёл по приглашению: %s' % employee.get('role'), go_to='o.team', ref_id=employee['id'])


# ------------------------------------------------------------------ сводка на день
def daily_digests(store, now=None):
    """Утром — каждому мастеру его день. Ключ по дате, повторно не уходит."""
    now = now or datetime.now(timezone.utc)
    n = 0
    for company in store.all_companies():
        if not notify_settings(company)['digest'] or company.get('status') == 'blocked':
            continue
        tz = company_tz(company)
        ln = now.astimezone(tz)
        if ln.hour < 8:
            continue
        day = ln.date()
        appts = [a for a in store.bodies('appointments', company['id'])
                 if a.get('status') == 'planned' and slots.parse_iso(a.get('start'))
                 and slots.parse_iso(a['start']).astimezone(tz).date() == day]
        emps = store.bodies('employees', company['id'])
        for e in emps:
            if not e.get('tgId') or e.get('active') is False:
                continue
            mine = sorted([a for a in appts if a.get('employeeId') == e['id'] or e.get('isOwner')],
                          key=lambda a: a['start'])
            if not mine:
                continue
            lines = []
            for a in mine:
                v = ApptView(store, a)
                who = v.client.get('name') or 'клиент'
                em = '' if a.get('employeeId') == e['id'] else ' · ' + v.emp.get('name', '').split(' ')[0]
                lines.append('%s — %s, %s%s' % (v.start.astimezone(tz).strftime('%H:%M'), esc(who),
                                                esc(v.title), esc(em)))
            text = '☀️ <b>Сегодня, %d %s · %d %s</b>\n\n%s' % (
                day.day, MONTHS[day.month - 1], len(mine), plural(len(mine), 'запись', 'записи', 'записей'),
                '\n'.join(lines))
            store.schedule('digest:%s:%s' % (e['id'], day.isoformat()), e['tgId'], 'digest', text,
                           now.timestamp(), ref='digest:%s' % e['id'], company_id=company['id'],
                           buttons=buttons([app_button('Открыть календарь', 'owner_cal')]))
            n += 1
    return n


def plural(n, one, few, many):
    a, b = abs(n) % 100, abs(n) % 10
    if 10 < a < 20:
        return many
    if 1 < b < 5:
        return few
    if b == 1:
        return one
    return many


def auto_complete(store, now=None):
    """
    Запись, закончившаяся больше двух часов назад, считается выполненной —
    то же правило, что в приложении, только не зависит от того, открыл ли
    кто-то кабинет. Без этого просьба об отзыве и статистика ждали бы входа.
    """
    now = now or datetime.now(timezone.utc)
    n = 0
    for a in store.bodies('appointments'):
        if a.get('status') != 'planned':
            continue
        st = slots.parse_iso(a.get('start'))
        if not st:
            continue
        end = st + timedelta(minutes=int(a.get('duration') or 60))
        if end < now - timedelta(hours=2):
            a['status'] = 'done'
            a['completedAt'] = slots.to_iso(now)
            store.put('appointments', a, by='server')
            n += 1
    return n


# ------------------------------------------------------------------ отправка
def send_message(token, chat_id, text, kb=None, timeout=20):
    """(ok, error, retry_after). 403 — человек заблокировал бота: не повторяем."""
    if not token:
        return False, 'BOT_TOKEN не задан', 0
    payload = {'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if kb:
        payload['reply_markup'] = {'inline_keyboard': kb}
    req = urllib.request.Request('https://api.telegram.org/bot%s/sendMessage' % token,
                                 data=json.dumps(payload).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode('utf-8'))
            return bool(data.get('ok')), None if data.get('ok') else str(data)[:200], 0
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        retry = 0
        try:
            retry = int(json.loads(body).get('parameters', {}).get('retry_after') or 0)
        except (ValueError, AttributeError):
            pass
        return False, 'HTTP %s %s' % (e.code, body[:200]), retry
    except Exception as e:  # noqa: BLE001
        return False, str(e)[:200], 0


class Sender(threading.Thread):
    """Поток доставки. Падения не выбивают сервер: каждая итерация в try."""

    def __init__(self, store, token, interval=15, sender=None):
        super().__init__(daemon=True, name='notify')
        self.store = store
        self.token = token
        self.interval = interval
        self.sender = sender or send_message
        self.stop = threading.Event()
        self._last_daily = 0
        self.sent = 0

    def run(self):
        while not self.stop.is_set():
            try:
                self.tick()
            except Exception as e:  # noqa: BLE001
                print('   уведомления: ошибка итерации:', e, flush=True)
            self.stop.wait(self.interval)

    def tick(self, now=None):
        now_dt = now or datetime.now(timezone.utc)
        ts = now_dt.timestamp()
        if ts - self._last_daily > 600:
            self._last_daily = ts
            auto_complete(self.store, now_dt)
            daily_digests(self.store, now_dt)
        for n in self.store.due_notifications(ts):
            late = ts - n['due_at']
            if n['kind'] in ('rem24', 'rem2') and late > LATE_LIMIT_MIN * 60:
                self.store.cancel_notifications(n['ref'], kinds=[n['kind']])
                continue
            ok, err, retry = self.sender(self.token, n['tg_id'], n['text'], n['buttons'])
            if ok:
                self.store.mark_sent(n['id'], True)
                self.sent += 1
            elif err and 'HTTP 403' in err:
                # бот заблокирован: отправлять некуда, но и мучить очередь незачем
                self.store.mark_sent(n['id'], True, error=err)
            else:
                self.store.mark_sent(n['id'], False, error=err)
                if retry:
                    time.sleep(min(retry, 30))
