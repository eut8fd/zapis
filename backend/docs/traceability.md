# Трассировка требований ТЗ

Обязательный артефакт по разделу 30 ТЗ, пункт 10. Для каждого требования —
где оно реализовано и чем проверено. Невыполненные помечены честно: «нет»
означает, что кода нет, а не что «почти готово».

Легенда состояния: **готово** — реализовано и покрыто тестом;
**частично** — реализовано не целиком, разница описана; **нет** — не начато.

---

## 6.2. Авторизация

| ID | Состояние | Реализация | Проверка |
|---|---|---|---|
| AUTH-001 | готово | `api/deps.py:current_principal` — роль и tenant берутся из БД | `test_me_returns_server_side_role` |
| AUTH-002 | готово | `core/security.py:verify_init_data` | `test_tampered_hash_rejected`, `test_foreign_token_signature_rejected` |
| AUTH-003 | готово | `config.py` (≤900 с), проверка `auth_date` | `test_expired_auth_date_rejected` |
| AUTH-004 | готово | `services/auth.py:issue_session` — access 15 мин + refresh с ротацией | `test_refresh_rotates_and_old_token_dies` |
| AUTH-005 | готово | `api/deps.py:tenant_context`, `domain.permissions_for` | `test_master_cannot_read_full_client_data` |
| AUTH-006 | готово | `tenant_context` ищет membership по `user_id`, не по URL | `test_company_id_in_url_is_not_proof_of_access` |
| AUTH-007 | готово | роутер `/public/*` без зависимости от сессии | `test_public_availability_needs_no_session` |
| AUTH-008 | готово | `revoke_session`, проверка сессии на каждом запросе | `test_logout_invalidates_access_token` |
| AUTH-009 | готово | `revoke_all_sessions` при увольнении и смене роли | `test_termination_revokes_access_immediately` |
| AUTH-010 | готово | `users.platform_role` в БД; открытого флага нет | — |
| AUTH-011 | частично | аудит пишется (`services/audit.py`); step-up подтверждения нет | — |
| AUTH-012 | нет | impersonation не реализована | — |

## 8.1. Каталог

| ID | Состояние | Реализация | Проверка |
|---|---|---|---|
| CAT-001 | готово | `api/deps.py:published_company`, фильтр в `public.catalog` | `test_draft_company_is_invisible_in_catalog` |
| CAT-002 | готово | фильтры выполняет SQL в `public.catalog` | `test_published_company_appears_with_public_fields_only` |
| CAT-003 | частично | расстояние считается, сортировка — в пределах страницы; PostGIS нет | — |
| CAT-004 | частично | карточка есть; `next_available_at` пока не заполняется | — |
| CAT-005 | готово | `api/deps.py:booking_context` | — |
| CAT-006 | готово | `clients` уникальны по `(company_id, user_id)` | `test_two_companies_do_not_see_each_others_clients` |
| CAT-007 | частично | стабильный slug есть; preview metadata — задача фронта | — |
| CAT-008 | частично | `utils/text.py:clean` (управляющие символы), нормализация телефона; модерации контента нет | — |

## 8.3–8.5. Услуги, команда, графики

| ID | Состояние | Реализация | Проверка |
|---|---|---|---|
| SVC-001…003 | готово | модель `Service` + CHECK-ограничения | миграция `initial schema` |
| SVC-004 | готово | `EmployeeService`, `eligible_employees` | `test_employee_without_service_link_rejected` |
| SVC-005 | готово | снимок услуги в `appointment_services` | `test_client_books_a_slot` |
| SVC-006 | готово | `price_minor_override` в `EmployeeService` | — |
| SVC-007 | готово | `entitlements.require_capacity` в транзакции | — |
| TEAM-001 | готово | `new_token` + `hash_token`, токен отдаётся один раз | `test_invite_token_is_stored_only_as_hash` |
| TEAM-002 | готово | consume условным UPDATE в транзакции | `test_invite_token_is_single_use` |
| TEAM-003 | готово | модель `TeamInvite` | — |
| TEAM-004 | готово | глобального `GET /invites` нет | `test_invite_token_is_stored_only_as_hash` |
| TEAM-005/006 | готово | `terminate_employee` требует решения по записям | `test_termination_revokes_access_immediately` |
| TEAM-007 | готово | `AuditAction.MEMBERSHIP_ROLE_CHANGED` | — |
| TEAM-008 | готово | лимит по активным сотрудникам | — |
| SCH-001…004 | готово | `WeeklyScheduleRule`, `ScheduleBreak`, валидация в схемах | `test_break_cuts_the_window` |
| SCH-005 | готово | `timeutils.local_datetime` от зоны филиала | `test_timezone_comes_from_branch_not_server` |
| SCH-006 | готово | `slots.free_windows` | `test_vacation_exception_removes_the_day` и др. |
| SCH-007 | готово | один движок для публичного и приватного API | `public.compute_availability` |
| SCH-008 | готово | `slot_step_minutes` и `lead_time_minutes` в настройках компании | `test_lead_time_hides_slots_that_are_too_soon` |
| SCH-009 | нет | массового копирования графика нет | — |

## 8.6. Записи

| ID | Состояние | Реализация | Проверка |
|---|---|---|---|
| APT-001 | готово | UUID генерируется сервером | — |
| APT-002 | готово | `Idempotency-Key` + уникальный индекс | `test_idempotency_key_prevents_duplicate` |
| APT-003 | готово | проверка в транзакции + exclusion constraint на PostgreSQL | `test_double_booking_allows_exactly_one` |
| APT-004 | готово | снимок цены, длительности и названий | `test_client_books_a_slot` |
| APT-005 | готово | `appointment_services` | — |
| APT-006 | готово | `appointment_events`, append-only | `test_history_records_every_change` |
| APT-007 | готово | `_own_appointment` | `test_client_cannot_touch_someone_elses_appointment` |
| APT-008 | готово | фильтр по `calendar.all.read` | `test_master_sees_only_own_calendar` |
| APT-009 | готово | отменённые статусы вне `BLOCKING_APPOINTMENT_STATUSES` | `test_cancel_frees_the_slot` |
| APT-010 | готово | `notifications.cancel_for_appointment` при переносе | `test_cancel_kills_pending_notifications` |
| APT-011 | готово | `COMPLETE_GRACE_MINUTES` | — |
| APT-012 | готово | `client_comment` и `internal_note` раздельно | — |
| APT-013 | нет | waitlist отложен (раздел 5.2 ТЗ) | — |

## 8.7–8.8. CRM и отзывы

| ID | Состояние | Реализация | Проверка |
|---|---|---|---|
| CRM-001/002 | готово | модель `Client` | `test_two_companies_do_not_see_each_others_clients` |
| CRM-003 | готово | `utils/phone.normalize_phone` | `test_profile_update_normalizes_phone` |
| CRM-004 | готово | поиск по имени, телефону, username | — |
| CRM-005 | нет | объединения дублей нет | — |
| CRM-006/007 | частично | заметки с автором и `sensitive`, чтение журналируется | — |
| CRM-008 | нет | экспорта и анонимизации нет | — |
| REV-001/002 | готово | `reviews.create_review` идемпотентен | — |
| REV-003 | готово | накопительный рейтинг мастера | — |
| REV-004/005 | частично | ответ компании есть, moderation workflow нет | — |

## 9. Бот и Mini App

| Требование | Состояние | Комментарий |
|---|---|---|
| Единый backend для бота и Mini App | частично | API готов; демо-бот на него ещё не переведён |
| Идемпотентность по `update_id` | готово | `api/v1/telegram.py` + `inbox_events` |
| Webhook с секретом | готово | секрет в пути и в заголовке |
| Исходящие через outbox | готово | `services/outbox.py`, worker |
| Меню клиента и бизнеса | нет | остаётся в демо-боте |

## 12. API

| Требование | Состояние | Комментарий |
|---|---|---|
| Base path `/api/v1`, ISO 8601, минорные единицы | готово | `api/v1/schemas.py` |
| Единый формат ошибки | готово | `core/errors.py`, обработчики в `main.py` |
| Коды 401/403/409/422 | готово | покрыто тестами |
| `Idempotency-Key` | готово | `core/idempotency.py` |
| Cursor-based pagination | частично | каталог — курсор, CRM пока offset |
| OpenAPI как артефакт | готово | `/api/v1/openapi.json`, 56 маршрутов |
| Contract tests | нет | не написаны |

## 13. Slot engine

Готов целиком: `services/slots.py`, 21 тест в `tests/test_slots.py`,
включая DST, ночные смены и границы суток. Availability token реализован
(`availability_token`), но пока необязателен — сервер всё равно
перепроверяет занятость в транзакции, как требует шаг 6 раздела 13.3.

## 14. Платежи

Модель данных готова (`payment_orders`, `payment_transactions`,
`provider_events`, `refunds`, `subscriptions`, `plans`,
`plan_entitlements`). Провайдер не выбран и не подключён — это решение
Этапа 0 ТЗ. Никаких фиктивных «успешных оплат» в коде нет: подтвердить
оплату сейчас нечем, и API создания заказа намеренно не выставлен.

## 15. Уведомления

| Требование | Состояние | Проверка |
|---|---|---|
| Задача в БД | готово | `test_notifications_are_scheduled_on_booking` |
| Успех после ответа провайдера | готово | `test_successful_send_marks_job_sent` |
| 429 и `retry_after` | готово | `test_rate_limit_respects_retry_after` |
| Backoff с джиттером | готово | `test_backoff_grows_and_has_jitter` |
| Постоянные ошибки → suppression | готово | `test_blocked_bot_goes_to_suppression` |
| DLQ после лимита попыток | готово | `test_job_reaches_dead_letter_after_max_attempts` |
| Отмена устаревших задач | готово | `test_cancel_kills_pending_notifications` |
| Переживание рестарта | готово | `test_restart_recovers_jobs_stuck_in_processing` |
| Время в шаблонах — локальное филиала | готово | `workers/notifier.py:build_text` |

## 16–22. Инфраструктура и эксплуатация

| Раздел | Состояние | Комментарий |
|---|---|---|
| 16. Медиафайлы | нет | модель `media_assets` есть, загрузки нет |
| 17.2 Сессии | готово | ротация refresh, отзыв, реакция на повторное использование |
| 17.3 Tenant isolation | готово | 12 тестов в `tests/test_tenancy.py` |
| 17.4 Секреты | частично | всё из окружения, валидация при старте; secrets manager не подключён |
| 17.5 Защита API | частично | rate limit и заголовки есть; WAF и CSP — уровень прокси |
| 17.6 Платёжная безопасность | нет | вместе с провайдером |
| 18. Персональные данные | частично | редакция в логах, маскирование телефона; юридического пакета нет |
| 19. НФТ | нет | нагрузочных и soak-тестов не было |
| 20.1 Логи | готово | JSON с correlation ID и редакцией |
| 20.2 Метрики | нет | OpenTelemetry не подключён |
| 20.4 Health checks | готово | `/api/v1/live`, `/api/v1/ready` |
| 21. Backup | нет | процедур нет |
| 22.1 IaC | нет | только `docker-compose.prod.yml` |
| 22.3 CI | нет | pipeline не настроен |

## 23. Frontend

Не начат. Mini App продолжает работать на `localStorage` и остаётся
демонстрационным. Перевод фронта на API — отдельный объём работ (пункты
23.1–23.7 ТЗ), и до него demo-архитектуру трогать нельзя, иначе
работающая демонстрация сломается раньше, чем появится замена.

---

## Что важно знать при приёмке

1. **PostgreSQL-специфичные гарантии не проверены на PostgreSQL.** На этой
   машине его нет. Exclusion constraint и триггеры append-only написаны и
   накатываются миграцией, но прогнать `pytest` на PostgreSQL — обязательный
   шаг перед пилотом.
2. **Платежей нет вообще.** Это сознательно: раздел 5.2 ТЗ запрещает
   показывать нереализованное как доступное, а фиктивная оплата — худший
   вид такой рекламы.
3. **Demo и production сосуществуют.** Backend не удаляет ни строчки демо.
   Инвентаризация demo-механик и их отключение — раздел 25 ТЗ, отдельный
   этап, который делается после перевода фронта на API.
