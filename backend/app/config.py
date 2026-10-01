"""
Типизированная конфигурация. ТЗ 22.5: приложение читает настройки только
из окружения, секреты не лежат в репозитории, а неверная конфигурация
production валит запуск, а не всплывает потом в рантайме.

Почему не pydantic-settings: у проекта принцип «минимум зависимостей», а
здесь нужна ровно валидация при старте. Свой парсер короче и явнее.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

ENVIRONMENTS = ('local', 'test', 'staging', 'production')

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class ConfigError(RuntimeError):
    """Конфигурация непригодна для запуска — падаем сразу, а не при первом запросе."""


# --------------------------------------------------------------------- парсеры

def _raw(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None:
        return default
    v = v.strip()
    return v if v else default


def _bool(name: str, default: bool) -> bool:
    v = _raw(name)
    if v is None:
        return default
    return v.lower() in ('1', 'true', 'yes', 'on')


def _int(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    v = _raw(name)
    if v is None:
        return default
    try:
        n = int(v)
    except ValueError as exc:
        raise ConfigError(f'{name} должен быть целым числом, получено {v!r}') from exc
    if minimum is not None and n < minimum:
        raise ConfigError(f'{name} не может быть меньше {minimum}')
    if maximum is not None and n > maximum:
        raise ConfigError(f'{name} не может быть больше {maximum}')
    return n


def _list(name: str, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    v = _raw(name)
    if v is None:
        return default
    return tuple(p.strip() for p in v.split(',') if p.strip())


def load_dotenv(path: Path | None = None) -> None:
    """
    Подхватываем .env для локального запуска. utf-8-sig: BOM в .env появляется
    от сторонних редакторов на Windows и ломает первую переменную (CLAUDE.md).
    Уже выставленные переменные окружения имеют приоритет.
    """
    path = path or (REPO_DIR / '.env')
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, sep, value = line.partition('=')
        if not sep:
            continue
        key = key.strip()
        value = value.split('#', 1)[0].strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


# ---------------------------------------------------------------- сама настройка

@dataclass(frozen=True)
class Settings:
    env: str
    debug: bool
    release: str

    database_url: str
    database_pool_size: int
    database_echo: bool

    redis_url: str | None

    telegram_bot_token: str
    telegram_bot_username: str
    telegram_webhook_secret: str | None
    # AUTH-003: срок жизни initData задаётся конфигурацией и не превышает 15 минут.
    telegram_auth_max_age_seconds: int

    session_secret: str
    access_token_ttl_seconds: int
    refresh_token_ttl_seconds: int

    public_base_url: str
    webapp_url: str
    cors_origins: tuple[str, ...]
    expose_api_docs: bool

    rate_limit_anonymous_per_minute: int
    rate_limit_user_per_minute: int
    rate_limit_auth_per_minute: int

    booking_horizon_days: int
    booking_lead_time_minutes: int
    slot_step_minutes: int

    ai_provider_url: str | None
    ai_provider_key: str | None
    ai_model: str

    media_root: Path
    media_max_bytes: int

    payment_provider: str
    payment_webhook_secret: str | None

    # --- локальная песочница ---
    # Вход без Telegram и доставка уведомлений «на экран» вместо Bot API.
    # Оба флага работают только при APP_ENV=local: валидация ниже не даёт
    # запустить с ними staging или production, даже если кто-то их выставил.
    dev_auth_enabled: bool = False
    notify_transport: str = 'telegram'
    sandbox_inbox_path: Path = field(default=REPO_DIR / '.run' / 'sandbox-inbox.jsonl')

    admin_bootstrap_telegram_ids: tuple[int, ...] = field(default=())

    # ------------------------------------------------------------- производное
    @property
    def is_production(self) -> bool:
        return self.env == 'production'

    @property
    def is_test(self) -> bool:
        return self.env == 'test'

    @property
    def db_dialect(self) -> str:
        return self.database_url.split(':', 1)[0].split('+', 1)[0]

    @property
    def is_postgres(self) -> bool:
        return self.db_dialect in ('postgresql', 'postgres')


def _default_database_url(env: str) -> str:
    # Локально и в тестах PostgreSQL может не стоять; production обязан задать URL явно.
    if env == 'test':
        return 'sqlite+aiosqlite:///:memory:'
    return f'sqlite+aiosqlite:///{(REPO_DIR / ".run" / "zapis.db").as_posix()}'


def build_settings() -> Settings:
    load_dotenv()

    env = (_raw('APP_ENV', 'local') or 'local').lower()
    if env not in ENVIRONMENTS:
        raise ConfigError(f'APP_ENV должен быть одним из {ENVIRONMENTS}, получено {env!r}')

    database_url = _raw('DATABASE_URL') or _default_database_url(env)
    telegram_bot_token = _raw('BOT_TOKEN', '') or ''
    session_secret = _raw('SESSION_SECRET', '') or ''

    settings = Settings(
        env=env,
        debug=_bool('DEBUG', env in ('local', 'test')),
        release=_raw('RELEASE', 'dev') or 'dev',

        database_url=database_url,
        database_pool_size=_int('DATABASE_POOL_SIZE', 10, minimum=1, maximum=100),
        database_echo=_bool('DATABASE_ECHO', False),

        redis_url=_raw('REDIS_URL'),

        telegram_bot_token=telegram_bot_token,
        telegram_bot_username=_raw('BOT_USERNAME', '') or '',
        telegram_webhook_secret=_raw('TELEGRAM_WEBHOOK_SECRET'),
        telegram_auth_max_age_seconds=_int('TELEGRAM_AUTH_MAX_AGE_SECONDS', 300, minimum=30, maximum=900),

        session_secret=session_secret,
        access_token_ttl_seconds=_int('ACCESS_TOKEN_TTL_SECONDS', 900, minimum=60, maximum=3600),
        refresh_token_ttl_seconds=_int('REFRESH_TOKEN_TTL_SECONDS', 30 * 24 * 3600, minimum=3600),

        public_base_url=(_raw('PUBLIC_BASE_URL', 'http://localhost:8000') or '').rstrip('/'),
        webapp_url=(_raw('WEBAPP_URL', '') or '').rstrip('/'),
        cors_origins=_list('CORS_ORIGINS'),
        expose_api_docs=_bool('EXPOSE_API_DOCS', env != 'production'),

        rate_limit_anonymous_per_minute=_int('RATE_LIMIT_ANON_PER_MIN', 60, minimum=1),
        rate_limit_user_per_minute=_int('RATE_LIMIT_USER_PER_MIN', 240, minimum=1),
        rate_limit_auth_per_minute=_int('RATE_LIMIT_AUTH_PER_MIN', 20, minimum=1),

        booking_horizon_days=_int('BOOKING_HORIZON_DAYS', 90, minimum=1, maximum=365),
        booking_lead_time_minutes=_int('BOOKING_LEAD_TIME_MINUTES', 60, minimum=0),
        slot_step_minutes=_int('SLOT_STEP_MINUTES', 30, minimum=5, maximum=240),

        ai_provider_url=_raw('AI_PROVIDER_URL'),
        ai_provider_key=_raw('AI_PROVIDER_KEY'),
        ai_model=_raw('AI_MODEL', 'claude-sonnet-5') or 'claude-sonnet-5',

        media_root=Path(_raw('MEDIA_ROOT', str(REPO_DIR / '.run' / 'media')) or ''),
        media_max_bytes=_int('MEDIA_MAX_BYTES', 8 * 1024 * 1024, minimum=1024),

        payment_provider=_raw('PAYMENT_PROVIDER', 'none') or 'none',
        payment_webhook_secret=_raw('PAYMENT_WEBHOOK_SECRET'),

        dev_auth_enabled=_bool('DEV_AUTH_ENABLED', False),
        notify_transport=(_raw('NOTIFY_TRANSPORT', 'telegram') or 'telegram').lower(),
        sandbox_inbox_path=Path(
            _raw('SANDBOX_INBOX_PATH', str(REPO_DIR / '.run' / 'sandbox-inbox.jsonl')) or ''
        ),

        admin_bootstrap_telegram_ids=tuple(
            int(x) for x in _list('ADMIN_TG_IDS') if x.lstrip('-').isdigit()
        ),
    )

    _validate(settings)
    return settings


def _validate(s: Settings) -> None:
    problems: list[str] = []

    # В песочнице Telegram не участвует вовсе: ни входа, ни отправки.
    telegram_needed = not s.is_test and not (s.dev_auth_enabled and s.notify_transport == 'local')
    if telegram_needed and not s.telegram_bot_token:
        problems.append('BOT_TOKEN обязателен: без него нельзя проверить подпись initData (AUTH-002)')

    if s.notify_transport not in ('telegram', 'local'):
        problems.append("NOTIFY_TRANSPORT должен быть 'telegram' или 'local'")

    if not s.session_secret:
        if s.env in ('staging', 'production'):
            problems.append('SESSION_SECRET обязателен вне локальной разработки')
    elif len(s.session_secret) < 32 and s.env in ('staging', 'production'):
        problems.append('SESSION_SECRET должен быть не короче 32 символов')

    if s.env != 'local':
        # Самая опасная строчка конфигурации: вход без Telegram. Пусть
        # приложение лучше не поднимется, чем поднимется с открытой дверью.
        if s.dev_auth_enabled:
            problems.append('DEV_AUTH_ENABLED допустим только при APP_ENV=local')
        if s.notify_transport == 'local':
            problems.append('NOTIFY_TRANSPORT=local допустим только при APP_ENV=local')

    if s.env in ('staging', 'production'):
        if not s.is_postgres:
            problems.append('DATABASE_URL должен указывать на PostgreSQL: ТЗ 10.2 — единственный источник истины')
        if not s.public_base_url.startswith('https://'):
            problems.append('PUBLIC_BASE_URL должен быть https')
        if s.expose_api_docs and s.is_production:
            problems.append('EXPOSE_API_DOCS=true в production запрещён (ТЗ 24.2)')
        if not s.redis_url:
            problems.append('REDIS_URL обязателен вне локальной разработки: rate limit и координация worker')

    if s.telegram_auth_max_age_seconds > 900:
        problems.append('TELEGRAM_AUTH_MAX_AGE_SECONDS не может превышать 900 (AUTH-003)')

    if problems:
        raise ConfigError('Конфигурация непригодна:\n  - ' + '\n  - '.join(problems))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return build_settings()


def reset_settings_cache() -> None:
    """Нужен тестам: они меняют окружение между кейсами."""
    get_settings.cache_clear()
