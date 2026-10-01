"""
Один контейнер — два процесса.

Боту нужен long polling: он висит всегда и ничего не слушает. Складу нужен
HTTP-порт: из него читает бот и в него пишет Mini App с GitHub Pages.
На хостинге дешевле держать их в одной машине, чем платить за две.

Если падает любой из двух — выходим целиком. Платформа перезапустит
контейнер, и мы не останемся с половиной работающего сервиса: молчащим
ботом при живом складе или наоборот.
"""
import os
import signal
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = os.environ.get('PORT', '8080')

procs = []


def spawn(name, args):
    print('запускаю: %s' % name, flush=True)
    p = subprocess.Popen([sys.executable, '-u'] + args, cwd=ROOT)
    procs.append((name, p))


def stop(*_):
    for name, p in procs:
        if p.poll() is None:
            p.terminate()
    # даём время закрыть файлы: склад пишет shared.json целиком
    for _, p in procs:
        try:
            p.wait(timeout=8)
        except Exception:
            p.kill()
    sys.exit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

spawn('склад', ['server/serve.py', PORT])
# складу нужно занять порт раньше, чем бот начнёт в него писать справочник
time.sleep(1.5)
spawn('бот', ['bot/bot.py'])

while True:
    for name, p in procs:
        code = p.poll()
        if code is not None:
            print('упал: %s (код %s) — выходим, платформа перезапустит'
                  % (name, code), flush=True)
            stop()
    time.sleep(2)
