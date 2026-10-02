"""
Тесты сервера. Запуск из корня проекта:

    python -m unittest discover -s server/tests -v

Без зависимостей: unittest, сервер поднимается на свободном порту,
база — в памяти, вход — через DEV_AUTH. Проверяется ровно то, что
обещано людям: права по ролям, невозможность двойной записи, приглашения,
очередь уведомлений и отправка.
"""
import json
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.abspath(os.path.join(HERE, '..'))
sys.path.insert(0, SERVER)

os.environ['ZAPIS_QUIET'] = '1'
os.environ['DEV_AUTH'] = '1'
os.environ['BOT_TOKEN'] = os.environ.get('TEST_BOT_TOKEN', '')
os.environ['ADMIN_TG_IDS'] = '999'
os.environ['WEBAPP_URL'] = 'https://example.test/app'
os.environ['DATA_DIR'] = os.path.join(HERE, '.run-tests')

import access  # noqa: E402
import auth  # noqa: E402
import config  # noqa: E402
import db  # noqa: E402
import notify  # noqa: E402
import serve  # noqa: E402
import slots  # noqa: E402

TZ = slots.tzinfo_for('Asia/Almaty')
HOURS = {str(d): {'on': d != 0, 'from': '09:00', 'to': '20:00', 'breaks': []} for d in range(7)}


def company_payload(cid='co_t1', name='Тест-салон'):
    return {
        'id': cid, 'name': name, 'short': 'Тест', 'cat': 'Салон красоты', 'color': '#4C6FFF',
        'city': 'Алматы', 'addr': 'ул. Тест 1', 'phone': '+7 777 000 00 00', 'hours': HOURS,
        'currency': '₸', 'plan': 'PRO', 'planUntil': '2030-01-01T00:00:00.000Z', 'status': 'blocked',
    }


def tomorrow_at(minute):
    d = (datetime.now(TZ) + timedelta(days=1)).date()
    return d, slots.to_iso(slots.at_minutes(d, minute, TZ))


class ServerCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        serve.init(':memory:', start_sender=False)
        cls.srv = serve.Server(('127.0.0.1', 0), serve.Handler)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def call(self, method, path, body=None, user='1:Owner', internal=False):
        headers = {'Content-Type': 'application/json'}
        if internal:
            headers['X-Internal-Token'] = config.internal_token()
        elif user:
            headers['X-Dev-User'] = urllib.parse.quote(user)
        req = urllib.request.Request('http://127.0.0.1:%d%s' % (self.port, path), method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def push(self, upsert, user='1:Owner', delete=None):
        st, r = self.call('POST', '/api/v2/push', {'upsert': upsert, 'delete': delete or {}, 'since': 0}, user=user)
        self.assertEqual(st, 200, r)
        return r


class CompanyAndRoles(ServerCase):
    def test_01_anonymous_is_rejected(self):
        st, r = self.call('GET', '/api/v2/changes?since=0', user=None)
        self.assertEqual(st, 401)

    def test_02_owner_creates_company_and_gets_trial(self):
        r = self.push({
            'companies': [company_payload()],
            'employees': [{'id': 'co_t1_owner', 'companyId': 'co_t1', 'name': 'Вы', 'role': 'Владелец',
                           'isOwner': True, 'active': True, 'schedule': HOURS, 'serviceIds': [],
                           'takesAppointments': True, 'access': 'owner'}],
            'services': [{'id': 's_1', 'companyId': 'co_t1', 'name': 'Маникюр', 'price': 5000, 'duration': 60,
                          'cat': 'nails', 'active': True, 'employeeIds': ['co_t1_owner']}],
        }, user='1:Владелец Тест')
        self.assertEqual(r['rejected'], [])
        st, boot = self.call('POST', '/api/v2/boot', {'start': 'owner'}, user='1:Владелец Тест')
        self.assertEqual(boot['memberships'][0]['isOwner'], True)
        c = boot['data']['companies'][0]
        # статус и срок подписки клиент задать не может: пробный период ставит сервер
        self.assertIsNone(c['status'])
        until = slots.parse_iso(c['planUntil'])
        self.assertTrue(timedelta(days=13) < until - datetime.now(timezone.utc) < timedelta(days=15))
        # владелец получил имя из Telegram, а не «Вы»
        self.assertEqual(boot['data']['employees'][0]['name'], 'Владелец Тест')
        self.assertEqual(boot['data']['employees'][0]['tgId'], '1')

    def test_03_stranger_cannot_edit_company(self):
        st, boot = self.call('POST', '/api/v2/boot', {'start': 'co_t1'}, user='2:Клиент')
        self.assertEqual(boot['home'], 'co_t1')
        c = boot['data']['companies'][0]
        self.assertNotIn('finCats', c)             # публичная карточка без внутренностей
        c['name'] = 'Взлом'
        r = self.push({'companies': [c]}, user='2:Клиент')
        self.assertEqual(r['rejected'][0]['reason'], 'менять компанию может только владелец')

    def test_04_client_books_server_prices_it_and_blocks_double(self):
        d, start = tomorrow_at(600)
        cl = {'id': 'cl_a', 'companyId': 'co_t1', 'name': 'Клиент Тест', 'phone': '+7 700 1', 'tg': '', 'tgId': '2'}
        ap = {'id': 'ap_a', 'companyId': 'co_t1', 'clientId': 'cl_a', 'employeeId': 'co_t1_owner',
              'serviceIds': ['s_1'], 'start': start, 'duration': 15, 'price': 1, 'status': 'planned',
              'source': 'client'}
        r = self.push({'clients': [cl], 'appointments': [ap]}, user='2:Клиент')
        self.assertEqual(r['rejected'], [])
        saved = [c['body'] for c in r['changes'] if c['col'] == 'appointments'][0]
        self.assertEqual((saved['price'], saved['duration']), (5000, 60))
        # второй клиент на то же время
        self.call('POST', '/api/v2/boot', {'start': 'co_t1'}, user='3:Другой')
        r = self.push({'clients': [dict(cl, id='cl_b', tgId='3')],
                       'appointments': [dict(ap, id='ap_b', clientId='cl_b')]}, user='3:Другой')
        self.assertEqual([x['reason'] for x in r['rejected']], ['это время уже занято'])
        # чужая запись видна как занятое время без человека
        st, boot = self.call('POST', '/api/v2/boot', {'start': 'co_t1'}, user='3:Другой')
        a = boot['data']['appointments'][0]
        self.assertTrue(a['anon'])
        self.assertIsNone(a['clientId'])
        # свою карточку клиент видит, чужих — нет
        self.assertEqual([c['id'] for c in boot['data']['clients']], ['cl_b'])
        # владелец видит клиента
        st, ch = self.call('GET', '/api/v2/changes?since=0', user='1:Владелец Тест')
        self.assertIn('cl_a', [c['body']['id'] for c in ch['changes'] if c['col'] == 'clients'])
        # уведомления: напоминание за 2 часа, отзыв, владельцу «новая запись»
        kinds = {(n['kind'], n['tg_id']) for n in serve.STORE.notifications_for(ref='ap_a')}
        self.assertEqual(kinds, {('rem2', '2'), ('review', '2'), ('new', '1')})
        inbox = serve.STORE.bodies('inbox', 'co_t1')
        self.assertEqual(inbox[-1]['kind'], 'booking')

    def test_05_client_cancels_own_not_others(self):
        st, boot = self.call('POST', '/api/v2/boot', {'start': 'co_t1'}, user='3:Другой')
        a = dict(boot['data']['appointments'][0], status='cancelled')
        r = self.push({'appointments': [a]}, user='3:Другой')
        self.assertEqual(r['rejected'][0]['reason'], 'это чужая запись')
        st, boot = self.call('POST', '/api/v2/boot', {'start': 'co_t1'}, user='2:Клиент')
        a = dict(boot['data']['appointments'][0], status='cancelled', price=999999)
        r = self.push({'appointments': [a]}, user='2:Клиент')
        self.assertEqual(r['rejected'], [])
        saved = serve.STORE.body('appointments', 'ap_a')
        self.assertEqual((saved['status'], saved['cancelledBy'], saved['price']), ('cancelled', 'client', 5000))
        pending = [n for n in serve.STORE.notifications_for(ref='ap_a') if not n['cancelled'] and not n['sent_at']]
        self.assertEqual({n['kind'] for n in pending}, {'new', 'cancel'})

    def test_06_invite_flow_and_staff_visibility(self):
        inv = {'id': 'inv12345678', 'companyId': 'co_t1', 'access': 'staff', 'role': 'Мастер',
               'createdAt': '2026-01-01T00:00:00.000Z', 'expiresAt': '2030-01-01T00:00:00.000Z',
               'usedAt': None, 'usedBy': None, 'revokedAt': None, 'employeeId': None}
        # мастер не может создать приглашение — только владелец
        self.assertEqual(self.push({'invites': [inv]}, user='2:Клиент')['rejected'][0]['reason'],
                         'приглашения делает владелец или администратор')
        self.assertEqual(self.push({'invites': [inv]}, user='1:Владелец Тест')['rejected'], [])
        st, r = self.call('GET', '/api/v2/invites/inv12345678', user='7:Мастер')
        self.assertEqual(r['state'], 'активна')
        st, r = self.call('POST', '/api/v2/invites/inv12345678/accept', {'name': 'Иван', 'phone': '+7 701'},
                          user='7:Мастер')
        self.assertTrue(r['ok'])
        self.assertEqual(r['employee']['access'], 'staff')
        self.assertEqual(r['session']['memberships'][0]['companyId'], 'co_t1')
        st, r = self.call('POST', '/api/v2/invites/inv12345678/accept', {'name': 'Х'}, user='8:Второй')
        self.assertEqual(r['why'], 'использована')
        # мастер не видит финансы и чужих клиентов, не правит услуги, не повышает себя
        st, boot = self.call('POST', '/api/v2/boot', {'start': 'owner'}, user='7:Мастер')
        self.assertEqual(boot['data']['incomes'], [])
        self.assertEqual(boot['data']['clients'], [])
        svc = dict(boot['data']['services'][0], price=1)
        self.assertEqual(self.push({'services': [svc]}, user='7:Мастер')['rejected'][0]['reason'],
                         'услуги меняет владелец или администратор')
        me = [e for e in boot['data']['employees'] if e.get('tgId') == '7'][0]
        me['access'] = 'owner'
        me['phone'] = '+7 777'
        r = self.push({'employees': [me]}, user='7:Мастер')
        self.assertEqual(r['rejected'], [])
        saved = serve.STORE.body('employees', me['id'])
        self.assertEqual((saved['access'], saved['phone']), ('staff', '+7 777'))

    def test_07_admin_only_routes(self):
        st, r = self.call('GET', '/api/v2/admin/stats', user='1:Владелец Тест')
        self.assertEqual(st, 403)
        st, r = self.call('GET', '/api/v2/admin/stats', user='999:Admin')
        self.assertEqual(st, 200)
        self.assertGreaterEqual(r['stats']['entities']['companies'], 1)
        self.assertEqual(self.push({'plans': [{'id': 'X', 'name': 'X', 'price': 1}]}, user='1:Владелец Тест')
                         ['rejected'][0]['reason'], 'только для администратора платформы')

    def test_08_bot_internal_booking(self):
        st, r = self.call('GET', '/api/v2/internal/catalog', user=None)
        self.assertEqual(st, 403)
        st, cat = self.call('GET', '/api/v2/internal/catalog', internal=True)
        self.assertEqual([c['id'] for c in cat['companies']], ['co_t1'])
        d, _ = tomorrow_at(0)
        st, sl = self.call('GET', '/api/v2/internal/slots?companyId=co_t1&serviceId=s_1&date=%s' % d, internal=True)
        self.assertIn(600, [s['min'] for s in sl['slots']])      # 10:00 освободилось после отмены
        st, bk = self.call('POST', '/api/v2/internal/book', {
            'companyId': 'co_t1', 'serviceId': 's_1', 'date': d.isoformat(), 'min': 600, 'employeeId': 'co_t1_owner',
            'tgId': '5', 'name': 'Бот Клиент', 'username': 'botclient'}, internal=True)
        self.assertEqual(st, 200, bk)
        self.assertEqual(bk['appointment']['when'], 'завтра, 10:00')
        st, again = self.call('POST', '/api/v2/internal/book', {
            'companyId': 'co_t1', 'serviceId': 's_1', 'date': d.isoformat(), 'min': 600, 'employeeId': 'co_t1_owner',
            'tgId': '6', 'name': 'Ещё один'}, internal=True)
        self.assertEqual(st, 409)
        # «любой мастер» — второй мастер (вошёл по приглашению) свободен, запись к нему
        st, other = self.call('POST', '/api/v2/internal/book', {
            'companyId': 'co_t1', 'serviceId': 's_1', 'date': d.isoformat(), 'min': 600,
            'tgId': '6', 'name': 'Ещё один'}, internal=True)
        self.assertEqual(st, 200, other)
        self.assertNotEqual(other['appointment']['employeeId'], 'co_t1_owner')
        st, my = self.call('GET', '/api/v2/internal/my?tgId=5', internal=True)
        self.assertEqual(len(my['appointments']), 1)
        st, cx = self.call('POST', '/api/v2/internal/cancel', {'id': bk['appointment']['id'], 'tgId': '6'},
                           internal=True)
        self.assertEqual(st, 403)
        st, cx = self.call('POST', '/api/v2/internal/cancel', {'id': bk['appointment']['id'], 'tgId': '5'},
                           internal=True)
        self.assertEqual(cx['appointment']['status'], 'cancelled')

    def test_09_legacy_api_is_gone(self):
        st, r = self.call('GET', '/api/appointments', user=None)
        self.assertEqual(st, 410)


class UnitPieces(unittest.TestCase):
    def test_init_data_signature(self):
        token = '123456:ABC-DEF'
        user = {'id': 42, 'first_name': 'Айгерим', 'username': 'aigerim'}
        good = auth.build_init_data(token, user, start_param='c1')
        u = auth.verify_init_data(good, token)
        self.assertEqual((u['id'], u['start_param']), (42, 'c1'))
        with self.assertRaises(auth.AuthError):
            auth.verify_init_data(good.replace('aigerim', 'hacker'), token)
        with self.assertRaises(auth.AuthError):
            auth.verify_init_data(good, 'other:token')
        old = auth.build_init_data(token, user, auth_date=int(time.time()) - 100000)
        with self.assertRaises(auth.AuthError):
            auth.verify_init_data(old, token, max_age=3600)

    def test_slots_respect_company_hours_breaks_and_blocks(self):
        emp = {'id': 'e1', 'schedule': {str(d): {'on': True, 'from': '08:00', 'to': '22:00',
                                                   'breaks': [{'from': '13:00', 'to': '14:00'}]} for d in range(7)}}
        company = {'hours': {str(d): {'on': True, 'from': '09:00', 'to': '18:00'} for d in range(7)}}
        d = (datetime.now(TZ) + timedelta(days=2)).date()
        blocks = [{'employeeId': 'e1', 'start': slots.to_iso(slots.at_minutes(d, 900, TZ)),
                   'end': slots.to_iso(slots.at_minutes(d, 960, TZ))}]
        appts = [{'employeeId': 'e1', 'status': 'planned', 'start': slots.to_iso(slots.at_minutes(d, 600, TZ)),
                  'duration': 60}]
        out = slots.slots_for([emp], company, d, 60, TZ, appts, blocks)
        free = {s['min'] for s in out if s['free']}
        self.assertNotIn(480, free)          # до открытия салона
        self.assertIn(540, free)
        self.assertNotIn(600, free)          # занято записью
        self.assertNotIn(750, free)          # заезжает на перерыв 13:00
        self.assertNotIn(900, free)          # блокировка
        self.assertNotIn(1080, free)         # после закрытия салона
        # отменённая запись слот не держит
        appts[0]['status'] = 'cancelled'
        free2 = {s['min'] for s in slots.slots_for([emp], company, d, 60, TZ, appts, blocks) if s['free']}
        self.assertIn(600, free2)

    def test_sender_marks_sent_and_skips_late_reminders(self):
        store = db.Store(':memory:')
        now = time.time()
        store.schedule('rem24:a', '10', 'rem24', 'late', now - 3600, ref='a')
        store.schedule('new:b', '11', 'new', 'fresh', now - 3600, ref='b')
        store.schedule('rem2:c', '12', 'rem2', 'ok', now - 60, ref='c')
        sent = []

        def fake(token, chat, text, kb=None):
            sent.append((chat, text))
            return (chat != '12', None if chat != '12' else 'HTTP 403 Forbidden: bot was blocked', 0)

        s = notify.Sender(store, 'tok', sender=fake)
        s.tick()
        self.assertEqual([c for c, _ in sent], ['11', '12'])
        rows = {n['key']: n for n in store.notifications_for()}
        self.assertTrue(rows['rem24:a']['cancelled'])
        self.assertIsNotNone(rows['new:b']['sent_at'])
        self.assertIsNotNone(rows['rem2:c']['sent_at'])       # заблокировал бота — не повторяем
        self.assertIn('403', rows['rem2:c']['error'])

    def test_schedule_is_idempotent_and_replaceable(self):
        store = db.Store(':memory:')
        store.schedule('k', '1', 'rem24', 'a', 10)
        store.schedule('k', '1', 'rem24', 'b', 20)
        rows = store.notifications_for()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['text'], rows[0]['due_at']), ('b', 20))
        store.mark_sent(rows[0]['id'], True)
        self.assertIsNone(store.schedule('k', '1', 'rem24', 'c', 30))

    def test_auto_complete_and_digest(self):
        store = db.Store(':memory:')
        store.put('companies', dict(company_payload('co_d'), notify={'digest': True}, tz='Asia/Almaty', status=None))
        store.put('employees', {'id': 'e_d', 'companyId': 'co_d', 'name': 'Мастер', 'tgId': '77', 'isOwner': True})
        store.put('clients', {'id': 'c_d', 'companyId': 'co_d', 'name': 'Клиент'})
        store.put('services', {'id': 's_d', 'companyId': 'co_d', 'name': 'Стрижка', 'price': 1, 'duration': 30})
        past = datetime.now(timezone.utc) - timedelta(hours=4)
        store.put('appointments', {'id': 'a_old', 'companyId': 'co_d', 'clientId': 'c_d', 'employeeId': 'e_d',
                                   'serviceIds': ['s_d'], 'start': slots.to_iso(past), 'duration': 30,
                                   'status': 'planned'})
        today_local = datetime.now(TZ).replace(hour=19, minute=0, second=0, microsecond=0)
        store.put('appointments', {'id': 'a_today', 'companyId': 'co_d', 'clientId': 'c_d', 'employeeId': 'e_d',
                                   'serviceIds': ['s_d'], 'start': slots.to_iso(today_local), 'duration': 30,
                                   'status': 'planned'})
        self.assertEqual(notify.auto_complete(store), 1)
        self.assertEqual(store.body('appointments', 'a_old')['status'], 'done')
        at9 = datetime.now(TZ).replace(hour=9, minute=0).astimezone(timezone.utc)
        self.assertEqual(notify.daily_digests(store, now=at9), 1)
        self.assertEqual(notify.daily_digests(store, now=at9), 1)   # повторно — та же строка, не вторая
        rows = store.notifications_for()
        self.assertEqual(len([r for r in rows if r['kind'] == 'digest']), 1)
        self.assertIn('19:00', [r for r in rows if r['kind'] == 'digest'][0]['text'])

    def test_start_param_parsing(self):
        self.assertEqual(serve.start_company('co_abc_book'), 'co_abc')
        self.assertEqual(serve.start_company('c1'), 'c1')
        self.assertEqual(serve.start_company('c1_my'), 'c1')
        self.assertEqual(serve.start_company('owner_cal'), 'owner')
        self.assertEqual(serve.start_company('co_abc'), 'co_abc')


class ReviewFindings(ServerCase):
    """Что нашло ревью: отказ не раскрывает чужое, ошибки без компании
    принимаются, клиент не получает всю историю, перенос даёт новое напоминание."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.push_as = lambda self, user, upsert: self.push(upsert, user=user)

    def test_01_setup(self):
        r = self.push({
            'companies': [company_payload('co_r1', 'Ревью')],
            'employees': [{'id': 'co_r1_owner', 'companyId': 'co_r1', 'name': 'Вы', 'role': 'Владелец',
                           'isOwner': True, 'active': True, 'schedule': HOURS, 'serviceIds': [],
                           'takesAppointments': True, 'access': 'owner', 'phone': '+7 700 secret'}],
            'services': [{'id': 's_r', 'companyId': 'co_r1', 'name': 'Стрижка', 'price': 3000, 'duration': 30,
                          'cat': 'bar', 'active': True, 'employeeIds': ['co_r1_owner']}],
            'incomes': [{'id': 'inc_r', 'companyId': 'co_r1', 'type': 'income', 'amount': 500, 'cat': 'sale',
                         'date': '2026-01-01T00:00:00.000Z'}],
        }, user='11:Owner R')
        self.assertEqual(r['rejected'], [])
        # старая запись владельца — история, которой клиенту видеть незачем
        self.push({'clients': [{'id': 'cl_old', 'companyId': 'co_r1', 'name': 'Старый', 'phone': '+7 1'}],
                   'appointments': [{'id': 'ap_old', 'companyId': 'co_r1', 'clientId': 'cl_old',
                                     'employeeId': 'co_r1_owner', 'serviceIds': ['s_r'],
                                     'start': '2026-01-10T05:00:00.000Z', 'duration': 30, 'price': 3000,
                                     'status': 'done', 'source': 'owner'}]}, user='11:Owner R')

    def test_02_rejection_does_not_leak_foreign_entities(self):
        st, boot = self.call('POST', '/api/v2/boot', {'start': 'co_r1'}, user='12:Клиент R')
        # клиент пробует «отредактировать» чужие сущности, угадав id
        r = self.push({
            'incomes': [{'id': 'inc_r', 'companyId': 'co_r1', 'type': 'income', 'amount': 1, 'cat': 'sale'}],
            'employees': [{'id': 'co_r1_owner', 'companyId': 'co_r1', 'name': 'x'}],
            'clients': [{'id': 'cl_old', 'companyId': 'co_r1', 'name': 'x'}],
            'appointments': [{'id': 'ap_old', 'companyId': 'co_r1', 'clientId': 'cl_old', 'employeeId': 'co_r1_owner',
                              'serviceIds': ['s_r'], 'start': '2026-01-10T05:00:00.000Z', 'duration': 30,
                              'status': 'cancelled'}],
        }, user='12:Клиент R')
        self.assertEqual(len(r['rejected']), 4)
        by = {x['col']: x['server'] for x in r['rejected']}
        self.assertIsNone(by['incomes'])
        self.assertIsNone(by['clients'])
        self.assertNotIn('phone', by['employees'] or {})
        self.assertTrue(by['appointments'] is None or by['appointments'].get('anon'))
        self.assertNotIn('+7 700 secret', json.dumps(r, ensure_ascii=False))

    def test_03_error_report_without_company_is_accepted(self):
        r = self.push({'errors': [{'id': 'er_1', 'message': 'boom', 'where': 'start', 'count': 1,
                                   'firstAt': '2026-01-01T00:00:00.000Z', 'lastAt': '2026-01-01T00:00:00.000Z'}]},
                      user='4444:Nobody')
        self.assertEqual(r['rejected'], [])
        r = self.push({'tickets': [{'id': 'tk_free', 'topic': 'howto', 'subject': 'Как', 'companyId': None,
                                    'messages': [{'from': 'client', 'text': 'вопрос'}]}]}, user='4444:Nobody')
        self.assertEqual(r['rejected'], [])

    def test_04_client_gets_only_recent_foreign_appointments(self):
        st, boot = self.call('POST', '/api/v2/boot', {'start': 'co_r1'}, user='12:Клиент R')
        self.assertEqual([a['id'] for a in boot['data']['appointments']], [])
        d, start = tomorrow_at(660)
        self.push({'clients': [{'id': 'cl_r2', 'companyId': 'co_r1', 'name': 'Р', 'tgId': '12'}],
                   'appointments': [{'id': 'ap_new', 'companyId': 'co_r1', 'clientId': 'cl_r2',
                                     'employeeId': 'co_r1_owner', 'serviceIds': ['s_r'], 'start': start,
                                     'duration': 30, 'status': 'planned', 'source': 'client'}]}, user='12:Клиент R')
        st, boot = self.call('POST', '/api/v2/boot', {'start': 'co_r1'}, user='13:Другой R')
        ids = [a['id'] for a in boot['data']['appointments']]
        self.assertEqual(ids, ['ap_new'])        # свежая — как занятое время, старая — нет

    def test_05_move_after_sent_reminder_schedules_new_one(self):
        a = serve.STORE.body('appointments', 'ap_new')
        rows = [n for n in serve.STORE.notifications_for(ref='ap_new') if n['kind'] == 'rem2']
        self.assertEqual(len(rows), 1)
        serve.STORE.mark_sent(rows[0]['id'], True)          # напоминание уже ушло
        moved = dict(a)
        moved['start'] = slots.to_iso(slots.parse_iso(a['start']) + timedelta(days=3))
        r = self.push({'appointments': [moved]}, user='12:Клиент R')
        self.assertEqual(r['rejected'], [])
        rows = [n for n in serve.STORE.notifications_for(ref='ap_new') if n['kind'] == 'rem2' and not n['cancelled']]
        self.assertEqual(len(rows), 2)
        self.assertTrue(any(n['sent_at'] is None for n in rows))   # новое напоминание на новую дату


if __name__ == '__main__':
    unittest.main()
