"""
Структурные логи (ТЗ 20.1): JSON-строка на событие, с correlation ID
и без персональных данных.

Правило редакции простое: телефоны, тексты заметок, initData и payload
провайдера в лог не попадают. Всё, что похоже на секрет по имени поля,
заменяется на «***».
"""
from __future__ import annotations

import json
import logging
import sys
from typing import Any

from app.core.context import get_actor, get_correlation_id

REDACTED = '***'
SENSITIVE_KEYS = frozenset({
    'token', 'access_token', 'refresh_token', 'init_data', 'initdata', 'password',
    'secret', 'authorization', 'signature', 'phone', 'phone_raw', 'payload',
    'api_key', 'card', 'body', 'comment', 'note',
})

_RESERVED = frozenset(logging.LogRecord('', 0, '', 0, '', (), None).__dict__) | {
    'asctime', 'message', 'taskName',
}


def redact(value: Any, key: str | None = None) -> Any:
    if key and key.lower() in SENSITIVE_KEYS:
        return REDACTED
    if isinstance(value, dict):
        return {k: redact(v, k) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            'ts': self.formatTime(record, '%Y-%m-%dT%H:%M:%S%z'),
            'level': record.levelname.lower(),
            'logger': record.name,
            'message': record.getMessage(),
        }

        correlation_id = get_correlation_id()
        if correlation_id:
            payload['correlation_id'] = correlation_id

        actor = get_actor()
        if actor is not None:
            payload['actor'] = actor.pseudonymous_id or actor.kind
            if actor.company_id:
                payload['company_id'] = str(actor.company_id)

        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith('_'):
                continue
            payload[key] = redact(value, key)

        if record.exc_info:
            payload['exception'] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = 'INFO', *, json_output: bool = True) -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter() if json_output
        else logging.Formatter('%(asctime)s %(levelname)-7s %(name)s: %(message)s')
    )
    root.addHandler(handler)
    root.setLevel(level.upper())

    # uvicorn.access дублирует наш access-лог с другим форматом — глушим.
    logging.getLogger('uvicorn.access').handlers.clear()
    logging.getLogger('uvicorn.access').propagate = False
    logging.getLogger('uvicorn.error').handlers.clear()
    logging.getLogger('uvicorn.error').propagate = True

    # На DEBUG драйвер БД пишет по строке на каждую операцию: за час
    # простоя worker набивает мегабайты, в которых не видно своих событий.
    #
    # Именно WARNING, а не INFO: SQLAlchemy решает, печатать ли SQL, по
    # эффективному уровню своего логгера — выставив ему INFO, мы бы
    # включили эхо запросов вместо того, чтобы его выключить.
    for noisy in ('aiosqlite', 'asyncio', 'sqlalchemy.engine', 'sqlalchemy.pool',
                  'httpx', 'httpcore', 'multipart'):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
