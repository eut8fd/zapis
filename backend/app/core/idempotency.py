"""
Idempotency-Key для критичных POST (ТЗ 12.1).

Смысл: клиент нажал «Записаться», сеть моргнула, приложение повторило
запрос. Второй записи быть не должно, а ответ должен прийти тот же.

Тот же ключ с другим телом — не повтор, а ошибка клиента: возвращаем 409,
иначе можно было бы подменить содержимое уже подтверждённой операции.
"""
from __future__ import annotations

import json
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import IdempotencyConflict
from app.core.security import sha256_hex
from app.db.models import IdempotencyRecord
from app.db.types import new_uuid, utcnow

RETENTION = timedelta(hours=24)


def digest(payload: Any) -> str:
    return sha256_hex(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str))


async def begin(
    session: AsyncSession, scope: str, key: str, payload: Any,
) -> dict[str, Any] | None:
    """
    Регистрирует ключ. Возвращает сохранённый ответ, если операция уже
    выполнялась, иначе None — можно выполнять.
    """
    request_digest = digest(payload)
    existing = await session.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.scope == scope, IdempotencyRecord.key == key,
        )
    )
    if existing is not None:
        if existing.request_digest != request_digest:
            raise IdempotencyConflict()
        if existing.expires_at <= utcnow():
            await session.delete(existing)
            await session.flush()
        else:
            return existing.response_body or {}

    record = IdempotencyRecord(
        id=new_uuid(),
        scope=scope,
        key=key,
        request_digest=request_digest,
        created_at=utcnow(),
        expires_at=utcnow() + RETENTION,
    )
    session.add(record)
    try:
        await session.flush()
    except IntegrityError:
        # Два одновременных запроса с одним ключом: второй ждёт результата
        # первого. Отдаём конфликт — клиент повторит и получит готовый ответ.
        await session.rollback()
        raise IdempotencyConflict(
            'Запрос с этим ключом уже выполняется, повторите через мгновение'
        ) from None
    return None


async def finish(
    session: AsyncSession, scope: str, key: str, status_code: int, body: dict[str, Any],
) -> None:
    record = await session.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.scope == scope, IdempotencyRecord.key == key,
        )
    )
    if record is not None:
        record.response_status = status_code
        record.response_body = json.loads(json.dumps(body, default=str))


async def release(session: AsyncSession, scope: str, key: str) -> None:
    """
    Операция упала — ключ надо освободить, иначе повтор навсегда упрётся
    в пустую запись и клиент не сможет попробовать ещё раз.
    """
    await session.execute(
        delete(IdempotencyRecord).where(
            IdempotencyRecord.scope == scope,
            IdempotencyRecord.key == key,
            IdempotencyRecord.response_status.is_(None),
        )
    )


def scope_for(name: str, *parts: uuid.UUID | str | None) -> str:
    return ':'.join([name, *[str(p) for p in parts if p is not None]])[:96]


async def purge_expired(session: AsyncSession) -> int:
    result = await session.execute(
        delete(IdempotencyRecord).where(IdempotencyRecord.expires_at <= utcnow())
    )
    return result.rowcount or 0
