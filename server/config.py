"""
Конфигурация сервера: переменные окружения плюс `.env` в корне проекта.

Читается так же, как в боте: `.env` не затирает то, что уже задано снаружи
(Docker, Fly, systemd передают настройки окружением). Файл читаем как
utf-8-sig — BOM от чужого редактора не должен ломать первую строку.
"""
import os
import secrets

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))


def load_env(path=None):
    path = path or os.path.join(ROOT, '.env')
    if not os.path.exists(path):
        return
    with open(path, 'r', encoding='utf-8-sig') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            # хвостовой комментарий в .env.example: «PORT=8080  # порт»
            v = v.split(' #', 1)[0].strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)


load_env()


def env(name, default=''):
    return (os.environ.get(name) or default).strip()


def env_bool(name, default=False):
    v = env(name).lower()
    if not v:
        return default
    return v in ('1', 'true', 'yes', 'on')


def env_ids(name):
    return {x.strip() for x in env(name).replace(';', ',').split(',') if x.strip().isdigit()}


BOT_TOKEN = env('BOT_TOKEN')
WEBAPP_URL = env('WEBAPP_URL').rstrip('/')
BRAND = env('BRAND_NAME', 'Zapis') or 'Zapis'
ADMIN_TG_IDS = env_ids('ADMIN_TG_IDS')
# Зона по умолчанию для компаний без своей: все даты в базе — UTC, а людям
# показываем местное время салона.
TZ = env('TZ_DEFAULT') or env('TZ') or 'Asia/Almaty'
# Вход без Telegram (обычный браузер) — только для разработки и проверки.
# В бою выключен: иначе любой назовётся кем угодно.
DEV_AUTH = env_bool('DEV_AUTH', False)
# Бот ходит в сервер с этим токеном; пусто — внутренние маршруты закрыты.
INTERNAL_TOKEN = env('INTERNAL_TOKEN')
# Срок жизни initData. Telegram подписывает его при открытии приложения;
# приложение живёт в WebView часами, поэтому держим сутки, а не 5 минут.
AUTH_MAX_AGE = int(env('TELEGRAM_AUTH_MAX_AGE_SECONDS') or 86400)
# Инструкция по оплате — её владелец видит в «Подписке» вместо фиктивного платежа.
PAYMENT_NOTE = env('PAYMENT_NOTE')
SUPPORT_USERNAME = env('SUPPORT_USERNAME').lstrip('@')
DATA_DIR = env('DATA_DIR') or os.path.join(ROOT, '.run')
DB_PATH = env('DB_PATH') or os.path.join(DATA_DIR, 'zapis.db')
# Пока сервер держит AI-ключ у себя, приложению не нужно хранить его в браузере.
AI_PROVIDER_KEY = env('AI_PROVIDER_KEY')
AI_PROVIDER_URL = env('AI_PROVIDER_URL') or 'https://api.anthropic.com/v1/messages'
AI_MODEL = env('AI_MODEL') or 'claude-opus-5-5'
# Сколько дней после окончания подписки страница записи ещё принимает клиентов.
GRACE_DAYS = int(env('GRACE_DAYS') or 3)
TRIAL_DAYS = int(env('TRIAL_DAYS') or 14)


def internal_token():
    """Токен для бота. Если не задан, генерируем на время процесса и
    печатаем — на одной машине бот его подхватит из файла в DATA_DIR."""
    global INTERNAL_TOKEN
    if INTERNAL_TOKEN:
        return INTERNAL_TOKEN
    path = os.path.join(DATA_DIR, 'internal.token')
    try:
        with open(path, encoding='utf-8') as f:
            INTERNAL_TOKEN = f.read().strip()
    except OSError:
        INTERNAL_TOKEN = ''
    if not INTERNAL_TOKEN:
        INTERNAL_TOKEN = secrets.token_urlsafe(24)
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(INTERNAL_TOKEN)
        except OSError:
            pass
    return INTERNAL_TOKEN
