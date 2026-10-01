"""
Контекст запроса: correlation ID и кто его выполняет.

ТЗ 20.1: в каждой строке лога должен быть correlation ID, чтобы связать
запрос фронта, обработку в API и фоновую задачу. Держим в contextvars —
тогда логгеру и аудиту не нужно тащить request через все слои.
"""
from __future__ import annotations

import uuid
from contextvars import ContextVar
from dataclasses import dataclass

_correlation_id: ContextVar[str | None] = ContextVar('correlation_id', default=None)
_actor: ContextVar['Actor | None'] = ContextVar('actor', default=None)


@dataclass(frozen=True)
class Actor:
    """Кто делает действие. Для worker — kind='system'."""
    user_id: uuid.UUID | None
    kind: str = 'user'
    platform_role: str = 'none'
    company_id: uuid.UUID | None = None
    company_role: str | None = None

    @property
    def pseudonymous_id(self) -> str | None:
        """ТЗ 23.7: в аналитику и трекер ошибок уходит псевдоним, не ID пользователя."""
        if self.user_id is None:
            return None
        return uuid.uuid5(uuid.NAMESPACE_OID, f'zapis-actor:{self.user_id}').hex[:16]


def new_correlation_id() -> str:
    return uuid.uuid4().hex


def set_correlation_id(value: str | None) -> str:
    value = value or new_correlation_id()
    _correlation_id.set(value)
    return value


def get_correlation_id() -> str | None:
    return _correlation_id.get()


def set_actor(actor: Actor | None) -> None:
    _actor.set(actor)


def get_actor() -> Actor | None:
    return _actor.get()


SYSTEM_ACTOR = Actor(user_id=None, kind='system')
