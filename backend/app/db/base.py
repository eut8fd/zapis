"""
Подключение к БД и сессии.

ТЗ 10.2: backend stateless, PostgreSQL — единственный источник бизнес-данных.
Здесь только инфраструктура: engine, фабрика сессий и общий базовый класс.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, AsyncIterator

from sqlalchemy import MetaData, event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import Settings, get_settings
from app.db.types import GUID, UTCDateTime, new_uuid, utcnow

# Явные имена ограничений: без них Alembic на PostgreSQL не умеет их дропать
# по имени, и миграции вниз ломаются.
NAMING_CONVENTION = {
    'ix': 'ix_%(column_0_label)s',
    'uq': 'uq_%(table_name)s_%(column_0_name)s',
    'ck': 'ck_%(table_name)s_%(constraint_name)s',
    'fk': 'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s',
    'pk': 'pk_%(table_name)s',
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    def as_dict(self, *, exclude: set[str] | None = None) -> dict[str, Any]:
        exclude = exclude or set()
        out: dict[str, Any] = {}
        for column in self.__table__.columns:
            if column.name in exclude:
                continue
            value = getattr(self, column.name)
            if isinstance(value, uuid.UUID):
                value = str(value)
            elif isinstance(value, datetime):
                value = value.isoformat()
            out[column.name] = value
        return out


class UUIDPrimaryKey:
    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False,
    )


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _engine_kwargs(settings: Settings) -> dict[str, Any]:
    kwargs: dict[str, Any] = {'echo': settings.database_echo, 'future': True}
    if settings.is_postgres:
        kwargs.update(
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_pool_size,
            pool_pre_ping=True,
            pool_recycle=1800,
        )
    return kwargs


def create_engine(settings: Settings | None = None) -> AsyncEngine:
    settings = settings or get_settings()
    engine = create_async_engine(settings.database_url, **_engine_kwargs(settings))

    if engine.dialect.name == 'sqlite':
        # SQLite по умолчанию не проверяет внешние ключи — тесты пропустили бы
        # ровно те нарушения целостности, ради которых ключи и заведены.
        @event.listens_for(engine.sync_engine, 'connect')
        def _sqlite_pragmas(dbapi_connection, _record):  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            cursor.execute('PRAGMA foreign_keys=ON')
            cursor.close()
            # SQLite умеет приводить регистр только у ASCII: `lower('Витрина')`
            # там возвращает строку без изменений, и поиск по каталогу и CRM
            # молча перестаёт находить кириллицу. PostgreSQL это делает сам,
            # поэтому подменяем функцию, чтобы dev вёл себя как production.
            dbapi_connection.create_function('lower', 1, lambda v: v.lower() if v else v)
            dbapi_connection.create_function('upper', 1, lambda v: v.upper() if v else v)

    return engine


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_engine()
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            get_engine(), expire_on_commit=False, autoflush=False,
        )
    return _sessionmaker


def configure(engine: AsyncEngine) -> None:
    """Тесты подсовывают свой engine до старта приложения."""
    global _engine, _sessionmaker
    _engine = engine
    _sessionmaker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


async def session_scope() -> AsyncIterator[AsyncSession]:
    """FastAPI-зависимость: сессия на запрос, commit по успеху, rollback по ошибке."""
    async with get_sessionmaker()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def ping() -> bool:
    async with get_sessionmaker()() as session:
        await session.execute(text('SELECT 1'))
    return True
