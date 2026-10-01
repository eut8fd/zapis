"""
Переносимые типы колонок.

Целевая СУБД — PostgreSQL (ТЗ 10.1). Но тесты и локальная разработка должны
запускаться там, где PostgreSQL не поставлен, поэтому каждый специфичный тип
имеет честный аналог: UUID -> CHAR(36), JSONB -> JSON, timestamptz -> UTC-naive.

Правило одно: в приложении время всегда aware и всегда UTC. Наивный datetime
в модель не попадает — иначе на SQLite и PostgreSQL получится разный смысл.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import CHAR, JSON, BigInteger, DateTime, Integer, TypeDecorator
from sqlalchemy.dialects import postgresql


class GUID(TypeDecorator):
    """UUID PostgreSQL, CHAR(36) везде ещё. В Python всегда uuid.UUID."""

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(postgresql.UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, uuid.UUID):
            value = uuid.UUID(str(value))
        if dialect.name == 'postgresql':
            return value
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


class JSONBType(TypeDecorator):
    """JSONB на PostgreSQL, JSON везде ещё."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(postgresql.JSONB())
        return dialect.type_descriptor(JSON())


class UTCDateTime(TypeDecorator):
    """
    timestamptz. Наивное время не принимаем: молчаливое приведение к серверной
    зоне — это ровно тот класс багов, который ТЗ 15.3 запрещает.
    """

    impl = DateTime
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(DateTime(timezone=True))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, datetime):
            raise TypeError(f'ожидался datetime, получено {type(value).__name__}')
        if value.tzinfo is None:
            raise ValueError('наивный datetime запрещён: время хранится в UTC с зоной')
        value = value.astimezone(timezone.utc)
        if dialect.name == 'postgresql':
            return value
        # SQLite хранит без зоны — записываем UTC и возвращаем зону при чтении.
        return value.replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class BigIntType(TypeDecorator):
    """BIGINT; на SQLite AUTOINCREMENT с BIGINT капризничает, поэтому INTEGER."""

    impl = BigInteger
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'sqlite':
            return dialect.type_descriptor(Integer())
        return dialect.type_descriptor(BigInteger())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()
