"""
Ограничение частоты запросов (ТЗ 17.5).

Алгоритм — скользящее окно на секундных корзинах. Хранилище абстрагировано:
локально это память процесса, в staging/production — Redis, иначе каждый
экземпляр backend считал бы свой лимит и общий предел был бы в N раз выше.
"""
from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections import defaultdict, deque

from app.core.errors import RateLimited


class RateLimiterBackend(ABC):
    @abstractmethod
    async def hit(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        """Возвращает (разрешено, через сколько секунд пробовать снова)."""


class MemoryRateLimiter(RateLimiterBackend):
    """Годится для одного процесса: локальная разработка и тесты."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    async def hit(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.monotonic()
        bucket = self._hits[key]
        cutoff = now - window_seconds
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(1, int(window_seconds - (now - bucket[0])) + 1)
            return False, retry_after
        bucket.append(now)
        # Не даём словарю расти бесконечно на длинном процессе.
        if len(self._hits) > 50_000:
            for stale_key in [k for k, v in list(self._hits.items())[:1000] if not v]:
                self._hits.pop(stale_key, None)
        return True, 0


class RedisRateLimiter(RateLimiterBackend):
    """
    Общий счётчик для всех экземпляров. Реализация появится вместе с Redis
    в контуре; до этого конфигурация не пускает staging/production без
    REDIS_URL, так что молчаливой подмены на память не будет.
    """

    def __init__(self, client) -> None:  # noqa: ANN001
        self._client = client

    async def hit(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        pipe = self._client.pipeline()
        pipe.incr(key, 1)
        pipe.expire(key, window_seconds)
        count, _ = await pipe.execute()
        if int(count) > limit:
            ttl = await self._client.ttl(key)
            return False, max(1, int(ttl))
        return True, 0


_backend: RateLimiterBackend = MemoryRateLimiter()


def configure(backend: RateLimiterBackend) -> None:
    global _backend
    _backend = backend


def get_backend() -> RateLimiterBackend:
    return _backend


async def check(key: str, limit: int, window_seconds: int = 60) -> None:
    allowed, retry_after = await _backend.hit(key, limit, window_seconds)
    if not allowed:
        raise RateLimited(retry_after)
