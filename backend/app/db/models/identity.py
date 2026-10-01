"""Пользователи и сессии (ТЗ 11.1)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey
from app.db.types import GUID, BigIntType, JSONBType, UTCDateTime
from app.domain import PlatformRole, UserStatus


class User(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = 'users'

    telegram_user_id: Mapped[int] = mapped_column(BigIntType(), unique=True, nullable=False)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str | None] = mapped_column(String(128))
    last_name: Mapped[str | None] = mapped_column(String(128))
    language_code: Mapped[str] = mapped_column(String(8), default='ru', nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))

    status: Mapped[str] = mapped_column(String(16), default=UserStatus.ACTIVE, nullable=False)
    # ADM-001: платформенная роль живёт отдельно от ролей в компаниях и
    # не выводится из открытого флага на фронте (AUTH-010).
    platform_role: Mapped[str] = mapped_column(String(24), default=PlatformRole.NONE, nullable=False)

    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    sessions: Mapped[list['Session']] = relationship(back_populates='user', cascade='all, delete-orphan')

    @property
    def display_name(self) -> str:
        parts = [self.first_name, self.last_name]
        name = ' '.join(p for p in parts if p)
        return name or (f'@{self.username}' if self.username else f'id{self.telegram_user_id}')

    @property
    def is_active(self) -> bool:
        return self.status == UserStatus.ACTIVE and self.deleted_at is None


class Session(UUIDPrimaryKey, Base):
    """
    Серверная сессия (AUTH-004). Refresh-токен хранится только хэшем: утечка
    дампа не должна давать возможность войти.
    """
    __tablename__ = 'sessions'
    __table_args__ = (
        Index('ix_sessions_user_active', 'user_id', 'revoked_at'),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('users.id', ondelete='CASCADE'), nullable=False,
    )
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Ротация: каждая выдача нового refresh помечает предыдущий. Повторное
    # использование отозванного токена — сигнал компрометации.
    rotated_from_id: Mapped[uuid.UUID | None] = mapped_column(GUID())

    client: Mapped[str | None] = mapped_column(String(32))
    user_agent: Mapped[str | None] = mapped_column(String(256))
    ip_hash: Mapped[str | None] = mapped_column(String(64))

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    revoked_reason: Mapped[str | None] = mapped_column(String(64))

    user: Mapped[User] = relationship(back_populates='sessions')


class UserConsent(Base):
    """Согласия пользователя: коммуникации и юридические документы (ТЗ 18.3)."""
    __tablename__ = 'user_consents'

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    document_version: Mapped[str | None] = mapped_column(String(32))
    granted: Mapped[bool] = mapped_column(default=False, nullable=False)
    source: Mapped[str | None] = mapped_column(String(32))
    context: Mapped[dict | None] = mapped_column(JSONBType())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
