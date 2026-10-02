"""
Права: что человек видит и что может менять.

В демо права жили только в интерфейсе (`can()` в store.js). Сервер не может
полагаться на интерфейс — запрос приходит из чего угодно. Поэтому здесь
та же матрица ролей, что в приложении (PERMS/ROLES из store.js), но
применённая к данным: выдача фильтруется по роли, запись проверяется
по роли и по полям.

Роль в компании определяется по данным, а не по заявлению клиента:
  * сотрудник — есть карточка в `employees` с его telegram-id;
  * владелец — та же карточка с isOwner;
  * клиент — у него есть карточка в `clients` этой компании, либо он
    открывал её страницу (users.bound);
  * Super Admin — telegram-id в ADMIN_TG_IDS.
Один человек может быть владельцем одной компании и клиентом другой —
роль считается для каждой компании отдельно.
"""
import time
from datetime import datetime, timedelta, timezone

import slots

PERMS = (
    'ownCalendar', 'ownSchedule', 'allCalendar', 'createAppt', 'clients', 'services',
    'team', 'finance', 'analytics', 'reviews', 'settings', 'billing',
)
ROLES = {
    'staff': ('ownCalendar', 'ownSchedule', 'createAppt'),
    'manager': ('ownCalendar', 'ownSchedule', 'allCalendar', 'createAppt', 'clients', 'services', 'team', 'analytics'),
    'owner': PERMS,
    'admin': PERMS,
}
FINANCE_COLS = {'incomes', 'expenses', 'recurring'}

# Поля компании, которые меняет только платформа: тариф и его срок —
# предмет оплаты, статус — предмет модерации.
COMPANY_PLATFORM_FIELDS = ('plan', 'planUntil', 'status')
# Поля сотрудника, которые мастер в своей карточке не трогает.
EMPLOYEE_PROTECTED = ('access', 'isOwner', 'active', 'tgId', 'takesAppointments', 'rating',
                      'linkedAt', 'companyId', 'id')
# Публичная карточка мастера — то, что видит клиент на странице салона.
EMPLOYEE_PUBLIC = ('id', 'companyId', 'name', 'role', 'initials', 'color', 'photo', 'since',
                   'showExp', 'rating', 'schedule', 'serviceIds', 'takesAppointments', 'active', 'isOwner')
COMPANY_PUBLIC = ('id', 'name', 'short', 'cat', 'color', 'city', 'addr', 'phone', 'about', 'rating',
                  'reviewsCount', 'hours', 'currency', 'logo', 'cover', 'initials', 'slug', 'tgLink',
                  'lat', 'lon', 'cats', 'status', 'planUntil', 'tz', 'createdAt', 'notify')
BLOCK_PUBLIC = ('id', 'companyId', 'employeeId', 'start', 'end', 'kind', 'allDay')
MAX_LOGS_PER_PUSH = 50


def can(role, perm):
    return role is not None and perm in ROLES.get(role, ())


def now_iso():
    return slots.to_iso(datetime.now(timezone.utc))


def initials(name):
    return ''.join(w[0] for w in str(name or '').split()[:2]).upper() or 'К'


def pick(body, fields):
    return {k: body[k] for k in fields if k in body}


# ------------------------------------------------------------------ контекст
class Ctx:
    """Проверенный человек плюс всё, что про него знает база."""

    def __init__(self, store, identity, admin_ids=()):
        self.store = store
        self.identity = identity
        self.tg_id = identity.tg_id
        self.is_admin = identity.is_admin
        self.user = store.user(self.tg_id) or {}
        self.reload()

    def reload(self):
        s = self.store
        self.user = s.user(self.tg_id) or {}
        # Членство — живые карточки сотрудников с моим telegram-id. Ищем по
        # индексу tg_id, а не перебором всех карточек платформы.
        self.memberships = {}
        for r in s.by_tg('employees', self.tg_id):
            e = r['body']
            if e.get('active') is not False:
                self.memberships[r['companyId']] = e
        self.client_cards = {}
        for r in s.by_tg('clients', self.tg_id):
            self.client_cards[r['companyId']] = r['body']
        self.bound = set((self.user or {}).get('bound') or [])
        if (self.user or {}).get('home'):
            self.bound.add(self.user['home'])

    def role_in(self, company_id):
        if self.is_admin:
            return 'admin'
        m = self.memberships.get(company_id)
        if m:
            if m.get('isOwner') or m.get('access') == 'owner':
                return 'owner'
            if m.get('access') == 'manager':
                return 'manager'
            return 'staff'
        if company_id in self.client_cards or company_id in self.bound:
            return 'client'
        return None

    def employee_id(self, company_id):
        m = self.memberships.get(company_id)
        return m.get('id') if m else None

    def client_id(self, company_id):
        c = self.client_cards.get(company_id)
        return c.get('id') if c else None

    def visible_companies(self):
        ids = set(self.memberships) | set(self.client_cards) | self.bound
        if self.is_admin:
            ids |= {c['id'] for c in self.store.all_companies()}
        return sorted(i for i in ids if i)


# ------------------------------------------------------------------ выдача
def anonymize_appointment(a):
    """Чужая запись: занятое время без человека и без суммы."""
    return {
        'id': a.get('id'), 'companyId': a.get('companyId'), 'employeeId': a.get('employeeId'),
        'start': a.get('start'), 'duration': a.get('duration') or 60, 'status': a.get('status'),
        'serviceIds': [], 'price': 0, 'clientId': None, 'note': '', 'source': a.get('source'),
        'createdAt': a.get('createdAt'), 'anon': True,
    }


class Scope:
    """
    Что из компании видно этой роли. Для мастера список «своих» клиентов
    считается по его записям, поэтому объект собирает контекст один раз
    на компанию, а не на каждую сущность.
    """

    def __init__(self, ctx, company_id):
        self.ctx = ctx
        self.cid = company_id
        self.role = ctx.role_in(company_id)
        self.emp_id = ctx.employee_id(company_id)
        self.my_client = ctx.client_id(company_id)
        self._own_clients = None
        # Чужие записи нужны только как занятое время для расчёта окон,
        # поэтому история старше суток клиенту и мастеру не отдаётся:
        # иначе вся история салона ехала бы в localStorage каждого клиента.
        self.recent_from = slots.to_iso(datetime.now(timezone.utc) - timedelta(days=1))

    def is_recent(self, body):
        """Запись или блокировка не старше суток — ISO-строки сравниваются как строки."""
        return str(body.get('start') or '') >= self.recent_from

    def own_clients(self):
        if self._own_clients is None:
            ids = set()
            if self.emp_id:
                for a in self.ctx.store.bodies('appointments', self.cid):
                    if a.get('employeeId') == self.emp_id and a.get('clientId'):
                        ids.add(a['clientId'])
            self._own_clients = ids
        return self._own_clients

    def view(self, col, body):
        """Сущность в том виде, в каком её можно отдать, или None."""
        role = self.role
        if role in ('admin', 'owner'):
            return body
        if role == 'manager':
            if col in FINANCE_COLS or col == 'reviews':
                return None
            return body
        if role == 'staff':
            if col in FINANCE_COLS or col in ('reviews', 'invites', 'broadcasts', 'inbox', 'logs', 'errors'):
                return None
            if col == 'appointments':
                if body.get('employeeId') == self.emp_id:
                    return body
                return anonymize_appointment(body) if self.is_recent(body) else None
            if col == 'clients':
                return body if body.get('id') in self.own_clients() else None
            if col == 'tickets':
                return body if str(body.get('authorTg') or '') == self.ctx.tg_id else None
            return body
        if role == 'client':
            if col == 'companies':
                return pick(body, COMPANY_PUBLIC)
            if col == 'employees':
                if body.get('active') is False or not body.get('takesAppointments', True):
                    return None
                return pick(body, EMPLOYEE_PUBLIC)
            if col == 'services':
                return body if body.get('active') is not False else None
            if col == 'clients':
                return body if body.get('id') == self.my_client else None
            if col == 'appointments':
                if body.get('clientId') and body.get('clientId') == self.my_client:
                    return body
                return anonymize_appointment(body) if self.is_recent(body) else None
            if col == 'blocks':
                return pick(body, BLOCK_PUBLIC) if self.is_recent(body) else None
            if col == 'reviews':
                return body if body.get('clientId') == self.my_client else None
            if col == 'tickets':
                return body if str(body.get('authorTg') or '') == self.ctx.tg_id else None
            return None
        return None


def view_platform(ctx, col, body):
    """Платформенные сущности: тарифы видят все, остальное — админ."""
    if col == 'plans':
        return body
    if ctx.is_admin:
        return body
    if col == 'notices' and ctx.memberships:
        return body
    return None


# ------------------------------------------------------------------ запись
class Denied(Exception):
    pass


def check_company(scope, body, existing, ctx):
    role = scope.role
    if existing is None:
        # Любой может завести компанию; владельцем станет он сам (см. push).
        return
    if role not in ('owner', 'admin'):
        raise Denied('менять компанию может только владелец')
    if role != 'admin':
        for k in COMPANY_PLATFORM_FIELDS:
            if k in existing:
                body[k] = existing[k]
            else:
                body.pop(k, None)


def check_employee(scope, body, existing, ctx):
    role = scope.role
    if role in ('owner', 'admin'):
        return
    if role == 'manager':
        if body.get('isOwner') or body.get('access') == 'owner':
            raise Denied('администратор не назначает владельцев')
        if existing and (existing.get('isOwner') or existing.get('access') == 'owner'):
            raise Denied('карточку владельца меняет только он сам')
        if existing and str(existing.get('tgId') or '') != str(body.get('tgId') or ''):
            raise Denied('привязка к Telegram меняется только приглашением')
        return
    if role == 'staff':
        if not existing or existing.get('id') != scope.emp_id:
            raise Denied('мастер меняет только свою карточку')
        for k in EMPLOYEE_PROTECTED:
            if k in existing:
                body[k] = existing[k]
            else:
                body.pop(k, None)
        return
    raise Denied('нет доступа к команде')


def check_appointment(scope, body, existing, ctx, store, tz, company):
    role = scope.role
    if role is None:
        raise Denied('нет доступа к компании')
    if role == 'client':
        my = scope.my_client
        if not my:
            raise Denied('сначала заполните карточку клиента')
        if body.get('clientId') != my:
            raise Denied('это чужая запись')
        if existing is None:
            body['status'] = 'planned'
            body['source'] = 'client'
            body['createdAt'] = body.get('createdAt') or now_iso()
            body['note'] = str(body.get('note') or '')[:500]
            # цену и длительность считаем сами: прайс — не предмет договора с клиентом
            svcs = [s for s in (store.body('services', i) for i in body.get('serviceIds') or []) if s]
            if not svcs:
                raise Denied('услуга не найдена')
            if any(s.get('companyId') != scope.cid for s in svcs):
                raise Denied('услуга другой компании')
            body['duration'] = sum(int(s.get('duration') or 0) for s in svcs) or 60
            body['price'] = sum(int(s.get('price') or 0) for s in svcs)
            if not company_accepts(company):
                raise Denied('салон сейчас не принимает онлайн-записи')
        else:
            if existing.get('clientId') != my:
                raise Denied('это чужая запись')
            # клиент может отменить или перенести; остальное остаётся как было
            allowed = {'status', 'start', 'cancelledBy', 'cancelledAt', 'note', 'reviewId', 'employeeId'}
            for k, v in existing.items():
                if k not in allowed:
                    body[k] = v
            if body.get('status') not in ('planned', 'cancelled') or existing.get('status') != 'planned':
                if body.get('status') != existing.get('status') or body.get('start') != existing.get('start'):
                    raise Denied('эту запись уже нельзя менять')
            if body.get('status') == 'cancelled':
                body['cancelledBy'] = 'client'
                body['cancelledAt'] = body.get('cancelledAt') or now_iso()
            if body.get('employeeId') != existing.get('employeeId'):
                body['employeeId'] = existing['employeeId']
    elif role == 'staff':
        if body.get('employeeId') != scope.emp_id or (existing and existing.get('employeeId') != scope.emp_id):
            raise Denied('это запись другого мастера')
    elif role not in ('owner', 'manager', 'admin'):
        raise Denied('нет доступа')

    if existing and existing.get('companyId') != body.get('companyId'):
        raise Denied('запись нельзя перенести в другую компанию')

    # Свободно ли время — единственная проверка, которую экран обойти не может.
    if body.get('status') == 'planned':
        moved = existing is None or existing.get('start') != body.get('start') \
            or existing.get('employeeId') != body.get('employeeId') \
            or existing.get('status') != 'planned' \
            or int(existing.get('duration') or 0) != int(body.get('duration') or 0)
        if moved:
            emp = store.body('employees', body.get('employeeId'))
            if not emp or emp.get('companyId') != scope.cid:
                raise Denied('мастер не найден')
            appts = store.bodies('appointments', scope.cid)
            blocks = store.bodies('blocks', scope.cid)
            why = slots.appointment_conflict(body, appts, blocks, emp, company, tz)
            if why:
                raise Denied(why)


def company_accepts(company):
    """Подписка жива (с льготными днями) и компания не заблокирована."""
    import config
    if not company or company.get('status') == 'blocked':
        return False
    until = slots.parse_iso(company.get('planUntil'))
    if not until:
        return True
    from datetime import timedelta
    return until + timedelta(days=config.GRACE_DAYS) > datetime.now(timezone.utc)


def check_client(scope, body, existing, ctx):
    role = scope.role
    if role in ('owner', 'manager', 'admin'):
        return
    if role == 'staff':
        if existing and existing.get('id') not in scope.own_clients():
            raise Denied('это не ваш клиент')
        return
    if role == 'client':
        my = scope.my_client
        if my and body.get('id') != my:
            raise Denied('у вас уже есть карточка в этом салоне')
        if existing and existing.get('id') != my:
            raise Denied('это чужая карточка')
        # карточка клиента принадлежит человеку с этим telegram-id — не наоборот
        body['tgId'] = ctx.tg_id
        if not body.get('tg') and ctx.identity.username:
            body['tg'] = ctx.identity.username
        body['name'] = str(body.get('name') or ctx.identity.name)[:80]
        body['initials'] = initials(body['name'])
        if existing:
            for k in ('note', 'ai', 'tags', 'createdAt'):
                if k in existing:
                    body[k] = existing[k]
        else:
            body['note'] = ''
            body['ai'] = None
            body['tags'] = []
            body['createdAt'] = body.get('createdAt') or now_iso()
        return
    raise Denied('нет доступа к клиентам')


def check_review(scope, body, existing, ctx, store):
    if scope.role == 'admin':
        return
    if scope.role != 'client':
        raise Denied('отзыв оставляет клиент')
    if existing:
        raise Denied('отзыв уже оставлен')
    a = store.body('appointments', body.get('apptId'))
    if not a or a.get('clientId') != scope.my_client or a.get('companyId') != scope.cid:
        raise Denied('это не ваш визит')
    if a.get('status') != 'done':
        raise Denied('оценить можно выполненный визит')
    if any(r.get('apptId') == a['id'] for r in store.bodies('reviews', scope.cid)):
        raise Denied('этот визит уже оценён')
    body['clientId'] = a['clientId']
    body['employeeId'] = a.get('employeeId')
    body['rating'] = max(1, min(5, int(body.get('rating') or 5)))
    body['text'] = str(body.get('text') or '')[:1000]
    body['createdAt'] = body.get('createdAt') or now_iso()


def check_ticket(scope, body, existing, ctx):
    role = scope.role if scope else None
    if ctx.is_admin:
        return
    if role is None and body.get('companyId'):
        raise Denied('нет доступа к компании')
    if existing is None:
        body['author'] = str(body.get('author') or ctx.identity.name)[:80]
        body['authorTg'] = ctx.tg_id
        body['status'] = 'new'
        body['createdAt'] = body.get('createdAt') or now_iso()
        if role == 'client':
            body['from'] = 'client'
        return
    # Дописывать может автор (ответ на ответ) и владелец компании для её обращений.
    mine = str(existing.get('authorTg') or '') == ctx.tg_id
    company_side = role in ('owner', 'manager') and existing.get('from') != 'client'
    if not (mine or company_side):
        raise Denied('это чужое обращение')
    # статус и тему решает поддержка
    for k in ('status', 'topic', 'subject', 'from', 'author', 'authorTg', 'createdAt', 'companyId'):
        if k in existing:
            body[k] = existing[k]
    old_msgs = existing.get('messages') or []
    new_msgs = body.get('messages') or []
    if new_msgs[:len(old_msgs)] != old_msgs:
        raise Denied('переписку нельзя править задним числом')
    for m in new_msgs[len(old_msgs):]:
        m['from'] = 'client' if role == 'client' else 'company'
        m['at'] = m.get('at') or now_iso()


def check_inbox(scope, body, existing, ctx):
    role = scope.role
    if role == 'admin':
        return
    if role in ('owner', 'manager'):
        if existing is None:
            raise Denied('уведомления компании создаёт платформа')
        # владелец меняет только отметку о прочтении
        for k, v in existing.items():
            if k != 'readAt':
                body[k] = v
        return
    if role == 'client' and existing is None and body.get('kind') == 'complaint':
        body['at'] = body.get('at') or now_iso()
        body['readAt'] = None
        return
    raise Denied('нет доступа к уведомлениям компании')


def check_write(ctx, col, body, existing, scope, store, tz, company):
    """
    Проверить и при необходимости поправить сущность перед записью.
    Бросает Denied с причиной, понятной человеку.
    """
    role = scope.role if scope else None
    if ctx.is_admin:
        role = 'admin'
    if col in ('plans', 'notices', 'saBroadcasts', 'bans'):
        if role != 'admin':
            raise Denied('только для администратора платформы')
        return
    if col == 'companies':
        return check_company(scope, body, existing, ctx)
    # Без компании могут приходить отчёты об ошибках, журнал и обращения:
    # их шлёт и человек, у которого ещё нет ни салона, ни членства.
    if col == 'errors':
        if role is None and db_company(col, body):
            raise Denied('нет доступа к компании')
        return
    if col == 'logs':
        if role is None and db_company(col, body):
            raise Denied('нет доступа к компании')
        if existing is not None:
            raise Denied('журнал не правится')
        body['at'] = body.get('at') or now_iso()
        return
    if col == 'tickets':
        return check_ticket(scope, body, existing, ctx)
    if role is None:
        raise Denied('нет доступа к компании')
    if col == 'employees':
        return check_employee(scope, body, existing, ctx)
    if col == 'appointments':
        return check_appointment(scope, body, existing, ctx, store, tz, company)
    if col == 'clients':
        return check_client(scope, body, existing, ctx)
    if col == 'reviews':
        return check_review(scope, body, existing, ctx, store)
    if col == 'tickets':
        return check_ticket(scope, body, existing, ctx)
    if col == 'inbox':
        return check_inbox(scope, body, existing, ctx)
    if col == 'services':
        if not can(role, 'services'):
            raise Denied('услуги меняет владелец или администратор')
        return
    if col == 'blocks':
        if can(role, 'allCalendar'):
            return
        if role == 'staff' and body.get('employeeId') == scope.emp_id \
                and (not existing or existing.get('employeeId') == scope.emp_id):
            return
        raise Denied('можно занимать только своё время')
    if col in FINANCE_COLS:
        if not can(role, 'finance'):
            raise Denied('финансы доступны только владельцу')
        return
    if col == 'broadcasts':
        if not can(role, 'clients'):
            raise Denied('рассылки доступны владельцу и администратору')
        return
    if col == 'invites':
        if not can(role, 'team'):
            raise Denied('приглашения делает владелец или администратор')
        if existing and existing.get('usedAt') and body.get('usedAt') != existing.get('usedAt'):
            raise Denied('использованное приглашение не меняется')
        return
    raise Denied('неизвестная коллекция')


def db_company(col, body):
    return str(body.get('companyId') or '')


DELETABLE = {
    'blocks': 'allCalendar', 'incomes': 'finance', 'expenses': 'finance', 'recurring': 'finance',
    'notices': 'admin', 'plans': 'admin', 'errors': 'admin', 'saBroadcasts': 'admin',
}


def check_delete(ctx, col, existing, scope):
    role = 'admin' if ctx.is_admin else (scope.role if scope else None)
    need = DELETABLE.get(col)
    if need is None:
        raise Denied('эту запись нельзя удалить')
    if need == 'admin':
        if role != 'admin':
            raise Denied('только для администратора платформы')
        return
    if can(role, need):
        return
    if col == 'blocks' and role == 'staff' and existing.get('employeeId') == scope.emp_id:
        return
    raise Denied('нет права на удаление')


def owner_employee(company, identity):
    """Карточка владельца для только что созданной компании."""
    return {
        'id': company['id'] + '_owner', 'companyId': company['id'],
        'name': identity.name, 'role': 'Владелец', 'isOwner': True, 'active': True,
        'initials': initials(identity.name), 'color': '#4C6FFF', 'phone': '',
        'schedule': company.get('hours') or {}, 'serviceIds': [],
        'takesAppointments': True, 'access': 'owner', 'rating': '5.0',
        'photo': None, 'since': None, 'showExp': True,
        'tg': identity.username, 'tgId': identity.tg_id, 'linkedAt': now_iso(),
        'createdAt': now_iso(),
    }


def normalize_new_company(body, plans, trial_days, tz):
    """Новая компания: пробный период и тариф задаёт платформа, не клиент."""
    from datetime import timedelta
    ids = [p['id'] for p in plans] or ['PRO']
    if body.get('plan') not in ids:
        body['plan'] = 'PRO' if 'PRO' in ids else ids[0]
    body['planUntil'] = slots.to_iso(datetime.now(timezone.utc) + timedelta(days=trial_days))
    body['status'] = None
    body['createdAt'] = body.get('createdAt') or now_iso()
    # зона — только настоящая IANA-строка вроде Asia/Almaty, иначе своя
    given = str(body.get('tz') or '')
    if not given or not slots.valid_tz(given):
        body['tz'] = tz
    body.setdefault('rating', 5.0)
    body.setdefault('reviewsCount', 0)
    return body
