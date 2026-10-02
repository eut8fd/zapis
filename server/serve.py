"""
Сервер Zapis: статика Mini App плюс API, на котором живут приложение и бот.

Без зависимостей — только стандартная библиотека Python 3.

Что здесь есть:
  * статика `webapp/` (как раньше);
  * `/api/v2/boot`     — вход по Telegram initData, выдача состояния по роли;
  * `/api/v2/push`     — изменения из приложения: проверка прав, слотов, запись;
  * `/api/v2/changes`  — что поменялось с момента N (другие устройства, бот);
  * `/api/v2/invites`  — приглашение в команду с любого устройства;
  * `/api/v2/internal` — для бота: справочник, слоты, запись в чате, отмена;
  * `/api/v2/admin`    — состояние сервера и очередь уведомлений.

Данные — в SQLite (`server/db.py`), права — в `server/access.py`,
уведомления в Telegram шлёт поток из `server/notify.py`.
"""
import hmac
import http.server
import json
import os
import socketserver
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import access  # noqa: E402
import auth  # noqa: E402
import config  # noqa: E402
import db  # noqa: E402
import notify  # noqa: E402
import slots  # noqa: E402

def port_from_args():
    """Порт — первым аргументом или из PORT. Тестовый раннер передаёт свои
    аргументы, поэтому не-числа молча пропускаем."""
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        return int(sys.argv[1])
    return int(os.environ.get('PORT') or 8080)


ROOT = os.path.abspath(os.path.join(HERE, '..', 'webapp'))
VERSION = '3.0'

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '': 'application/octet-stream',
}

MAX_BODY = 8 * 1024 * 1024          # одно сохранение приложения с фотографиями
MAX_ENTITY = 900 * 1024             # одна сущность (фото до 640px помещается с запасом)

STORE = None
SENDER = None
BOT_USERNAME = ''
ADDR_TODO = 'Укажите адрес в настройках'
PHONE_TODO = '+7 700 000 00 00'


class ApiError(Exception):
    def __init__(self, status, message, code='error'):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code


# ------------------------------------------------------------------ лимиты
class Limiter:
    """Скользящее окно в памяти: защита от зацикленного клиента, не от DDoS."""

    def __init__(self):
        self.hits = {}
        self.lock = threading.Lock()

    def check(self, key, limit, window):
        now = time.time()
        with self.lock:
            arr = [t for t in self.hits.get(key, []) if now - t < window]
            if len(arr) >= limit:
                self.hits[key] = arr
                return False
            arr.append(now)
            self.hits[key] = arr
            if len(self.hits) > 5000:
                self.hits = {k: v for k, v in self.hits.items() if v and now - v[-1] < window}
            return True


LIMITER = Limiter()


# ------------------------------------------------------------------ помощники
def company_ready(c, services, staff):
    """Готова ли страница записи — то же правило, что catalogReady в приложении."""
    if not c or c.get('status') == 'blocked':
        return False
    if not services or not staff:
        return False
    addr, phone = str(c.get('addr') or '').strip(), str(c.get('phone') or '').strip()
    return bool(addr) and addr != ADDR_TODO and bool(phone) and phone != PHONE_TODO


def company_missing(c, services, staff):
    out = []
    if not services:
        out.append('услуги')
    if not staff:
        out.append('мастера')
    addr, phone = str(c.get('addr') or '').strip(), str(c.get('phone') or '').strip()
    if not addr or addr == ADDR_TODO:
        out.append('адрес')
    if not phone or phone == PHONE_TODO:
        out.append('телефон')
    return out


def active_services(cid):
    return [s for s in STORE.bodies('services', cid) if s.get('active') is not False]


def active_staff(cid):
    return [e for e in STORE.bodies('employees', cid)
            if e.get('active') is not False and e.get('takesAppointments', True)]


def catalog_entry(c, full=False):
    cid = c['id']
    svcs = active_services(cid)
    staff = active_staff(cid)
    ready = company_ready(c, svcs, staff)
    out = {
        'id': cid, 'name': c.get('name', ''), 'short': c.get('short') or c.get('name', ''),
        'cat': c.get('cat', ''), 'city': c.get('city', ''), 'addr': c.get('addr', ''),
        'phone': c.get('phone', ''), 'about': c.get('about', ''), 'color': c.get('color'),
        'currency': c.get('currency') or '₸', 'rating': c.get('rating', 5.0),
        'reviewsCount': c.get('reviewsCount', 0), 'hours': c.get('hours') or {},
        'plan': c.get('plan'), 'planUntil': c.get('planUntil'), 'tz': c.get('tz') or config.TZ,
        'ready': ready, 'missing': [] if ready else company_missing(c, svcs, staff),
        'accepts': access.company_accepts(c),
        'services': [{'id': s['id'], 'name': s.get('name', ''), 'price': s.get('price', 0),
                      'duration': s.get('duration', 60), 'cat': s.get('cat', 'other'),
                      'employeeIds': s.get('employeeIds') or []} for s in svcs],
        'staff': [{'id': e['id'], 'name': e.get('name', ''), 'role': e.get('role', ''),
                   'serviceIds': e.get('serviceIds') or [], 'isOwner': bool(e.get('isOwner')),
                   'tgId': e.get('tgId') or ''} for e in staff],
    }
    return out


def booking_context(cid):
    c = STORE.body('companies', cid)
    if not c:
        raise ApiError(404, 'компания не найдена', 'not_found')
    return c, notify.company_tz(c), STORE.bodies('appointments', cid), STORE.bodies('blocks', cid)


def find_or_create_client(cid, tg_id, name, username, phone=''):
    """Карточка клиента по telegram-id; заводится при первой записи."""
    for cl in STORE.bodies('clients', cid):
        if str(cl.get('tgId') or '') == str(tg_id):
            changed = False
            if username and not cl.get('tg'):
                cl['tg'] = username
                changed = True
            if phone and not cl.get('phone'):
                cl['phone'] = phone
                changed = True
            if changed:
                STORE.put('clients', cl, by=str(tg_id))
            return cl
    rec = {
        'id': 'cl_%s_%s' % (cid, str(tg_id)[-6:]), 'companyId': cid, 'name': name or 'Гость',
        'phone': phone or '', 'tg': username or '', 'tgId': str(tg_id),
        'initials': access.initials(name), 'color': '#06AED4',
        'createdAt': access.now_iso(), 'note': '', 'ai': None, 'tags': [],
    }
    access.sanitize('clients', rec)
    STORE.put('clients', rec, by=str(tg_id))
    return rec


def appt_summary(a):
    """Запись с названиями — боту не нужно знать справочник."""
    v = notify.ApptView(STORE, a)
    return {
        'id': a['id'], 'companyId': a.get('companyId'), 'companyName': v.company.get('name', ''),
        'addr': v.company.get('addr', ''), 'service': v.title, 'employee': v.emp.get('name', ''),
        'employeeId': a.get('employeeId'), 'start': a.get('start'),
        'localStart': v.start.astimezone(v.tz).strftime('%Y-%m-%dT%H:%M') if v.start else '',
        'when': v.when, 'duration': a.get('duration'), 'price': a.get('price'),
        'currency': v.company.get('currency') or '₸', 'status': a.get('status'),
        'source': a.get('source'), 'clientName': v.client.get('name', ''),
        'clientTgId': v.client_tg, 'reminded': {
            n['kind']: bool(n['sent_at']) for n in STORE.notifications_for(ref=a['id'])
            if n['kind'] in ('rem24', 'rem2')},
    }


SECTIONS = {'book', 'my', 'profile', 'cal', 'clients', 'sub', 'ai', 'more', 'team'}


def start_company(raw):
    """
    Компания из start-параметра «<компания>[_<раздел>]». Идентификаторы
    компаний сами содержат подчёркивание (co_abc), поэтому режем только
    известный хвост раздела, а не первое подчёркивание.
    """
    raw = str(raw or '').strip().lower()
    i = raw.rfind('_')
    if i > 0 and raw[i + 1:] in SECTIONS:
        return raw[:i]
    return raw


# ------------------------------------------------------------------ состояние
def build_state(ctx):
    data = {col: [] for col in db.COLLECTIONS}
    for cid in ctx.visible_companies():
        scope = access.Scope(ctx, cid)
        if scope.role is None:
            continue
        for row in STORE.company_rows(cid):
            v = scope.view(row['col'], row['body'])
            if v is not None:
                data[row['col']].append(v)
    for row in STORE.company_rows(''):
        v = access.view_platform(ctx, row['col'], row['body'])
        if v is not None:
            data[row['col']].append(v)
    return data


def changes_since(ctx, since):
    rows = STORE.since(since, None if ctx.is_admin else ctx.visible_companies())
    scopes = {}
    out = []
    seen = set()
    for row in rows:
        col, cid = row['col'], row['companyId']
        key = (col, row['id'])
        if key in seen:
            continue
        seen.add(key)
        if row['deleted']:
            out.append({'col': col, 'id': row['id'], 'deleted': True})
            continue
        if cid == '':
            v = access.view_platform(ctx, col, row['body'])
        else:
            scope = scopes.get(cid)
            if scope is None:
                scope = scopes[cid] = access.Scope(ctx, cid)
            v = scope.view(col, row['body']) if scope.role else None
            # мастеру вместе с его записью нужна карточка клиента, которой
            # у него могло ещё не быть
            if v is not None and col == 'appointments' and scope.role == 'staff' \
                    and row['body'].get('employeeId') == scope.emp_id and row['body'].get('clientId'):
                cl = STORE.body('clients', row['body']['clientId'])
                if cl and ('clients', cl['id']) not in seen:
                    seen.add(('clients', cl['id']))
                    out.append({'col': 'clients', 'id': cl['id'], 'body': cl})
        if v is None:
            out.append({'col': col, 'id': row['id'], 'deleted': True})
        else:
            out.append({'col': col, 'id': row['id'], 'body': v})
    return out


def session_payload(ctx, data=None):
    user = STORE.user(ctx.tg_id) or {}
    members = []
    for cid, e in ctx.memberships.items():
        c = STORE.body('companies', cid) or {}
        members.append({
            'companyId': cid, 'employeeId': e.get('id'), 'access': e.get('access') or 'staff',
            'isOwner': bool(e.get('isOwner')), 'companyName': c.get('name', ''),
        })
    members.sort(key=lambda m: (not m['isOwner'], m['companyName']))
    out = {
        'identity': ctx.identity.as_dict(),
        'memberships': members,
        'clientCards': {cid: c.get('id') for cid, c in ctx.client_cards.items()},
        'home': user.get('home') or '',
        'bound': sorted(ctx.bound),
        'lastCompany': user.get('last_company') or '',
        'phone': user.get('phone') or '',
        'seq': STORE.seq(),
        'server': {
            'version': VERSION, 'botUsername': BOT_USERNAME, 'dev': ctx.identity.dev,
            'paymentNote': config.PAYMENT_NOTE, 'support': config.SUPPORT_USERNAME,
            'ai': bool(config.AI_PROVIDER_KEY), 'tz': config.TZ, 'brand': config.BRAND,
            'webappUrl': config.WEBAPP_URL,
        },
    }
    if data is not None:
        out['data'] = data
    return out


# ------------------------------------------------------------------ push
ID_OK = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-')


def valid_id(s):
    return isinstance(s, str) and 1 <= len(s) <= 80 and all(ch in ID_OK for ch in s)


def apply_push(ctx, payload):
    upsert = payload.get('upsert') or {}
    deletes = payload.get('delete') or {}
    if not isinstance(upsert, dict) or not isinstance(deletes, dict):
        raise ApiError(400, 'ожидаются upsert и delete')
    rejected, applied, effects = [], 0, []
    new_companies = {}
    plans = STORE.bodies('plans')

    def reject(col, body, why, existing, scope=None):
        # Серверную версию возвращаем только в том виде, в каком её вправе
        # видеть эта роль: иначе отказ «это чужая запись» отдавал бы чужую
        # запись целиком — с именем, телефоном и ценой.
        safe = None
        if existing is not None:
            if ctx.is_admin:
                safe = existing
            elif scope is not None and scope.role:
                safe = scope.view(col, existing)
        rejected.append({'col': col, 'id': body.get('id'), 'reason': why, 'server': safe})

    with STORE.transaction():
        scopes = {}

        def scope_for(cid):
            s = scopes.get(cid)
            if s is None:
                s = scopes[cid] = access.Scope(ctx, cid)
            return s

        for col in db.COLLECTIONS:
            items = upsert.get(col) or []
            if not isinstance(items, list):
                continue
            if col in ('logs', 'errors'):
                items = items[:access.MAX_LOGS_PER_PUSH]
            for body in items:
                if not isinstance(body, dict) or not valid_id(body.get('id')):
                    rejected.append({'col': col, 'id': (body or {}).get('id') if isinstance(body, dict) else None,
                                     'reason': 'некорректная сущность', 'server': None})
                    continue
                if len(json.dumps(body, ensure_ascii=False)) > MAX_ENTITY:
                    reject(col, body, 'слишком большая запись — уменьшите фото', None)
                    continue
                cid = db.company_of(col, body)
                existing = STORE.body(col, body['id'])
                if existing is not None and col != 'companies' and db.company_of(col, existing) != cid:
                    # чужая компания: ничего о ней не рассказываем
                    reject(col, body, 'сущность другой компании', None)
                    continue
                if col != 'companies' and col not in db.PLATFORM and not cid and col not in db.OPTIONAL_COMPANY:
                    reject(col, body, 'нет компании', None)
                    continue

                # --- новая компания: создаёт любой, владельцем становится сам
                if col == 'companies' and existing is None:
                    if not str(body.get('name') or '').strip():
                        reject(col, body, 'у компании нет названия', None)
                        continue
                    if not ctx.is_admin and not LIMITER.check('newco:' + ctx.tg_id, 3, 86400):
                        reject(col, body, 'слишком много компаний за день', None)
                        continue
                    access.normalize_new_company(body, plans, config.TRIAL_DAYS, config.TZ)
                    STORE.put(col, body, by=ctx.tg_id)
                    new_companies[cid] = body
                    applied += 1
                    continue

                # --- карточка владельца новой компании идёт в том же сохранении
                if col == 'employees' and cid in new_companies and body.get('isOwner') \
                        and 'owner' not in new_companies[cid].get('_owned', ''):
                    body['tgId'] = ctx.tg_id
                    body['tg'] = body.get('tg') or ctx.identity.username
                    body['access'] = 'owner'
                    body['active'] = True
                    body['linkedAt'] = access.now_iso()
                    if not str(body.get('name') or '').strip() or body.get('name') == 'Вы':
                        body['name'] = ctx.identity.name
                        body['initials'] = access.initials(ctx.identity.name)
                    access.sanitize(col, body)
                    STORE.put(col, body, by=ctx.tg_id)
                    new_companies[cid]['_owned'] = 'owner'
                    ctx.reload()
                    scopes.pop(cid, None)
                    applied += 1
                    continue

                company = STORE.body('companies', cid) if cid else None
                if cid and col != 'companies' and company is None and col not in db.OPTIONAL_COMPANY:
                    reject(col, body, 'компания не найдена', None)
                    continue
                scope = scope_for(cid) if cid else None
                tz = notify.company_tz(company)
                try:
                    access.check_write(ctx, col, body, existing, scope, STORE, tz, company)
                except access.Denied as e:
                    reject(col, body, str(e), existing, scope)
                    continue
                STORE.put(col, body, by=ctx.tg_id)
                applied += 1
                effects.append((col, existing, body, scope.role if scope else ('admin' if ctx.is_admin else None)))
                # Своя карточка клиента или сотрудника меняет роль прямо
                # в этом сохранении: запись, идущая следом, должна её видеть.
                if col in ('clients', 'employees') and str(body.get('tgId') or '') == ctx.tg_id:
                    ctx.reload()
                    scopes.pop(cid, None)

        # владелец без карточки в этом же сохранении — заводим сами
        for cid, body in new_companies.items():
            body.pop('_owned', None)
            has_owner = any(e.get('isOwner') and str(e.get('tgId') or '') == ctx.tg_id
                            for e in STORE.bodies('employees', cid))
            if not has_owner:
                STORE.put('employees', access.owner_employee(body, ctx.identity), by=ctx.tg_id)
            ctx.reload()
            scopes.pop(cid, None)
            STORE.touch_user(ctx.tg_id, last_company=cid)
            notify.on_company_created(STORE, body, ctx.identity)

        for col, ids in deletes.items():
            if col not in db.COLLECTIONS or not isinstance(ids, list):
                continue
            for eid in ids:
                if not valid_id(eid):
                    continue
                existing = STORE.body(col, eid)
                if existing is None:
                    continue
                cid = db.company_of(col, existing)
                scope = scope_for(cid) if cid else None
                try:
                    access.check_delete(ctx, col, existing, scope)
                except access.Denied as e:
                    reject(col, {'id': eid}, str(e), existing, scope)
                    continue
                STORE.delete(col, eid, by=ctx.tg_id)
                applied += 1

    # побочные эффекты: уведомления, карточка человека
    for col, old, new, role in effects:
        try:
            if col == 'appointments':
                notify.on_appointment(STORE, old, new, role)
            elif col == 'tickets' and old is None:
                notify.on_ticket(STORE, new, ctx.identity)
            elif col == 'companies' and old is not None and ctx.is_admin and (
                    old.get('planUntil') != new.get('planUntil') or old.get('plan') != new.get('plan')):
                notify.on_plan_changed(STORE, old, new)
            elif col == 'clients' and role == 'client':
                STORE.touch_user(ctx.tg_id, name=new.get('name'), phone=new.get('phone'))
            elif col == 'employees' and str(new.get('tgId') or '') == ctx.tg_id:
                STORE.touch_user(ctx.tg_id, name=new.get('name'), phone=new.get('phone'))
        except Exception as e:  # noqa: BLE001 — уведомление не должно откатывать сохранение
            print('   push: побочный эффект не удался:', col, e, flush=True)
    return applied, rejected


# ------------------------------------------------------------------ приглашения
def invite_state(inv, now=None):
    if not inv:
        return 'нет'
    if inv.get('revokedAt'):
        return 'отозвана'
    if inv.get('usedAt'):
        return 'использована'
    exp = slots.parse_iso(inv.get('expiresAt'))
    if exp and exp < (now or datetime.now(timezone.utc)):
        return 'истекла'
    return 'активна'


def accept_invite(ctx, inv_id, person):
    with STORE.transaction():
        inv = STORE.body('invites', inv_id)
        state = invite_state(inv)
        c = STORE.body('companies', inv.get('companyId')) if inv else None
        if state != 'активна' or not c:
            return {'ok': False, 'why': state if inv else 'нет', 'state': state}
        cid = c['id']
        # уже в команде — ничего не плодим
        mine = ctx.memberships.get(cid)
        if mine:
            return {'ok': True, 'already': True, 'employee': mine, 'company': access.pick(c, access.COMPANY_PUBLIC)}
        name = str(person.get('name') or ctx.identity.name).strip()[:80] or ctx.identity.name
        phone = str(person.get('phone') or '').strip()[:32]
        e = None
        if inv.get('employeeId'):
            ex = STORE.body('employees', inv['employeeId'])
            if ex and ex.get('companyId') == cid and ex.get('active') is not False and not ex.get('linkedAt'):
                e = ex
                if phone:
                    e['phone'] = phone
        if e is None:
            svcs = active_services(cid)
            e = {
                'id': 'e_%s_%s' % (cid, ctx.tg_id[-6:]), 'companyId': cid, 'name': name,
                'role': inv.get('role') or 'Мастер', 'phone': phone, 'active': True,
                'takesAppointments': True, 'initials': access.initials(name), 'color': '#8B5CF6',
                'schedule': json.loads(json.dumps(c.get('hours') or {})),
                'serviceIds': [s['id'] for s in svcs], 'rating': '5.0', 'photo': None,
                'since': None, 'showExp': True, 'createdAt': access.now_iso(),
            }
            for s in svcs:
                ids = s.get('employeeIds') or []
                if e['id'] not in ids:
                    s['employeeIds'] = ids + [e['id']]
                    STORE.put('services', s, by=ctx.tg_id)
        e['access'] = inv.get('access') if inv.get('access') in ('staff', 'manager') else 'staff'
        e['isOwner'] = False
        e['tg'] = ctx.identity.username
        e['tgId'] = ctx.tg_id
        e['linkedAt'] = access.now_iso()
        access.sanitize('employees', e)
        STORE.put('employees', e, by=ctx.tg_id)
        inv['usedAt'] = access.now_iso()
        inv['usedBy'] = e['id']
        STORE.put('invites', inv, by=ctx.tg_id)
        STORE.put('logs', {
            'id': 'lg_inv_%s' % inv_id, 'kind': 'team', 'text': 'Сотрудник вошёл по приглашению',
            'level': 'info', 'companyId': cid, 'actor': name, 'meta': None, 'at': access.now_iso(),
        }, by=ctx.tg_id)
        STORE.touch_user(ctx.tg_id, name=name, phone=phone, last_company=cid)
        ctx.reload()
    notify.on_invite_accepted(STORE, e, c)
    return {'ok': True, 'employee': e, 'company': access.pick(c, access.COMPANY_PUBLIC)}


# ------------------------------------------------------------------ рассылки
def company_broadcast(ctx, payload):
    cid = str(payload.get('companyId') or '')
    scope = access.Scope(ctx, cid)
    if not access.can('admin' if ctx.is_admin else scope.role, 'clients'):
        raise ApiError(403, 'рассылки доступны владельцу и администратору', 'forbidden')
    c = STORE.body('companies', cid)
    if not c:
        raise ApiError(404, 'компания не найдена', 'not_found')
    text = str(payload.get('text') or '').strip()[:2000]
    title = str(payload.get('title') or '').strip()[:120]
    if not text:
        raise ApiError(400, 'пустой текст')
    ids = set(payload.get('clientIds') or [])
    only_me = bool(payload.get('test'))
    if not LIMITER.check('bc:' + cid, 20, 86400):
        raise ApiError(429, 'слишком много рассылок за день', 'rate')
    targets = []
    if only_me:
        targets = [ctx.tg_id]
    else:
        for cl in STORE.bodies('clients', cid):
            if cl.get('tgId') and (not ids or cl['id'] in ids):
                targets.append(str(cl['tgId']))
    targets = list(dict.fromkeys(targets))[:2000]
    body = '<b>%s</b>\n\n%s' % (notify.esc(title or c.get('name', '')), notify.esc(text))
    if title:
        body += '\n\n— %s' % notify.esc(c.get('name', ''))
    bid = str(payload.get('id') or 'bc_%d' % int(time.time() * 1000))
    kb = notify.buttons([notify.app_button('Записаться', '%s_book' % cid)])
    for tg in targets:
        STORE.schedule('bc:%s:%s' % (bid, tg), tg, 'broadcast', body, time.time(), ref=bid,
                       company_id=cid, buttons=kb)
    return {'ok': True, 'to': len(targets), 'id': bid}


def platform_broadcast(ctx, payload):
    if not ctx.is_admin:
        raise ApiError(403, 'только для администратора платформы', 'forbidden')
    text = str(payload.get('text') or '').strip()[:3000]
    title = str(payload.get('title') or '').strip()[:120]
    segment = str(payload.get('segment') or 'all')
    if not text:
        raise ApiError(400, 'пустой текст')
    now = datetime.now(timezone.utc)
    targets = []
    for c in STORE.all_companies():
        until = slots.parse_iso(c.get('planUntil'))
        active = c.get('status') != 'blocked' and (until is None or until > now)
        if segment == 'active' and not active:
            continue
        if segment == 'inactive' and active:
            continue
        if segment.startswith('plan:') and c.get('plan') != segment[5:]:
            continue
        for e in STORE.bodies('employees', c['id']):
            if e.get('isOwner') and e.get('tgId'):
                targets.append(str(e['tgId']))
    targets = list(dict.fromkeys(targets))
    body = '<b>%s</b>\n\n%s' % (notify.esc(title or config.BRAND), notify.esc(text))
    bid = str(payload.get('id') or 'sb_%d' % int(time.time() * 1000))
    for tg in targets:
        STORE.schedule('sb:%s:%s' % (bid, tg), tg, 'platform', body, time.time(), ref=bid)
    return {'ok': True, 'to': len(targets), 'id': bid}


# ------------------------------------------------------------------ AI через сервер
def ai_proxy(ctx, payload):
    if not config.AI_PROVIDER_KEY:
        raise ApiError(404, 'AI на сервере не настроен', 'ai_off')
    if not LIMITER.check('ai:' + ctx.tg_id, 40, 3600):
        raise ApiError(429, 'слишком много запросов к AI, попробуйте позже', 'rate')
    prompt = str(payload.get('prompt') or '')[:12000]
    system = str(payload.get('system') or 'Ты — AI-ассистент салона. Отвечай коротко и по делу, на русском.')[:4000]
    if not prompt.strip():
        raise ApiError(400, 'пустой запрос')
    # Прямой HTTP к Messages API: у проекта нет зависимостей, SDK ставить нельзя.
    # Тексты для салона короткие, поэтому effort low: быстрее и дешевле.
    # fallbacks="default" — если классификатор отклонит запрос, API сам
    # повторит его на другой модели внутри того же вызова.
    payload = {
        'model': config.AI_MODEL, 'max_tokens': 2000, 'system': system,
        'output_config': {'effort': 'low'},
        'fallbacks': 'default',
        'messages': [{'role': 'user', 'content': prompt}],
    }
    req = urllib.request.Request(config.AI_PROVIDER_URL, data=json.dumps(payload).encode('utf-8'), headers={
        'content-type': 'application/json', 'x-api-key': config.AI_PROVIDER_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            j = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise ApiError(502, 'AI ответил ошибкой %s' % e.code, 'ai_error')
    except Exception as e:  # noqa: BLE001
        raise ApiError(502, 'AI недоступен: %s' % str(e)[:100], 'ai_error')
    if j.get('stop_reason') == 'refusal':
        raise ApiError(422, 'AI отказался отвечать на этот запрос', 'ai_refusal')
    text = '\n'.join(c.get('text', '') for c in (j.get('content') or []) if c.get('type') == 'text')
    return {'ok': True, 'text': text, 'model': j.get('model')}


# ------------------------------------------------------------------ обработчик
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = MIME
    # HTTP/1.1: при 1.0 браузер шлёт следующий запрос в закрытое соединение
    protocol_version = 'HTTP/1.1'

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # ---------------------------------------------------------- служебное
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers',
                         'Content-Type, X-Telegram-Init-Data, X-Dev-User, X-Internal-Token')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, fmt, *args):
        line = fmt % args
        if os.environ.get('ZAPIS_QUIET'):
            return
        if '"GET' in line and (' 200 ' in line or ' 304 ' in line):
            return
        sys.stderr.write('%s\n' % line)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message, code='error'):
        self._json({'error': {'code': code, 'message': message}}, status)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            # тело всё равно надо прочитать, иначе keep-alive сломается
            self.rfile.read(n)
            raise ApiError(413, 'слишком большой запрос', 'too_large')
        if not n:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, 'тело запроса не JSON', 'bad_json')

    def _identity(self):
        init = self.headers.get('X-Telegram-Init-Data')
        if init:
            try:
                user = auth.verify_init_data(init, config.BOT_TOKEN, config.AUTH_MAX_AGE)
            except auth.AuthError as e:
                raise ApiError(401, str(e), 'auth')
            return auth.Identity(user, config.ADMIN_TG_IDS)
        dev = self.headers.get('X-Dev-User')
        if dev and config.DEV_AUTH:
            try:
                return auth.Identity(auth.parse_dev_user(dev), config.ADMIN_TG_IDS, dev=True)
            except auth.AuthError as e:
                raise ApiError(401, str(e), 'auth')
        raise ApiError(401, 'откройте приложение из Telegram', 'auth')

    def _ctx(self):
        ident = self._identity()
        if not LIMITER.check('req:' + ident.tg_id, 600, 60):
            raise ApiError(429, 'слишком много запросов', 'rate')
        return access.Ctx(STORE, ident, config.ADMIN_TG_IDS)

    def _internal(self):
        tok = self.headers.get('X-Internal-Token') or ''
        if not tok or not hmac.compare_digest(tok, config.internal_token()):
            raise ApiError(403, 'внутренний маршрут', 'forbidden')

    # ---------------------------------------------------------- маршруты
    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if self.path.startswith('/api/'):
            return self._api('GET')
        if self.path in ('/health', '/healthz'):
            return self._json({'ok': True, 'version': VERSION})
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        return self._api('POST')

    def do_PUT(self):  # noqa: N802
        self._body()
        return self._error(410, 'старый API отключён, обновите приложение', 'gone')

    def do_PATCH(self):  # noqa: N802
        self._body()
        return self._error(410, 'старый API отключён, обновите приложение', 'gone')

    def _api(self, method):
        u = urllib.parse.urlsplit(self.path)
        path = u.path
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            body = self._body() if method == 'POST' else {}
            if not path.startswith('/api/v2/'):
                return self._error(410, 'старый API отключён, обновите приложение', 'gone')
            route = path[len('/api/v2/'):].strip('/')
            parts = route.split('/')
            out = self._dispatch(method, parts, q, body)
            if out is None:
                return self._error(404, 'нет такого маршрута', 'not_found')
            return self._json(out)
        except ApiError as e:
            return self._error(e.status, e.message, e.code)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self._error(500, 'внутренняя ошибка: %s' % str(e)[:120], 'internal')

    def _dispatch(self, method, parts, q, body):
        head = parts[0] if parts else ''
        if head == 'ping':
            return {'ok': True, 'version': VERSION, 'dev': config.DEV_AUTH, 'bot': BOT_USERNAME,
                    'auth': bool(config.BOT_TOKEN) or config.DEV_AUTH}
        if head == 'internal':
            self._internal()
            return self._internal_route(method, parts[1:], q, body)
        if head == 'boot' and method == 'POST':
            return self._boot(body)
        if head == 'changes' and method == 'GET':
            ctx = self._ctx()
            since = int(q.get('since') or 0)
            return {'ok': True, 'seq': STORE.seq(), 'changes': changes_since(ctx, since)}
        if head == 'push' and method == 'POST':
            ctx = self._ctx()
            if not LIMITER.check('push:' + ctx.tg_id, 120, 60):
                raise ApiError(429, 'слишком частые сохранения', 'rate')
            since = int(body.get('since') or 0)
            applied, rejected = apply_push(ctx, body)
            return {'ok': True, 'seq': STORE.seq(), 'applied': applied, 'rejected': rejected,
                    'changes': changes_since(ctx, since)}
        if head == 'invites' and len(parts) >= 2:
            ctx = self._ctx()
            inv_id = parts[1]
            if len(parts) == 2 and method == 'GET':
                inv = STORE.body('invites', inv_id)
                if not inv:
                    return {'ok': False, 'state': 'нет'}
                c = STORE.body('companies', inv.get('companyId')) or {}
                safe = {k: v for k, v in inv.items() if k not in ('createdBy',)}
                return {'ok': True, 'invite': safe, 'state': invite_state(inv),
                        'company': access.pick(c, access.COMPANY_PUBLIC)}
            if len(parts) == 3 and parts[2] == 'accept' and method == 'POST':
                res = accept_invite(ctx, inv_id, body)
                if res.get('ok'):
                    res['session'] = session_payload(ctx, build_state(ctx))
                return res
            return None
        if head == 'broadcast' and method == 'POST':
            return company_broadcast(self._ctx(), body)
        if head == 'ai' and method == 'POST':
            return ai_proxy(self._ctx(), body)
        if head == 'notify-test' and method == 'POST':
            # тестовое сообщение себе: проверить, что бот и адрес настроены
            ctx = self._ctx()
            if not LIMITER.check('ntest:' + ctx.tg_id, 3, 600):
                raise ApiError(429, 'тестовое сообщение уже отправлено — проверьте чат с ботом', 'rate')
            STORE.schedule('test:%s:%d' % (ctx.tg_id, int(time.time())), ctx.tg_id, 'test',
                           '🔔 <b>Уведомления работают</b>\n\nТак будут приходить напоминания о записях.',
                           time.time(), buttons=notify.buttons([notify.app_button('Открыть приложение')]))
            return {'ok': True, 'bot': BOT_USERNAME}
        if head == 'admin':
            ctx = self._ctx()
            if not ctx.is_admin:
                raise ApiError(403, 'только для администратора платформы', 'forbidden')
            return self._admin_route(method, ctx, parts[1:], q, body)
        return None

    def _boot(self, body):
        ctx = self._ctx()
        sp = start_company(str(body.get('start') or ''))
        bind = None
        if sp and STORE.body('companies', sp):
            bind = sp
        u = STORE.user(ctx.tg_id)
        STORE.touch_user(ctx.tg_id, name=ctx.identity.name, username=ctx.identity.username,
                         lang=ctx.identity.lang, bind=bind,
                         home=bind if bind and not (u or {}).get('home') else None)
        ctx.reload()
        return dict(session_payload(ctx, build_state(ctx)), ok=True)

    # ---------------------------------------------------------- admin
    def _admin_route(self, method, ctx, parts, q, body):
        head = parts[0] if parts else ''
        if head == 'stats':
            st = STORE.stats()
            st['sent'] = SENDER.sent if SENDER else 0
            st['uptime'] = int(time.time() - STARTED)
            st['bot'] = BOT_USERNAME
            st['botToken'] = bool(config.BOT_TOKEN)
            st['webappUrl'] = config.WEBAPP_URL
            return {'ok': True, 'stats': st}
        if head == 'queue':
            return {'ok': True, 'queue': STORE.notifications_for(company_id=q.get('company') or None, limit=200)}
        if head == 'users':
            return {'ok': True, 'users': STORE.users()}
        if head == 'broadcast' and method == 'POST':
            return platform_broadcast(ctx, body)
        if head == 'seed' and method == 'POST':
            data = body.get('data') or {}
            n = 0
            with STORE.transaction():
                for col in db.COLLECTIONS:
                    for e in data.get(col) or []:
                        if isinstance(e, dict) and valid_id(e.get('id')):
                            STORE.put(col, e, by='seed')
                            n += 1
            return {'ok': True, 'applied': n}
        if head == 'notify' and method == 'POST':
            # тестовое сообщение себе — проверить, что токен и адрес на месте
            STORE.schedule('test:%s:%d' % (ctx.tg_id, int(time.time())), ctx.tg_id, 'test',
                           '✅ <b>Уведомления работают</b>\n\nЭто тестовое сообщение из панели.',
                           time.time(), buttons=notify.buttons([notify.app_button('Открыть приложение')]))
            return {'ok': True}
        return None

    # ---------------------------------------------------------- внутренний API бота
    def _internal_route(self, method, parts, q, body):
        head = parts[0] if parts else ''
        if head == 'health':
            return {'ok': True, 'seq': STORE.seq(), 'version': VERSION}
        if head == 'catalog':
            out = []
            for c in STORE.all_companies():
                e = catalog_entry(c)
                if e['ready'] or q.get('all'):
                    out.append(e)
            return {'ok': True, 'companies': out, 'seq': STORE.seq()}
        if head == 'company' and len(parts) == 2:
            c = STORE.body('companies', parts[1])
            if not c:
                raise ApiError(404, 'компания не найдена', 'not_found')
            return {'ok': True, 'company': catalog_entry(c)}
        if head == 'slots':
            return self._internal_slots(q)
        if head == 'days':
            return self._internal_days(q)
        if head == 'book' and method == 'POST':
            return self._internal_book(body)
        if head == 'my':
            tg = str(q.get('tgId') or '')
            if not tg:
                raise ApiError(400, 'нужен tgId')
            out = []
            for cl in STORE.bodies('clients'):
                if str(cl.get('tgId') or '') != tg:
                    continue
                for a in STORE.bodies('appointments', cl['companyId']):
                    if a.get('clientId') == cl['id']:
                        out.append(appt_summary(a))
            out.sort(key=lambda a: a['start'] or '')
            return {'ok': True, 'appointments': out}
        if head == 'cancel' and method == 'POST':
            tg = str(body.get('tgId') or '')
            a = STORE.body('appointments', str(body.get('id') or ''))
            if not a:
                raise ApiError(404, 'запись не найдена', 'not_found')
            cl = STORE.body('clients', a.get('clientId'))
            if not cl or str(cl.get('tgId') or '') != tg:
                raise ApiError(403, 'это чужая запись', 'forbidden')
            if a.get('status') != 'planned':
                raise ApiError(409, 'эту запись уже нельзя отменить', 'conflict')
            old = dict(a)
            a['status'] = 'cancelled'
            a['cancelledBy'] = 'client'
            a['cancelledAt'] = access.now_iso()
            STORE.put('appointments', a, by=tg)
            notify.on_appointment(STORE, old, a, 'client')
            return {'ok': True, 'appointment': appt_summary(a)}
        if head == 'user' and method == 'POST':
            tg = str(body.get('tgId') or '')
            if not tg:
                raise ApiError(400, 'нужен tgId')
            bind = body.get('company') if STORE.body('companies', str(body.get('company') or '')) else None
            u = STORE.user(tg)
            STORE.touch_user(tg, name=body.get('name'), username=body.get('username'), lang=body.get('lang'),
                             bind=bind, home=bind if bind and not (u or {}).get('home') else None)
            return {'ok': True, 'user': self._user_info(tg)}
        if head == 'user' and method == 'GET':
            tg = str(q.get('tgId') or '')
            return {'ok': True, 'user': self._user_info(tg)}
        if head == 'queue':
            cid = q.get('companyId') or None
            rows = STORE.notifications_for(company_id=cid, limit=100)
            return {'ok': True, 'queue': rows}
        if head == 'stats':
            return {'ok': True, 'stats': STORE.stats()}
        return None

    def _user_info(self, tg):
        u = STORE.user(tg) or {}
        ident = auth.Identity({'id': int(tg) if tg.isdigit() else 0, 'first_name': u.get('name') or ''},
                              config.ADMIN_TG_IDS)
        ctx = access.Ctx(STORE, ident, config.ADMIN_TG_IDS)
        members = []
        for cid, e in ctx.memberships.items():
            c = STORE.body('companies', cid) or {}
            members.append({'companyId': cid, 'name': c.get('name', ''), 'isOwner': bool(e.get('isOwner')),
                            'access': e.get('access') or 'staff', 'plan': c.get('plan')})
        return {
            'tgId': tg, 'name': u.get('name') or '', 'username': u.get('username') or '',
            'home': u.get('home') or '', 'bound': u.get('bound') or [], 'lastCompany': u.get('last_company') or '',
            'memberships': members, 'clientCompanies': sorted(ctx.client_cards), 'isAdmin': ident.is_admin,
        }

    def _internal_slots(self, q):
        cid = q.get('companyId') or ''
        c, tz, appts, blocks = booking_context(cid)
        svc = STORE.body('services', q.get('serviceId') or '')
        if not svc or svc.get('companyId') != cid:
            raise ApiError(404, 'услуга не найдена', 'not_found')
        d = slots.date_from_str(q.get('date'))
        if not d:
            raise ApiError(400, 'нужна дата YYYY-MM-DD')
        emps = self._emps_for(cid, svc, q.get('employeeId'))
        out = slots.slots_for(emps, c, d, int(svc.get('duration') or 60), tz, appts, blocks)
        return {'ok': True, 'date': d.isoformat(),
                'slots': [{'min': s['min'], 't': s['t'], 'empId': s['empId']} for s in out if s['free']]}

    def _emps_for(self, cid, svc, emp_id):
        staff = active_staff(cid)
        if emp_id:
            return [e for e in staff if e['id'] == emp_id]
        ids = set(svc.get('employeeIds') or [])
        return [e for e in staff if e['id'] in ids] or staff

    def _internal_days(self, q):
        cid = q.get('companyId') or ''
        c, tz, appts, blocks = booking_context(cid)
        svc = STORE.body('services', q.get('serviceId') or '')
        if not svc or svc.get('companyId') != cid:
            raise ApiError(404, 'услуга не найдена', 'not_found')
        base = slots.date_from_str(q.get('from')) or datetime.now(tz).date()
        n = max(1, min(31, int(q.get('n') or 7)))
        emps = self._emps_for(cid, svc, q.get('employeeId'))
        out = []
        for i in range(n):
            d = base + timedelta(days=i)
            free = [s for s in slots.slots_for(emps, c, d, int(svc.get('duration') or 60), tz, appts, blocks)
                    if s['free']]
            out.append({'date': d.isoformat(), 'free': len(free), 'first': free[0]['t'] if free else None})
        return {'ok': True, 'days': out}

    def _internal_book(self, body):
        cid = str(body.get('companyId') or '')
        c, tz, appts, blocks = booking_context(cid)
        if not access.company_accepts(c):
            raise ApiError(409, 'салон сейчас не принимает онлайн-записи', 'closed')
        svc = STORE.body('services', str(body.get('serviceId') or ''))
        if not svc or svc.get('companyId') != cid or svc.get('active') is False:
            raise ApiError(404, 'услуга не найдена', 'not_found')
        d = slots.date_from_str(body.get('date'))
        try:
            minute = int(body.get('min'))
        except (TypeError, ValueError):
            raise ApiError(400, 'нужны date и min')
        if not d:
            raise ApiError(400, 'нужны date и min')
        tg = str(body.get('tgId') or '')
        if not tg:
            raise ApiError(400, 'нужен tgId')
        emps = self._emps_for(cid, svc, body.get('employeeId'))
        dur = int(svc.get('duration') or 60)
        who = None
        for e in emps:
            if slots.slot_free(e, c, d, minute, dur, tz, appts, blocks):
                who = e
                break
        if not who:
            raise ApiError(409, 'это время уже заняли', 'conflict')
        with STORE.transaction():
            cl = find_or_create_client(cid, tg, body.get('name') or 'Гость', body.get('username') or '',
                                       body.get('phone') or '')
            a = {
                'id': 'ap_%s_%s' % (hex(int(time.time() * 1000))[2:], tg[-4:]), 'companyId': cid,
                'clientId': cl['id'], 'employeeId': who['id'], 'serviceIds': [svc['id']],
                'start': slots.to_iso(slots.at_minutes(d, minute, tz)), 'duration': dur,
                'price': int(svc.get('price') or 0), 'status': 'planned', 'note': '',
                'source': 'bot', 'createdAt': access.now_iso(),
            }
            # повторная проверка под замком: между выдачей слотов и записью могли успеть
            why = slots.appointment_conflict(a, STORE.bodies('appointments', cid), STORE.bodies('blocks', cid),
                                             who, c, tz)
            if why:
                raise ApiError(409, why, 'conflict')
            STORE.put('appointments', a, by=tg)
        STORE.touch_user(tg, name=body.get('name'), username=body.get('username'), bind=cid)
        notify.on_appointment(STORE, None, a, 'bot')
        return {'ok': True, 'appointment': appt_summary(a)}


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


STARTED = time.time()


def bot_username():
    """Имя бота — для ссылок. Не критично: без сети просто пусто."""
    if not config.BOT_TOKEN:
        return ''
    try:
        with urllib.request.urlopen('https://api.telegram.org/bot%s/getMe' % config.BOT_TOKEN, timeout=8) as r:
            return json.loads(r.read().decode('utf-8')).get('result', {}).get('username', '') or ''
    except Exception:  # noqa: BLE001
        return ''


def init(db_path=None, start_sender=True):
    global STORE, SENDER, BOT_USERNAME
    STORE = db.Store(db_path or config.DB_PATH)
    if start_sender:
        SENDER = notify.Sender(STORE, config.BOT_TOKEN)
        SENDER.start()
    if not STORE.bodies('plans'):
        for p in DEFAULT_PLANS:
            STORE.put('plans', dict(p), by='server')
    # Токен для бота создаётся сразу: бот на той же машине читает его из файла
    config.internal_token()
    return STORE


DEFAULT_PLANS = [
    {'id': 'START', 'name': 'START', 'price': 9900, 'period': 'month', 'active': True, 'color': '#0EA5E9',
     'limits': {'staff': 1, 'services': 20, 'broadcasts': 2},
     'feats': ['1 сотрудник', 'Онлайн-запись', 'База клиентов', 'Напоминания']},
    {'id': 'PRO', 'name': 'PRO', 'price': 19900, 'period': 'month', 'active': True, 'color': '#4C6FFF',
     'limits': {'staff': 10, 'services': 100, 'broadcasts': 20},
     'feats': ['До 10 сотрудников', 'AI-помощник', 'Рассылки', 'Аналитика и финансы']},
    {'id': 'BUSINESS', 'name': 'BUSINESS', 'price': 39900, 'period': 'month', 'active': True, 'color': '#8B5CF6',
     'limits': {'staff': 0, 'services': 0, 'broadcasts': 0},
     'feats': ['Без ограничений', 'Несколько филиалов', 'API и интеграции', 'Приоритетная поддержка']},
]


def main():
    global BOT_USERNAME
    init()
    BOT_USERNAME = bot_username() or os.environ.get('BOT_USERNAME', '').lstrip('@')
    print('webapp root :', ROOT)
    print('база        :', STORE.path)
    print('бот         :', ('@' + BOT_USERNAME) if BOT_USERNAME else '(токен не задан — вход только DEV_AUTH)')
    print('вход без TG :', 'включён (DEV_AUTH=1)' if config.DEV_AUTH else 'выключен')
    print('адрес app   :', config.WEBAPP_URL or '(WEBAPP_URL пуст — кнопки в уведомлениях без ссылок)')
    print('админы      :', ', '.join(sorted(config.ADMIN_TG_IDS)) or 'не заданы (ADMIN_TG_IDS)')
    port = port_from_args()
    print('serving     : http://localhost:%d' % port)
    with Server(('0.0.0.0', port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')


if __name__ == '__main__':
    main()
