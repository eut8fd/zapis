"""
Запись end-to-end (ТЗ 7.4–7.8, 13.3).

Главный тест здесь — двойное бронирование. Exit criteria Этапа 3 требует,
чтобы из двух одновременных попыток занять один слот прошла ровно одна.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta

import pytest
import sqlalchemy as sa

from tests.conftest import full_company, login, next_weekday_at

pytestmark = pytest.mark.asyncio


async def _book(client, headers, company, when, **extra):
    payload = {
        'branch_id': company['branch_id'],
        'employee_id': company['employee_id'],
        'service_ids': [company['service_id']],
        'starts_at': when.isoformat(),
    }
    payload.update(extra)
    return await client.post(
        f'/api/v1/companies/{company["company_id"]}/appointments/self',
        headers=headers, json=payload,
    )


async def test_client_books_a_slot(client, sessionmaker, owner):
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client, first_name='Клиент')

    when = next_weekday_at(11)
    response = await _book(client, guest['headers'], company, when)
    assert response.status_code == 201, response.text

    body = response.json()
    assert body['status'] == 'confirmed'
    assert body['price_minor'] == 500000
    assert body['duration_minutes'] == 60
    assert body['title'] == 'Стрижка'
    assert body['timezone'] == company['timezone']
    assert body['local_time'] == '11:00'


async def test_booked_slot_disappears_from_availability(client, sessionmaker, owner):
    """Клиент не должен видеть уже занятое время."""
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)
    when = next_weekday_at(12)

    assert (await _book(client, guest['headers'], company, when)).status_code == 201

    response = await client.get(
        f'/api/v1/public/companies/{company["slug"]}/availability',
        params={
            'service_ids': company['service_id'],
            'date_from': when.astimezone().date().isoformat(),
            'date_to': (when + timedelta(days=1)).astimezone().date().isoformat(),
        },
    )
    assert response.status_code == 200
    times = [
        slot['local_time']
        for day in response.json()['days'] for slot in day['slots']
        if day['date'] == _local_date(when, company['timezone'])
    ]
    assert '12:00' not in times
    # Буфер после услуги тоже занят: 13:00 + 15 минут уборки.
    assert '13:00' not in times
    assert '13:30' in times


def _local_date(moment, tz_name):
    from app.services.timeutils import local
    return local(moment, tz_name).date().isoformat()


async def test_double_booking_allows_exactly_one(client, sessionmaker, owner):
    """
    Exit criteria Этапа 3: два клиента одновременно бьются за один слот,
    выигрывает ровно один, второй получает 409 SLOT_TAKEN.
    """
    company = await full_company(sessionmaker, client, owner['headers'])
    first = await login(client, first_name='Первый')
    second = await login(client, first_name='Второй')
    when = next_weekday_at(14)

    responses = await asyncio.gather(
        _book(client, first['headers'], company, when),
        _book(client, second['headers'], company, when),
        return_exceptions=True,
    )
    codes = sorted(r.status_code for r in responses if not isinstance(r, Exception))
    assert codes.count(201) == 1, f'ожидалась ровно одна успешная запись, получено {codes}'
    assert codes.count(409) == 1, f'вторая попытка должна быть отклонена, получено {codes}'

    loser = next(r for r in responses if r.status_code == 409)
    assert loser.json()['error']['code'] == 'SLOT_TAKEN'

    async with sessionmaker() as session:
        from app.db.models import Appointment
        count = await session.scalar(
            sa.select(sa.func.count()).select_from(Appointment).where(
                Appointment.company_id == uuid.UUID(company['company_id']),
            )
        )
    assert count == 1, 'в БД должна остаться ровно одна запись'


async def test_overlapping_booking_is_rejected(client, sessionmaker, owner):
    """Пересечение не обязано быть точным совпадением времени."""
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)
    when = next_weekday_at(15)

    assert (await _book(client, guest['headers'], company, when)).status_code == 201
    overlap = await _book(client, guest['headers'], company, when + timedelta(minutes=30))
    assert overlap.status_code == 409
    assert overlap.json()['error']['code'] == 'SLOT_TAKEN'


async def test_slot_taken_returns_alternatives(client, sessionmaker, owner):
    """ТЗ 13.3 шаг 7: вместе с конфликтом отдаются актуальные альтернативы."""
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)
    when = next_weekday_at(16)

    await _book(client, guest['headers'], company, when)
    conflict = await _book(client, guest['headers'], company, when)
    alternatives = conflict.json()['error']['details']['alternatives']
    assert alternatives, 'нужно предложить, куда переставить'
    assert all('starts_at' in item and 'local_time' in item for item in alternatives)


async def test_idempotency_key_prevents_duplicate(client, sessionmaker, owner):
    """APT-002: повтор запроса с тем же ключом возвращает ту же запись."""
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)
    when = next_weekday_at(17)
    headers = dict(guest['headers'], **{'Idempotency-Key': 'booking-retry-1'})

    first = await _book(client, headers, company, when)
    second = await _book(client, headers, company, when)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()['id'] == second.json()['id']


async def test_booking_outside_working_hours_rejected(client, sessionmaker, owner):
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)

    response = await _book(client, guest['headers'], company, next_weekday_at(6))
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'outside_working_hours'


async def test_booking_in_the_past_rejected(client, sessionmaker, owner):
    from app.db.types import utcnow

    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)

    response = await _book(client, guest['headers'], company, utcnow() - timedelta(days=1))
    assert response.status_code == 422
    assert response.json()['error']['code'] in ('lead_time_violation', 'outside_working_hours')


async def test_booking_beyond_horizon_rejected(client, sessionmaker, owner):
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)

    response = await _book(client, guest['headers'], company, next_weekday_at(11, days_ahead=400))
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'beyond_horizon'


async def test_employee_without_service_link_rejected(client, sessionmaker, owner):
    """SVC-004: пустой список услуг у мастера не означает «оказывает всё»."""
    from app.db.models import Employee, EmployeeBranch
    from app.db.types import new_uuid, utcnow

    company = await full_company(sessionmaker, client, owner['headers'])
    async with sessionmaker() as session:
        stranger = Employee(
            id=new_uuid(), company_id=uuid.UUID(company['company_id']),
            display_name='Новичок', takes_appointments=True, active=True,
            created_at=utcnow(), updated_at=utcnow(),
        )
        session.add(stranger)
        await session.flush()
        session.add(EmployeeBranch(
            id=new_uuid(), company_id=stranger.company_id,
            employee_id=stranger.id, branch_id=uuid.UUID(company['branch_id']),
        ))
        await session.commit()
        stranger_id = str(stranger.id)

    guest = await login(client)
    response = await _book(
        client, guest['headers'], dict(company, employee_id=stranger_id), next_weekday_at(11),
    )
    assert response.status_code == 422
    assert 'услуг' in response.json()['error']['message']


async def test_cancel_frees_the_slot(client, sessionmaker, owner):
    """APT-009: отменённая запись слот не держит, но остаётся в истории."""
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)
    when = next_weekday_at(18)

    created = await _book(client, guest['headers'], company, when)
    appointment_id = created.json()['id']

    cancelled = await client.post(
        f'/api/v1/appointments/{appointment_id}/cancel',
        headers=guest['headers'], json={'reason': 'передумал'},
    )
    assert cancelled.status_code == 200
    assert cancelled.json()['status'] == 'cancelled_by_client'

    again = await _book(client, guest['headers'], company, when)
    assert again.status_code == 201, 'время должно снова стать свободным'


async def test_client_cannot_touch_someone_elses_appointment(client, sessionmaker, owner):
    """APT-007: чужая запись для клиента просто не существует."""
    company = await full_company(sessionmaker, client, owner['headers'])
    victim = await login(client, first_name='Жертва')
    attacker = await login(client, first_name='Чужой')

    created = await _book(client, victim['headers'], company, next_weekday_at(11))
    appointment_id = created.json()['id']

    response = await client.post(
        f'/api/v1/appointments/{appointment_id}/cancel',
        headers=attacker['headers'], json={'reason': 'просто так'},
    )
    assert response.status_code == 404


async def test_reschedule_moves_atomically(client, sessionmaker, owner):
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)
    first_time = next_weekday_at(11)
    second_time = next_weekday_at(13)

    created = await _book(client, guest['headers'], company, first_time)
    appointment_id = created.json()['id']

    moved = await client.post(
        f'/api/v1/appointments/{appointment_id}/reschedule',
        headers=guest['headers'], json={'starts_at': second_time.isoformat()},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()['local_time'] == '13:00'
    assert moved.json()['version'] == 2

    # Старое время освободилось той же транзакцией.
    other = await login(client, first_name='Другой')
    assert (await _book(client, other['headers'], company, first_time)).status_code == 201


async def test_history_records_every_change(client, sessionmaker, owner):
    """APT-006: изменения не переписывают запись, а добавляют события."""
    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)

    created = await _book(client, guest['headers'], company, next_weekday_at(11))
    appointment_id = created.json()['id']
    await client.post(
        f'/api/v1/appointments/{appointment_id}/reschedule',
        headers=guest['headers'], json={'starts_at': next_weekday_at(15).isoformat()},
    )

    history = await client.get(
        f'/api/v1/companies/{company["company_id"]}/appointments/{appointment_id}/history',
        headers=owner['headers'],
    )
    assert history.status_code == 200
    kinds = [item['event_type'] for item in history.json()]
    assert kinds == ['created', 'rescheduled']


async def test_notifications_are_scheduled_on_booking(client, sessionmaker, owner):
    """ТЗ 15.1: подтверждение и напоминания появляются в очереди сразу."""
    from app.db.models import NotificationJob

    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)
    created = await _book(client, guest['headers'], company, next_weekday_at(11))
    appointment_id = uuid.UUID(created.json()['id'])

    async with sessionmaker() as session:
        jobs = (await session.execute(
            sa.select(NotificationJob).where(NotificationJob.appointment_id == appointment_id)
        )).scalars().all()

    templates = sorted({job.template for job in jobs})
    assert 'appointment_confirmed' in templates
    assert 'appointment_reminder' in templates
    assert all(job.status == 'pending' for job in jobs)


async def test_cancel_kills_pending_notifications(client, sessionmaker, owner):
    """APT-010: отменённая запись не должна прислать напоминание."""
    from app.db.models import NotificationJob

    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)
    created = await _book(client, guest['headers'], company, next_weekday_at(11))
    appointment_id = created.json()['id']

    await client.post(
        f'/api/v1/appointments/{appointment_id}/cancel',
        headers=guest['headers'], json={'reason': 'заболел'},
    )

    async with sessionmaker() as session:
        jobs = (await session.execute(
            sa.select(NotificationJob).where(
                NotificationJob.appointment_id == uuid.UUID(appointment_id)
            )
        )).scalars().all()
    assert all(job.status == 'cancelled' for job in jobs)


async def test_outbox_event_written_in_same_transaction(client, sessionmaker, owner):
    """ТЗ 10.2: событие лежит в БД вместе с записью, а не уходит наружу сразу."""
    from app.db.models import OutboxEvent

    company = await full_company(sessionmaker, client, owner['headers'])
    guest = await login(client)
    await _book(client, guest['headers'], company, next_weekday_at(11))

    async with sessionmaker() as session:
        events = (await session.execute(
            sa.select(OutboxEvent).where(OutboxEvent.event_type == 'appointment.created')
        )).scalars().all()
    assert len(events) == 1
    assert events[0].status == 'pending'
