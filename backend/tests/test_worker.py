"""
Worker уведомлений (ТЗ 15.2).

Проверяем ровно то, что ТЗ называет надёжностью: успех только после
ответа провайдера, уважение `retry_after`, backoff, DLQ, suppression и
восстановление после перезапуска посреди отправки.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
import sqlalchemy as sa

from app.db.models import NotificationJob, SuppressionEntry
from app.db.types import new_uuid, utcnow
from app.domain import NotificationStatus
from app.services import notifications
from app.workers import notifier
from app.workers.telegram import SendResult

pytestmark = pytest.mark.asyncio


class FakeTelegram:
    """Подменяет Bot API: тест не должен ходить в сеть."""

    def __init__(self, *results: SendResult) -> None:
        self.results = list(results)
        self.sent: list[tuple[int, str]] = []

    async def send_message(self, chat_id: int, text: str, **_kw) -> SendResult:
        self.sent.append((chat_id, text))
        return self.results.pop(0) if self.results else SendResult(ok=True)


async def _job(sessionmaker, *, template='appointment_reminder', scheduled_at=None,
               telegram_id=555001, payload=None) -> uuid.UUID:
    async with sessionmaker() as session:
        job = NotificationJob(
            id=new_uuid(), company_id=None, template=template, locale='ru',
            payload=payload or {'title': 'Стрижка', 'date': '1 сентября', 'time': '11:00'},
            recipient_telegram_id=telegram_id,
            scheduled_at=scheduled_at or utcnow(),
            next_attempt_at=scheduled_at or utcnow(),
            status=NotificationStatus.PENDING,
            idempotency_key=uuid.uuid4().hex,
            created_at=utcnow(),
        )
        session.add(job)
        await session.commit()
        return job.id


async def _reload(sessionmaker, job_id: uuid.UUID) -> NotificationJob:
    async with sessionmaker() as session:
        return await session.get(NotificationJob, job_id)


async def test_successful_send_marks_job_sent(engine, sessionmaker):
    job_id = await _job(sessionmaker)
    telegram = FakeTelegram(SendResult(ok=True))

    async with sessionmaker() as session:
        sent = await notifier.process_notifications(session, telegram, 'w1')

    assert sent == 1
    assert len(telegram.sent) == 1
    job = await _reload(sessionmaker, job_id)
    assert job.status == NotificationStatus.SENT
    assert job.sent_at is not None


async def test_future_job_is_not_picked_up(engine, sessionmaker):
    """Напоминание за сутки не должно уйти сразу после записи."""
    await _job(sessionmaker, scheduled_at=utcnow() + timedelta(hours=5))
    telegram = FakeTelegram()

    async with sessionmaker() as session:
        sent = await notifier.process_notifications(session, telegram, 'w1')

    assert sent == 0
    assert telegram.sent == []


async def test_rate_limit_respects_retry_after(engine, sessionmaker):
    job_id = await _job(sessionmaker)
    telegram = FakeTelegram(SendResult(ok=False, retry_after=42, error_code='429'))

    async with sessionmaker() as session:
        await notifier.process_notifications(session, telegram, 'w1')

    job = await _reload(sessionmaker, job_id)
    assert job.status == NotificationStatus.RETRY
    delay = (job.next_attempt_at - utcnow()).total_seconds()
    assert 35 < delay <= 45, 'должен использоваться retry_after провайдера'


async def test_temporary_error_uses_backoff(engine, sessionmaker):
    job_id = await _job(sessionmaker)
    telegram = FakeTelegram(SendResult(ok=False, error_code='500'))

    async with sessionmaker() as session:
        await notifier.process_notifications(session, telegram, 'w1')

    job = await _reload(sessionmaker, job_id)
    assert job.status == NotificationStatus.RETRY
    assert job.attempt_count == 1
    assert job.next_attempt_at > utcnow()


async def test_blocked_bot_goes_to_suppression(engine, sessionmaker):
    """MSG-002: заблокировавший бота человек больше не получает попыток."""
    job_id = await _job(sessionmaker, telegram_id=555002)
    telegram = FakeTelegram(SendResult(
        ok=False, permanent=True, error_code='403', description='bot was blocked by the user',
    ))

    async with sessionmaker() as session:
        await notifier.process_notifications(session, telegram, 'w1')

    job = await _reload(sessionmaker, job_id)
    assert job.status == NotificationStatus.FAILED

    async with sessionmaker() as session:
        entries = (await session.execute(
            sa.select(SuppressionEntry).where(SuppressionEntry.telegram_user_id == 555002)
        )).scalars().all()
    assert len(entries) == 1

    # Следующая задача тому же адресату даже не пытается уйти.
    await _job(sessionmaker, telegram_id=555002)
    second = FakeTelegram(SendResult(ok=True))
    async with sessionmaker() as session:
        await notifier.process_notifications(session, second, 'w1')
    assert second.sent == []


async def test_job_reaches_dead_letter_after_max_attempts(engine, sessionmaker):
    """ТЗ 15.2: после лимита попыток задача остаётся failed — это и есть DLQ."""
    job_id = await _job(sessionmaker)
    async with sessionmaker() as session:
        job = await session.get(NotificationJob, job_id)
        job.attempt_count = notifier.MAX_ATTEMPTS - 1
        await session.commit()

    telegram = FakeTelegram(SendResult(ok=False, error_code='500'))
    async with sessionmaker() as session:
        await notifier.process_notifications(session, telegram, 'w1')

    job = await _reload(sessionmaker, job_id)
    assert job.status == NotificationStatus.FAILED
    assert job.attempt_count == notifier.MAX_ATTEMPTS


async def test_restart_recovers_jobs_stuck_in_processing(engine, sessionmaker):
    """
    Exit criteria Этапа 3: перезапуск посреди отправки не теряет задачу.
    Имитируем падение — задача осталась в processing со старым замком.
    """
    job_id = await _job(sessionmaker)
    async with sessionmaker() as session:
        job = await session.get(NotificationJob, job_id)
        job.status = NotificationStatus.PROCESSING
        job.locked_at = utcnow() - timedelta(hours=1)
        job.locked_by = 'dead-worker'
        await session.commit()

    async with sessionmaker() as session:
        recovered = await notifier.requeue_stale(session)
    assert recovered >= 1

    telegram = FakeTelegram(SendResult(ok=True))
    async with sessionmaker() as session:
        await notifier.process_notifications(session, telegram, 'w2')

    job = await _reload(sessionmaker, job_id)
    assert job.status == NotificationStatus.SENT


async def test_message_text_is_localized(engine, sessionmaker):
    from app.services import messages

    ru = messages.render('appointment_reminder', 'ru',
                         {'title': 'Стрижка', 'date': '1 сентября', 'time': '11:00',
                          'company': 'Салон', 'address': ''})
    en = messages.render('appointment_reminder', 'en',
                         {'title': 'Haircut', 'date': 'September 1', 'time': '11:00',
                          'company': 'Salon', 'address': ''})
    kk = messages.render('appointment_reminder', 'kk',
                         {'title': 'Шаш қию', 'date': '1 қыркүйек', 'time': '11:00',
                          'company': 'Салон', 'address': ''})

    assert 'Напоминание' in ru
    assert 'Reminder' in en
    assert 'Еске салу' in kk


async def test_unknown_locale_falls_back_to_russian():
    from app.services import messages

    text = messages.render('appointment_reminder', 'de', {'title': 'X', 'date': '1', 'time': '2'})
    assert 'Напоминание' in text


async def test_notification_idempotency_key_is_stable():
    """Повторное планирование того же напоминания даёт тот же ключ."""
    first = notifications.idempotency_key('reminder', 'appointment-1', 1, 1440)
    second = notifications.idempotency_key('reminder', 'appointment-1', 1, 1440)
    other = notifications.idempotency_key('reminder', 'appointment-1', 2, 1440)
    assert first == second
    assert first != other


async def test_backoff_grows_and_has_jitter():
    values = [notifier.backoff_seconds(3) for _ in range(20)]
    assert len(set(values)) > 1, 'джиттер нужен, чтобы повторы не совпали'
    assert all(4 <= v <= 8 for v in values)
    assert notifier.backoff_seconds(6) > notifier.backoff_seconds(2)
