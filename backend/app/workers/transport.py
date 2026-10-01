"""
Куда worker отдаёт готовое сообщение.

Планирование, повторы, backoff, DLQ и отмена устаревших задач одинаковы
всегда — меняется только последняя миля. В production это Bot API, в
локальной песочнице сообщение кладётся в файл и показывается на экране.
Так поведение очереди можно проверить целиком, не заводя бота.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Protocol

from app.config import Settings
from app.core.logging import get_logger
from app.db.types import utcnow
from app.workers.telegram import SendResult, TelegramClient

log = get_logger('zapis.transport')


class Transport(Protocol):
    async def send_message(self, chat_id: int, text: str, **kwargs) -> SendResult: ...


class LocalInboxTransport:
    """
    Доставка «на экран»: сообщение дописывается в JSONL, консоль песочницы
    его читает. Файл, а не таблица — чтобы боевая схема БД не обрастала
    тем, чего в production не будет.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    async def __aenter__(self) -> 'LocalInboxTransport':
        return self

    async def __aexit__(self, *_exc) -> None:
        return None

    async def send_message(self, chat_id: int, text: str, **_kwargs) -> SendResult:
        record = {
            'at': utcnow().isoformat(),
            'to': int(chat_id),
            'text': text,
        }
        line = json.dumps(record, ensure_ascii=False)
        with self._lock:
            with self._path.open('a', encoding='utf-8') as f:
                f.write(line + '\n')
        log.info('inbox.delivered', extra={'to': int(chat_id)})
        return SendResult(ok=True)


def build(settings: Settings) -> Transport:
    if settings.notify_transport == 'local':
        return LocalInboxTransport(settings.sandbox_inbox_path)
    return TelegramClient(settings.telegram_bot_token)


def read_inbox(path: Path, *, recipient: int | None = None, limit: int = 200) -> list[dict]:
    """Прочитать доставленные сообщения. Битые строки пропускаем молча."""
    if not path.exists():
        return []
    out: list[dict] = []
    with path.open(encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except ValueError:
                continue
            if recipient is not None and int(item.get('to', 0)) != int(recipient):
                continue
            out.append(item)
    return out[-limit:]


def clear_inbox(path: Path) -> None:
    if path.exists():
        path.unlink()
