# Backend Zapis

Production-часть по `TZ_PRODUCTION.md`. Здесь живёт всё, что в демо
симулировалось: настоящая авторизация, изоляция компаний, серверный расчёт
слотов, атомарная запись, очередь уведомлений и аудит.

Демо-приложение (`webapp/`, `bot/`, `server/serve.py`) продолжает работать
как раньше — backend его пока не заменяет, а появляется рядом.

---

## Что уже сделано

| Этап ТЗ | Состояние |
|---|---|
| 1. Production foundation | готово |
| 2. Company setup и справочники | готово (кроме медиа и moderation workflow) |
| 3. Booking core | готово |
| 4. CRM, отзывы, аналитика | частично: CRM и отзывы есть, рассылки и аналитика — нет |
| 5. Billing | модель данных и entitlement есть, провайдер не подключён |
| 6–8 | не начинались |

Подробная трассировка требований — в [`docs/traceability.md`](docs/traceability.md).

---

## Пощупать руками

Если нужно не читать код, а проверить продукт — есть локальная песочница:
вход без Telegram, уведомления на экран вместо Bot API, отдельная база.
Демо-бот при этом можно не останавливать.

```bash
powershell -ExecutionPolicy Bypass -File scripts\sandbox.ps1
```

Консоль откроется сама. Подробности и порядок проверки —
[`docs/sandbox.md`](docs/sandbox.md).

---

## Быстрый старт

Зависимостей у демо по-прежнему нет; они нужны только backend.

```bash
python -m pip install -r backend/requirements-dev.txt
```

Заполните `.env` (см. `.env.example`, раздел «production backend»).
Минимум для локального запуска — `BOT_TOKEN` и `SESSION_SECRET`.

```bash
cd backend && python -m alembic upgrade head
```

```bash
cd backend && python -m uvicorn app.main:app --reload --port 8000
```

Документация API: `http://localhost:8000/api/v1/docs` (в production закрыта).

Worker уведомлений — отдельный процесс:

```bash
cd backend && python -m app.workers.run
```

## Тесты

```bash
cd backend && python -m pytest -q
```

Тесты идут на файловом SQLite: PostgreSQL для них не нужен. Переносимость
обеспечивают типы из `app/db/types.py` — на PostgreSQL это `UUID`, `JSONB`
и `timestamptz`, везде ещё — их честные аналоги.

**Чего SQLite не проверяет.** Exclusion constraint по пересечению
интервалов и append-only триггеры аудита — фичи PostgreSQL, миграция
`20260826_1500_postgres_guards` накатывает их только там. Защита от двойной
записи в коде работает на обоих (проверка занятости внутри транзакции плюс
`SELECT … FOR UPDATE` по сотруднику), но перед боем эти тесты нужно
прогнать на настоящем PostgreSQL.

---

## Структура

```
app/
  config.py            типизированная конфигурация, валидация при старте
  domain.py            статусы, роли, права, матрица переходов
  main.py              сборка FastAPI: middleware, ошибки, маршруты

  core/
    errors.py          единый формат ошибки: code/message/details/request_id
    security.py        проверка initData, токены, хэши
    context.py         correlation ID и актор запроса
    logging.py         JSON-логи с редакцией персональных данных
    ratelimit.py       скользящее окно; память локально, Redis в бою
    idempotency.py     Idempotency-Key для критичных POST

  db/
    base.py            engine, сессии, базовый класс
    types.py           переносимые UUID / JSONB / timestamptz
    models/            43 таблицы по разделу 11 ТЗ

  api/
    deps.py            КОНТРОЛЬ ДОСТУПА: сессия, tenant scope, права
    v1/                маршруты и схемы

  services/
    auth.py            сессии, ротация refresh, membership
    slots.py           slot engine (раздел 13 ТЗ)
    booking.py         транзакция создания/переноса/отмены записи
    notifications.py   планирование уведомлений
    entitlements.py    лимиты тарифа
    outbox.py          transactional outbox и inbox
    audit.py           журнал действий
    timeutils.py       UTC, зоны филиалов, интервалы

  workers/
    notifier.py        доставка уведомлений с retry, backoff и DLQ
    telegram.py        клиент Bot API
    run.py             точка входа worker
```

---

## Решения, которые стоит знать до правок

**Права проверяет `api/deps.py`, а не обработчик.** Маршрут объявляет,
что ему нужно (`require_permission(...)`, `Tenant`, `ClientBooking`), и
получает уже подтверждённый контекст. Если добавляете маршрут — объявите
зависимость, а не пишите проверку внутри.

**`company_id` в URL — это адрес, а не доказательство доступа.** Членство
ищется по `user_id` из сессии. Компания, к которой нет доступа, выглядит
так же, как несуществующая: 403 без подсказки.

**Клиент и сотрудник — разные входы.** Клиент записывается через
`ClientBooking`: членства у него нет и появиться не должно. Сотрудник — через
`Tenant` с правом `appointments.create`.

**Занятость решает транзакция вставки, а не выдача слотов.** Любая
предварительная проверка — подсказка интерфейсу. Порядок шагов в
`booking.create_appointment` перестановке не подлежит.

**Рабочее окно и свободное окно — разные вещи.** `working_windows()` —
график без учёта записей, `free_windows()` — минус занятое. Первое
отвечает «мастер здесь не работает» (422), второе — «время заняли» (409).
Считать одним методом нельзя: занятый слот начнёт выглядеть как нерабочее
время.

**Время в БД только UTC и только aware.** Наивный `datetime` в модель не
пройдёт — `UTCDateTime` бросит исключение. Локальное время считается от
IANA-зоны филиала, а не от зоны сервера.

**Деньги — целое в минимальных единицах.** Ни одного `float` в денежном
пути. Цена и длительность записи хранятся снимком: услуга подорожает,
история останется прежней.

**Уведомления не уходят из бизнес-транзакции.** Транзакция кладёт задачу
в `notification_jobs` и событие в `outbox_events` тем же коммитом.
Разговаривает с Telegram только worker.

**На SQLite подменена функция `lower()`.** Штатная умеет только ASCII, и
поиск по кириллице молча переставал находить. PostgreSQL делает это сам.
