"""
Cursor-based pagination (ТЗ 12.1).

Курсор — это позиция последней отданной строки, а не номер страницы:
при вставке новых записей клиент не получает дублей и не теряет строки.
Подписываем, чтобы курсор нельзя было подменить на произвольный фильтр.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Any

from app.core.errors import ValidationFailed


def encode(payload: dict[str, Any], secret: str) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':'), default=str).encode('utf-8')
    signature = hmac.new(secret.encode('utf-8'), raw, hashlib.sha256).digest()[:12]
    return base64.urlsafe_b64encode(raw + b'.' + signature).decode('ascii').rstrip('=')


def decode(cursor: str | None, secret: str) -> dict[str, Any] | None:
    if not cursor:
        return None
    try:
        padding = '=' * (-len(cursor) % 4)
        blob = base64.urlsafe_b64decode(cursor + padding)
        raw, _, signature = blob.rpartition(b'.')
        expected = hmac.new(secret.encode('utf-8'), raw, hashlib.sha256).digest()[:12]
        if not hmac.compare_digest(expected, signature):
            raise ValueError('bad signature')
        return json.loads(raw)
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise ValidationFailed('Некорректный курсор', fields={'cursor': 'invalid'}) from exc
