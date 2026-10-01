"""
Клиент Telegram Bot API для worker.

Отдельный модуль, потому что весь разговор с Telegram должен идти в одном
месте: там же обрабатываются 429 с `retry_after`, временные 5xx и «бот
заблокирован пользователем» (ТЗ 15.2).
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.logging import get_logger

log = get_logger('zapis.telegram')

API_BASE = 'https://api.telegram.org'

#: Ошибки, после которых повторять бессмысленно: адресат недостижим
#: навсегда, и задача должна уйти в suppression, а не в retry.
PERMANENT_ERRORS = (
    'bot was blocked by the user',
    'user is deactivated',
    'chat not found',
    'peer_id_invalid',
    'bot can\'t initiate conversation',
)


@dataclass(frozen=True)
class SendResult:
    ok: bool
    permanent: bool = False
    retry_after: int | None = None
    error_code: str | None = None
    description: str | None = None


class TelegramClient:
    def __init__(self, token: str, *, timeout: float = 15.0) -> None:
        self._token = token
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> 'TelegramClient':
        self._client = httpx.AsyncClient(timeout=self._timeout)
        return self

    async def __aexit__(self, *_exc) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def send_message(
        self, chat_id: int, text: str, *, reply_markup: dict | None = None,
    ) -> SendResult:
        if self._client is None:
            raise RuntimeError('TelegramClient используется вне контекста')

        payload: dict = {
            'chat_id': chat_id,
            'text': text,
            'disable_web_page_preview': True,
        }
        if reply_markup:
            payload['reply_markup'] = reply_markup

        try:
            response = await self._client.post(
                f'{API_BASE}/bot{self._token}/sendMessage', json=payload,
            )
        except httpx.HTTPError as exc:
            # Сеть моргнула — это временная ошибка, задача вернётся в очередь.
            return SendResult(ok=False, error_code='network', description=str(exc)[:200])

        if response.status_code == 200:
            return SendResult(ok=True)

        body = _safe_json(response)
        description = str(body.get('description', ''))[:200]

        if response.status_code == 429:
            retry_after = int(body.get('parameters', {}).get('retry_after', 5))
            return SendResult(ok=False, retry_after=retry_after, error_code='429',
                              description=description)

        if response.status_code == 403 or _is_permanent(description):
            return SendResult(ok=False, permanent=True, error_code=str(response.status_code),
                              description=description)

        if response.status_code >= 500:
            return SendResult(ok=False, error_code=str(response.status_code),
                              description=description)

        # 400 обычно означает битый payload — повтор ничего не изменит.
        return SendResult(ok=False, permanent=True, error_code=str(response.status_code),
                          description=description)


def _safe_json(response: httpx.Response) -> dict:
    try:
        data = response.json()
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def _is_permanent(description: str) -> bool:
    lowered = description.lower()
    return any(marker in lowered for marker in PERMANENT_ERRORS)
