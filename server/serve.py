"""Статический сервер для Mini App. Без зависимостей."""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'webapp'))

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


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = MIME

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Access-Control-Allow-Origin', '*')
        # Mini App открывается во фрейме Telegram
        self.send_header('X-Frame-Options', 'ALLOWALL')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '"GET' in (fmt % args) and ' 200 ' in (fmt % args):
            return
        sys.stderr.write('%s\n' % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    print('webapp root :', ROOT)
    print('serving     : http://localhost:%d' % PORT)
    with Server(('0.0.0.0', PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')
