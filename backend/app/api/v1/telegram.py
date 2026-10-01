"""
Приём Telegram webhook (ТЗ 9.1, 9.2).

Обработчик делает ровно две вещи: проверяет, что update действительно от
Telegram, и кладёт его в inbox. Разбор идёт отдельно и идемпотентно по
`update_id` — повторная доставка не создаёт вторую запись и не шлёт
второе сообщение.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, Path, Request, Response, status

from app.api.deps import AppSettings, DbSession
from app.core.errors import Unauthorized
from app.core.logging import get_logger
from app.core.security import constant_time_equals
from app.services import outbox

log = get_logger('zapis.telegram.webhook')

router = APIRouter(tags=['telegram'])


@router.post('/telegram/webhook/{secret_path}', status_code=status.HTTP_200_OK)
async def telegram_webhook(
    secret_path: Annotated[str, Path(min_length=16, max_length=128)],
    request: Request,
    session: DbSession,
    settings: AppSettings,
    secret_header: Annotated[str | None, Header(alias='X-Telegram-Bot-Api-Secret-Token')] = None,
) -> Response:
    """
    Два рубежа сразу: секрет в пути и заголовок Telegram. Второй появился
    в Bot API позже, поэтому он проверяется, только если настроен.
    """
    expected = settings.telegram_webhook_secret
    if not expected:
        # Не сконфигурировано — принимать анонимные update нельзя.
        raise Unauthorized('Webhook не настроен', code='webhook_disabled')
    if not constant_time_equals(secret_path, expected):
        log.warning('telegram.webhook_bad_path')
        raise Unauthorized('Некорректный webhook', code='webhook_forbidden')
    if secret_header is not None and not constant_time_equals(secret_header, expected):
        log.warning('telegram.webhook_bad_header')
        raise Unauthorized('Некорректный webhook', code='webhook_forbidden')

    payload: dict[str, Any] = await request.json()
    update_id = payload.get('update_id')
    if update_id is None:
        # Битый update молча подтверждаем: Telegram иначе будет слать его вечно.
        return Response(status_code=status.HTTP_200_OK)

    # ТЗ 9.1: обработка идемпотентна по update_id. Повтор — не ошибка.
    event = await outbox.accept_inbound(session, 'telegram', str(update_id), payload)
    await session.commit()

    if event is None:
        log.info('telegram.duplicate_update', extra={'update_id': update_id})
    return Response(status_code=status.HTTP_200_OK)
