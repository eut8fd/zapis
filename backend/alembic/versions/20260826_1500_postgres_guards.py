"""postgres guards: exclusion constraint и append-only аудит

Эти гарантии специфичны для PostgreSQL и на других диалектах пропускаются:
локальная разработка на SQLite остаётся возможной, но production получает
защиту на уровне БД, а не только на уровне кода.

Revision ID: 8a1c4f3d9b21
Revises: 47bfe299fa92
Create Date: 2026-08-26 15:00:00.000000+00:00
"""
from __future__ import annotations

from typing import Sequence

from alembic import op

revision: str = '8a1c4f3d9b21'
down_revision: str | None = '47bfe299fa92'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Статусы, которые занимают время. Должны совпадать с
#: app.domain.BLOCKING_APPOINTMENT_STATUSES — расхождение здесь означало бы,
#: что БД и приложение считают занятость по-разному.
BLOCKING = "('pending_payment','confirmed','checked_in','completed')"


def upgrade() -> None:
    if op.get_bind().dialect.name != 'postgresql':
        return

    # btree_gist нужен, чтобы в одном GiST-индексе жили и равенство по UUID,
    # и пересечение диапазонов.
    op.execute('CREATE EXTENSION IF NOT EXISTS btree_gist')

    # APT-003: настоящая защита от двойной записи. Проверка в коде остаётся,
    # но именно этот constraint не даст гонке пройти даже при ошибке в коде.
    op.execute(f"""
        ALTER TABLE appointments
        ADD CONSTRAINT appointments_no_overlap
        EXCLUDE USING gist (
            employee_id WITH =,
            tstzrange(starts_at, ends_at) WITH &&
        )
        WHERE (status IN {BLOCKING})
    """)

    # Частичный индекс под самый горячий запрос: календарь на период.
    op.execute(f"""
        CREATE INDEX ix_appointments_active_window
        ON appointments (company_id, starts_at)
        WHERE status IN {BLOCKING}
    """)

    # ADM-005: журнал только дописывается. Права роли — второй рубеж,
    # но триггер работает независимо от того, под кем пришло подключение.
    op.execute("""
        CREATE OR REPLACE FUNCTION audit_events_append_only()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events доступен только на запись';
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER audit_events_no_update
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION audit_events_append_only()
    """)
    op.execute("""
        CREATE TRIGGER appointment_events_no_update
        BEFORE UPDATE OR DELETE ON appointment_events
        FOR EACH ROW EXECUTE FUNCTION audit_events_append_only()
    """)


def downgrade() -> None:
    if op.get_bind().dialect.name != 'postgresql':
        return

    op.execute('DROP TRIGGER IF EXISTS appointment_events_no_update ON appointment_events')
    op.execute('DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events')
    op.execute('DROP FUNCTION IF EXISTS audit_events_append_only()')
    op.execute('DROP INDEX IF EXISTS ix_appointments_active_window')
    op.execute('ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap')
