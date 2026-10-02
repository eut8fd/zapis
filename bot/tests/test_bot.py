"""
Бот против заглушки Telegram и настоящего сервера.

    python -m unittest discover -s bot/tests -v

Заглушка отдаёт getUpdates из сценария и записывает всё, что бот
отправляет. Сервер поднимается настоящий (в памяти), так что проверяется
весь путь: /start по ссылке салона → быстрая запись в чате → запись на
сервере → «Мои записи» → отмена.
"""
import http.server
import json
import os
import socketserver
import sys
import threading
import time
import unittest
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.path.insert(0, os.path.join(ROOT, 'bot'))

os.environ['ZAPIS_QUIET'] = '1'
os.environ['DEV_AUTH'] = '1'
os.environ['BOT_TOKEN'] = '123:TEST'
os.environ['ADMIN_TG_IDS'] = '999'
os.environ['DATA_DIR'] = os.path.join(HERE, '.run-tests')
os.environ['WEBAPP_URL'] = 'https://example.test/app'

import serve  # noqa: E402


class FakeTelegram(socketserver.ThreadingTCPServer):
    """Записывает вызовы и отдаёт обновления по очереди."""
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, addr):
        super().__init__(addr, FakeHandler)
        self.calls = []
        self.updates = []
        self.lock = threading.Lock()
        self.msg_id = 100


class FakeHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}')
        method = self.path.rsplit('/', 1)[-1]
        srv = self.server
        with srv.lock:
            srv.calls.append((method, body))
            if method == 'getMe':
                res = {'id': 123, 'username': 'testbot'}
            elif method == 'getUpdates':
                res = srv.updates[:]
                srv.updates = []
            elif method in ('sendMessage', 'editMessageText'):
                srv.msg_id += 1
                res = {'message_id': srv.msg_id, 'chat': {'id': body.get('chat_id')}}
            else:
                res = True
        out = json.dumps({'ok': True, 'result': res}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)


HOURS = {str(d): {'on': True, 'from': '09:00', 'to': '20:00', 'breaks': []} for d in range(7)}


class BotFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        serve.init(':memory:', start_sender=False)
        cls.api = serve.Server(('127.0.0.1', 0), serve.Handler)
        cls.api_port = cls.api.server_address[1]
        threading.Thread(target=cls.api.serve_forever, daemon=True).start()
        cls.fake = FakeTelegram(('127.0.0.1', 0))
        threading.Thread(target=cls.fake.serve_forever, daemon=True).start()
        os.environ['TELEGRAM_API_BASE'] = 'http://127.0.0.1:%d' % cls.fake.server_address[1]
        os.environ['SERVER_URL'] = 'http://127.0.0.1:%d' % cls.api_port
        # компания на сервере — как будто владелец прошёл онбординг
        cls.push('1:Owner', {
            'companies': [{'id': 'co_bot1', 'name': 'Бот-салон', 'short': 'Бот', 'cat': 'Барбершоп',
                           'color': '#4C6FFF', 'city': 'Алматы', 'addr': 'пр. Абая 1', 'phone': '+7 701 000 00 00',
                           'hours': HOURS, 'currency': '₸', 'plan': 'PRO'}],
            'employees': [{'id': 'co_bot1_owner', 'companyId': 'co_bot1', 'name': 'Тимур', 'role': 'Барбер',
                           'isOwner': True, 'active': True, 'schedule': HOURS, 'serviceIds': [],
                           'takesAppointments': True, 'access': 'owner'}],
            'services': [{'id': 's_cut', 'companyId': 'co_bot1', 'name': 'Стрижка', 'price': 6000, 'duration': 45,
                          'cat': 'bar', 'active': True, 'employeeIds': ['co_bot1_owner']}],
        })
        import importlib
        import bot as botmod
        cls.bot = importlib.reload(botmod)
        cls.bot.setup()

    @classmethod
    def tearDownClass(cls):
        cls.api.shutdown()
        cls.fake.shutdown()

    @classmethod
    def push(cls, user, upsert):
        req = urllib.request.Request('http://127.0.0.1:%d/api/v2/push' % cls.api_port, method='POST',
                                     data=json.dumps({'upsert': upsert, 'since': 0}).encode(),
                                     headers={'Content-Type': 'application/json', 'X-Dev-User': urllib.parse.quote(user)})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    # ---------------------------------------------------------------- помощники
    def sent(self, since=0):
        return [(m, b) for m, b in self.fake.calls[since:] if m in ('sendMessage', 'editMessageText')]

    def last_message(self):
        return self.sent()[-1][1]

    def buttons(self, body):
        return [b for row in body.get('reply_markup', {}).get('inline_keyboard', []) for b in row]

    def message(self, text, uid=555):
        self.bot.handle_message({'chat': {'id': uid}, 'from': {'id': uid, 'first_name': 'Арман', 'username': 'arman'},
                                 'text': text})

    def click(self, data, uid=555):
        self.bot.handle_callback({'id': 'q1', 'data': data, 'from': {'id': uid, 'first_name': 'Арман', 'username': 'arman'},
                                  'message': {'chat': {'id': uid}, 'message_id': 7}})

    def click_label(self, label_part, uid=555):
        btn = next(b for b in self.buttons(self.last_message()) if label_part in b['text'] and 'callback_data' in b)
        self.click(btn['callback_data'], uid)
        return btn

    # ---------------------------------------------------------------- тесты
    def test_01_setup_registered_commands_and_menu_button(self):
        methods = [m for m, _ in self.fake.calls]
        self.assertIn('setMyCommands', methods)
        self.assertIn('setChatMenuButton', methods)
        self.assertEqual(self.bot.BOT_USERNAME, 'testbot')

    def test_02_start_with_salon_link_shows_salon_menu(self):
        self.message('/start co_bot1_book')
        body = self.last_message()
        self.assertIn('Бот-салон', body['text'])
        labels = [b['text'] for b in self.buttons(body)]
        self.assertTrue(any('Записаться' in x for x in labels))
        self.assertTrue(any('Быстрая запись' in x for x in labels))
        web = [b for b in self.buttons(body) if 'web_app' in b]
        self.assertTrue(web and web[0]['web_app']['url'].endswith('start=co_bot1_book'))
        # сервер узнал человека и привязал к салону
        u = serve.STORE.user('555')
        self.assertEqual((u['name'], u['home']), ('Арман', 'co_bot1'))

    def test_03_quick_booking_in_chat_creates_server_appointment(self):
        self.click('bk::::')
        self.assertIn('Выберите услугу', self.last_message()['text'])
        self.click_label('Стрижка')
        body = self.last_message()
        self.assertIn('Выберите мастера', body['text'])
        self.click_label('Тимур')
        body = self.last_message()
        self.assertIn('Выберите день', body['text'])
        day_btn = next(b for b in self.buttons(body) if b['callback_data'].startswith('bk:') and '· нет' not in b['text'])
        self.click(day_btn['callback_data'])
        body = self.last_message()
        self.assertIn('Выберите время', body['text'])
        slot = next(b for b in self.buttons(body) if b['callback_data'].startswith('bk:'))
        self.click(slot['callback_data'])
        body = self.last_message()
        self.assertIn('Проверьте запись', body['text'])
        ok = next(b for b in self.buttons(body) if b['callback_data'].startswith('bkok:'))
        self.click(ok['callback_data'])
        body = self.last_message()
        self.assertIn('Вы записаны', body['text'])
        appts = serve.STORE.bodies('appointments', 'co_bot1')
        self.assertEqual(len(appts), 1)
        self.assertEqual((appts[0]['source'], appts[0]['price']), ('bot', 6000))
        cl = serve.STORE.body('clients', appts[0]['clientId'])
        self.assertEqual((cl['tgId'], cl['name'], cl['tg']), ('555', 'Арман', 'arman'))
        kinds = {n['kind'] for n in serve.STORE.notifications_for(ref=appts[0]['id'])}
        # владельцу — «новая запись», клиенту — просьба об отзыве; напоминание
        # за 2 часа ставится, только если до визита больше двух часов
        self.assertTrue({'new', 'review'} <= kinds, kinds)

    def test_04_second_person_cannot_take_the_same_slot(self):
        a = serve.STORE.bodies('appointments', 'co_bot1')[0]
        from datetime import date
        import slots
        tz = slots.tzinfo_for('Asia/Almaty')
        st = slots.parse_iso(a['start']).astimezone(tz)
        minute = st.hour * 60 + st.minute
        self.message('/start co_bot1', uid=777)
        self.click('bkok:0:0:%s:%d' % (st.date().isoformat(), minute), uid=777)
        body = self.last_message()
        self.assertIn('заняли', body['text'].lower() + body['text'])
        self.assertEqual(len(serve.STORE.bodies('appointments', 'co_bot1')), 1)

    def test_05_mine_and_cancel(self):
        self.click('mine')
        body = self.last_message()
        self.assertIn('Стрижка', body['text'])
        cancel = next(b for b in self.buttons(body) if b['callback_data'].startswith('cxl:'))
        self.click(cancel['callback_data'])
        body = self.last_message()
        self.assertIn('Запись отменена', body['text'])
        a = serve.STORE.bodies('appointments', 'co_bot1')[0]
        self.assertEqual((a['status'], a['cancelledBy']), ('cancelled', 'client'))
        # чужую запись отменить нельзя
        self.message('/start co_bot1', uid=777)
        self.click('cxl:' + a['id'], uid=777)
        self.assertIn('Не удалось отменить', self.last_message()['text'])

    def test_06_business_menu_follows_server_membership(self):
        self.message('/start owner', uid=1)        # владелец компании (dev-id 1)
        body = self.last_message()
        self.assertIn('Бот-салон', body['text'])
        labels = [b['text'] for b in self.buttons(body)]
        self.assertTrue(any('Открыть кабинет' in x for x in labels))
        self.message('/start owner', uid=4242)     # человек без компании
        body = self.last_message()
        self.assertIn('Бизнесу', body['text'])
        labels = [b['text'] for b in self.buttons(body)]
        self.assertTrue(any('Создать бизнес' in x for x in labels))
        self.assertFalse(any('демо' in x.lower() for x in labels))   # демо-салонов на сервере нет

    def test_07_unknown_company_link_still_opens_app(self):
        self.message('/start co_nope')
        body = self.last_message()
        self.assertIn('Страница записи', body['text'])
        self.assertTrue(any('web_app' in b for b in self.buttons(body)))

    def test_08_menu_without_company_has_no_salon_picker(self):
        self.message('/start', uid=8888)
        body = self.last_message()
        self.assertIn('Откройте ссылку своего салона', body['text'])
        labels = [b['text'] for b in self.buttons(body)]
        self.assertFalse(any('Выбрать салон' in x for x in labels))


if __name__ == '__main__':
    unittest.main()
