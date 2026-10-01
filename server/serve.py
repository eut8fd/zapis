"""
Статический сервер для Mini App плюс маленькое общее хранилище.

Зачем хранилище. У бота была своя база (`bot/bookings.json`, услуги по номеру
в списке), у Mini App — `localStorage` браузера. Они не знали друг о друге:
бот видел три салона из одиннадцати, а напоминания уходили только по записям
из чата, хотя интерфейс обещал их всем.

Теперь Mini App выкладывает сюда справочник (компании, услуги, мастера,
часы), а бот его читает. Записи складываются в общий список в формате
приложения — с настоящими идентификаторами услуг, а не порядковыми номерами.

Формат хранения — один JSON-файл `.run/shared.json`. Для демо этого хватает:
писателей единицы, а зависимостей у проекта нет и не будет.

Без зависимостей.
"""
import http.server
import json
import os
import socketserver
import sys
import threading
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'webapp'))
RUN = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.run'))
STORE = os.path.join(RUN, 'shared.json')

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

# Пишем под замком: сервер многопоточный, а файл один.
LOCK = threading.Lock()
EMPTY = {'catalog': None, 'appointments': [], 'invites': [], 'updatedAt': 0}


def read_store():
    try:
        with open(STORE, encoding='utf-8-sig') as f:
            data = json.load(f)
        for k, v in EMPTY.items():
            data.setdefault(k, v)
        return data
    except Exception:                      # noqa: BLE001 — файла ещё нет или он битый
        return dict(EMPTY)


def write_store(data):
    os.makedirs(RUN, exist_ok=True)
    data['updatedAt'] = int(time.time())
    tmp = STORE + '.tmp'
    # Пишем через временный файл: бот читает этот же файл, и застать его
    # наполовину записанным он не должен.
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, STORE)
    return data


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = MIME
    # HTTP/1.1 вместо умолчательного 1.0. При 1.0 сервер закрывает соединение
    # после каждого ответа, а браузер продолжает считать его живым и шлёт
    # в него следующий запрос — тот умирает с ERR_EMPTY_RESPONSE. На старте
    # приложение отправляет справочник и забирает записи одновременно, и
    # ронялся как раз справочник: бот оставался со старым списком салонов,
    # а записи из Mini App до него не доходили.
    protocol_version = 'HTTP/1.1'

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # ---------------------------------------------------------------- служебное
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Mini App открывается во фрейме Telegram
        self.send_header('X-Frame-Options', 'ALLOWALL')
        super().end_headers()

    def log_message(self, fmt, *args):
        line = fmt % args
        if '"GET' in line and ' 200 ' in line:
            return
        sys.stderr.write('%s\n' % line)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if not n:
            return None
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:                  # noqa: BLE001
            return None

    # ---------------------------------------------------------------- маршруты
    def do_OPTIONS(self):                  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def do_GET(self):                      # noqa: N802
        if self.path.startswith('/api/'):
            return self._api_get()
        return super().do_GET()

    def _api_get(self):
        data = read_store()
        if self.path.startswith('/api/catalog'):
            return self._json({'catalog': data['catalog'], 'updatedAt': data['updatedAt']})
        if self.path.startswith('/api/appointments'):
            return self._json({'appointments': data['appointments'], 'updatedAt': data['updatedAt']})
        if self.path.startswith('/api/invites'):
            return self._json({'invites': data['invites'], 'updatedAt': data['updatedAt']})
        if self.path.startswith('/api/state'):
            return self._json(data)
        return self._json({'error': 'unknown endpoint'}, 404)

    def do_PUT(self):                      # noqa: N802
        # Тело читаем до любых проверок: при keep-alive непрочитанные байты
        # достаются следующему запросу и ломают соединение.
        body = self._body()
        if not self.path.startswith('/api/catalog'):
            return self._json({'error': 'unknown endpoint'}, 404)
        if not isinstance(body, dict) or 'catalog' not in body:
            return self._json({'error': 'catalog expected'}, 400)
        with LOCK:
            data = read_store()
            data['catalog'] = body['catalog']
            write_store(data)
        return self._json({'ok': True})

    # Записи и приглашения кладутся одинаково: добавить или заменить по id.
    LISTS = {'/api/appointments': ('appointments', 2000),
             '/api/invites': ('invites', 500)}

    def _list_for(self, path):
        for prefix, (key, cap) in self.LISTS.items():
            if path.startswith(prefix):
                return key, cap
        return None, 0

    def do_POST(self):                     # noqa: N802
        body = self._body()
        key, cap = self._list_for(self.path)
        if not key:
            return self._json({'error': 'unknown endpoint'}, 404)
        if not isinstance(body, dict) or not body.get('id'):
            return self._json({'error': 'record with id expected'}, 400)
        with LOCK:
            data = read_store()
            rest = [a for a in data[key] if a.get('id') != body['id']]
            rest.append(body)
            # Список не растёт бесконечно: демо живёт неделями, а не годами.
            data[key] = rest[-cap:]
            write_store(data)
        return self._json({'ok': True, 'id': body['id']})

    def do_PATCH(self):                    # noqa: N802
        body = self._body() or {}
        key, _ = self._list_for(self.path)
        if not key or self.path.rstrip('/').count('/') < 3:
            return self._json({'error': 'unknown endpoint'}, 404)
        aid = self.path.rsplit('/', 1)[-1].split('?')[0]
        with LOCK:
            data = read_store()
            found = None
            for a in data[key]:
                if a.get('id') == aid:
                    a.update(body)
                    found = a
            if found is None:
                return self._json({'error': 'not found'}, 404)
            write_store(data)
        return self._json({'ok': True})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    print('webapp root :', ROOT)
    print('общий склад :', STORE)
    print('serving     : http://localhost:%d' % PORT)
    with Server(('0.0.0.0', PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')
