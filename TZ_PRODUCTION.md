# Техническое задание: Zapis — официальный SaaS онлайн-записи

Статус документа: проект ТЗ для разработки production-версии  
Версия: 1.0  
Дата: 26 августа 2026 года  
Исходный продукт: Telegram Mini App + Telegram-бот Zapis  
Язык документа: русский

---

## 1. Назначение документа

Настоящее техническое задание определяет полный объём работ по превращению существующего демонстрационного прототипа Zapis в официальный коммерческий продукт для реальных компаний, сотрудников и клиентов.

Документ является основанием для:

- проектирования архитектуры;
- оценки сроков и бюджета;
- декомпозиции работ между backend, frontend, Telegram, DevOps, QA, security и product-командами;
- подготовки договоров с подрядчиками;
- проведения функциональной, нагрузочной и приёмочной проверки;
- принятия решения о допуске продукта к реальным пользователям и оплатам.

ТЗ заменяет допущения демо-версии. Любая функция, которая в текущем интерфейсе симулируется, считается не реализованной до появления серверной логики, надёжного хранения, контроля прав, мониторинга и автоматических тестов.

## 2. Исходное состояние и обязательный итог

### 2.1. Исходное состояние

Существующий проект содержит:

- Telegram Mini App с 50 зарегистрированными маршрутами;
- роли клиента, сотрудника, владельца и Super Admin;
- каталог компаний, страницы салонов, услуги, сотрудников и расписания;
- клиентскую запись, перенос, отмену и отзывы;
- CRM, календарь, финансы, аналитику, рассылки и AI-экраны;
- Telegram-бот с меню, записью в чате и демонстрационными напоминаниями;
- демонстрационную Super Admin панель;
- Docker, Caddy и systemd-заготовки.

Критические ограничения текущей реализации:

- источником данных является `localStorage` и несколько JSON-файлов;
- API не имеет аутентификации и разграничения арендаторов;
- роли назначаются клиентом;
- сервер не защищает слот от двойного бронирования;
- оплаты, рассылки, часть уведомлений, поддержка и AI-функции симулируются;
- нет production CI/CD, резервного копирования, наблюдаемости и юридического пакета.

### 2.2. Обязательный итог

Должен быть создан multi-tenant SaaS, в котором:

- PostgreSQL является единственным источником истины;
- пользователь идентифицируется по проверенным данным Telegram;
- доступ определяется сервером на основании членства и роли;
- данные компаний изолированы друг от друга;
- запись создаётся атомарно и не допускает пересечения слотов;
- бот и Mini App используют один backend и одну модель данных;
- подписки и клиентские оплаты подтверждаются только сервером по проверенному событию провайдера;
- уведомления доставляются через очередь с повторами и контролем результата;
- все важные действия журналируются;
- продукт имеет тесты, мониторинг, резервные копии, процедуры восстановления и безопасный процесс релиза.

## 3. Термины

| Термин | Определение |
|---|---|
| Платформа | SaaS Zapis целиком: Mini App, бот, backend, БД, worker и Super Admin |
| Компания | Арендатор платформы: салон, студия, барбершоп, клиника или другой бизнес |
| Филиал | Физическая точка компании с адресом, часовым поясом, графиком и сотрудниками |
| Пользователь | Человек с подтверждённой Telegram identity |
| Клиент | Пользователь, который записывается на услуги |
| Сотрудник | Участник команды компании |
| Мастер | Сотрудник, который оказывает услуги и имеет расписание |
| Владелец | Пользователь с полным доступом к своей компании |
| Менеджер | Сотрудник с делегированными административными правами |
| Super Admin | Сотрудник платформы с отдельным серверным доступом |
| Запись | Бронирование услуги на конкретное время, филиал и сотрудника |
| Слот | Интервал времени, доступный для бронирования |
| Подписка | Право компании пользоваться тарифом платформы |
| Клиентский платёж | Оплата или предоплата услуги конечным клиентом |
| Outbox | Надёжная очередь событий/уведомлений, сохраняемая в БД |
| Tenant isolation | Невозможность пользователя одной компании получить данные другой |

## 4. Приоритеты требований

- **MUST** — обязательно для первого официального релиза. Без требования запуск запрещён.
- **SHOULD** — необходимо реализовать до массового масштабирования; допускается только контролируемый пилот с документированным ограничением.
- **COULD** — последующее развитие, не блокирующее первый официальный релиз.

Все требования безопасности, целостности данных, оплат, резервного копирования и tenant isolation имеют приоритет MUST.

## 5. Границы продукта

### 5.1. В первый официальный релиз входят

- Telegram Mini App для клиента и бизнеса;
- Telegram-бот;
- публичный каталог и страницы компаний;
- регистрация и онбординг компании;
- филиалы на уровне модели данных; пользовательский интерфейс минимум для одного филиала;
- услуги, категории, цены, длительность и буферы;
- команда, роли, приглашения и права;
- рабочие графики, перерывы, выходные, отпуска и блокировки времени;
- серверный расчёт свободных слотов;
- создание, перенос, отмена, завершение и no-show записей;
- CRM клиентов, заметки, теги и история;
- уведомления клиентам и сотрудникам;
- отзывы после визита;
- финансы и базовая аналитика;
- тарифы, подписки и оплата платформы;
- опциональная предоплата клиентом за услугу;
- рассылки с явным согласием и отпиской;
- AI-помощник через серверный proxy;
- Super Admin, поддержка, аудит и модерация;
- русский, казахский и английский интерфейсы;
- production deployment, мониторинг, backup и CI/CD.

### 5.2. Не должны рекламироваться до реализации

Следующие возможности могут быть предусмотрены архитектурой, но не должны отображаться как доступные в тарифах и маркетинге до отдельной реализации и приёмки:

- полноценное управление сетью филиалов;
- склад, товары и остатки;
- расчёт зарплат и комиссий мастеров;
- абонементы, сертификаты и программа лояльности;
- публичный API для партнёров;
- интеграции с внешними CRM и бухгалтерией;
- кассовые и фискальные интеграции;
- marketplace сторонних расширений.

## 6. Пользователи, роли и права

### 6.1. Роли платформы

| Роль | Основные права |
|---|---|
| Гость | Просмотр публичного каталога и страницы компании |
| Клиент | Управление только своими данными и записями |
| Мастер | Свой календарь, свои клиенты в допустимом объёме, статусы визитов |
| Менеджер | Операционная работа компании в пределах назначенных разрешений |
| Владелец | Все данные и настройки своей компании, кроме платформенных функций |
| Support Agent | Работа с обращениями без автоматического полного доступа к PII |
| Platform Admin | Тарифы, компании, платежные статусы, модерация и эксплуатация |
| Super Admin | Ограниченный круг критических операций со step-up подтверждением |
| Системный worker | Фоновые задачи без интерактивного входа |

### 6.2. Общие требования к авторизации

- `AUTH-001 MUST`: frontend не имеет права назначать себе роль, company ID, branch ID или employee ID.
- `AUTH-002 MUST`: Telegram `initData` валидируется на backend по официальному алгоритму подписи.
- `AUTH-003 MUST`: backend проверяет срок `auth_date`; значение срока задаётся конфигурацией и не превышает 15 минут для создания сессии.
- `AUTH-004 MUST`: после проверки создаётся серверная сессия с коротким временем жизни access token и безопасным refresh-механизмом.
- `AUTH-005 MUST`: доступ к каждой операции проверяется по user ID, membership, роли, разрешению и tenant scope.
- `AUTH-006 MUST`: company ID из тела или URL никогда не считается доказательством доступа.
- `AUTH-007 MUST`: гостевые публичные endpoint отделены от приватных endpoint.
- `AUTH-008 MUST`: сессии можно отозвать; выход завершает текущую сессию.
- `AUTH-009 MUST`: смена роли, блокировка пользователя или увольнение сотрудника немедленно инвалидируют доступ.
- `AUTH-010 MUST`: доступ Platform Admin и Super Admin не зависит от открытого frontend-флага или статического хэша.
- `AUTH-011 MUST`: опасные admin-действия требуют повторного подтверждения и записываются в audit log.
- `AUTH-012 MUST`: impersonation компании службой поддержки имеет причину, срок, banner в интерфейсе и полный аудит.

### 6.3. Матрица прав компании

Система должна поддерживать как готовые роли, так и набор granular permissions:

- `calendar.own.read`, `calendar.all.read`, `calendar.write`;
- `appointments.create`, `appointments.update`, `appointments.cancel`, `appointments.complete`;
- `clients.read.basic`, `clients.read.full`, `clients.write`, `clients.export`;
- `services.read`, `services.write`;
- `team.read`, `team.invite`, `team.manage_roles`, `team.terminate`;
- `schedule.own.write`, `schedule.all.write`;
- `finance.read`, `finance.write`;
- `analytics.read`;
- `broadcasts.read`, `broadcasts.send`;
- `billing.read`, `billing.manage`;
- `company.settings.read`, `company.settings.write`;
- `ai.use`;
- `audit.read`.

Backend должен проверять permission независимо от того, скрыта ли кнопка в UI.

## 7. Основные пользовательские сценарии

### 7.1. Вход клиента по ссылке компании

1. Клиент открывает ссылку или кнопку Telegram.
2. Backend проверяет Telegram identity.
3. Ссылка определяет публичную компанию/филиал, но не роль с повышенными правами.
4. Если клиент ранее взаимодействовал с компанией, backend возвращает его карточку.
5. Если карточки нет, она не создаётся до первого осмысленного действия: записи, согласия на коммуникации или сохранения профиля.
6. Клиент видит только свои записи и данные.

Критерий: новый пользователь ни при каких условиях не получает карточку существующего клиента.

### 7.2. Вход клиента без ссылки компании

1. Клиент открывает бота без start-параметра.
2. Открывается каталог.
3. Доступны поиск, категории, города и компании.
4. Геолокация запрашивается только по явному действию и согласию.
5. После выбора компании клиент переходит на публичную страницу и может начать запись.

### 7.3. Регистрация компании

1. Подтверждение Telegram identity.
2. Ввод названия, категории, города, часового пояса и контактов.
3. Принятие обязательных юридических документов.
4. Создание компании, первого филиала и membership владельца одной транзакцией.
5. Создание первой услуги.
6. Настройка рабочего времени.
7. Добавление или приглашение первого сотрудника.
8. Предпросмотр публичной страницы.
9. Публикация страницы после прохождения обязательной проверки полноты.

Онбординг должен сохранять черновик после каждого шага и продолжаться с последнего завершённого шага.

### 7.4. Запись клиента

1. Выбор услуги.
2. Выбор конкретного мастера или варианта «любой».
3. Запрос доступных дат и слотов с backend.
4. Выбор слота.
5. При необходимости создание payment order на предоплату.
6. Атомарное подтверждение записи backend.
7. Отображение success только после ответа backend.
8. Создание notification jobs.
9. Запись немедленно видна клиенту, мастеру и владельцу.

### 7.5. Создание записи сотрудником

1. Поиск существующего клиента или создание нового.
2. Выбор услуг.
3. Выбор филиала, мастера и времени.
4. Backend повторно проверяет полномочия и доступность.
5. Создаёт запись и audit event.
6. При включённых уведомлениях отправляет подтверждение клиенту.

### 7.6. Перенос

- Backend проверяет право инициатора.
- Новый слот резервируется той же транзакцией, которая освобождает старый.
- Старые notification jobs отменяются, новые создаются.
- Предоплата и политика переноса обрабатываются согласно настройкам компании.
- В историю добавляется событие со старым и новым временем.

### 7.7. Отмена

- Клиент видит правила и возможный размер возврата до подтверждения.
- Backend проверяет дедлайн отмены.
- Запись получает статус `cancelled`, а не удаляется.
- Слот освобождается.
- Уведомления отменяются.
- При необходимости создаётся refund workflow.
- В audit/event history сохраняется инициатор и причина.

### 7.8. Завершение визита и отзыв

- Мастер или менеджер переводит запись в `completed`.
- Финансовая операция фиксируется отдельно от статуса записи.
- Создаётся запрос отзыва с ограниченным сроком.
- Один appointment допускает один активный отзыв клиента.
- Компания может ответить на отзыв, но не менять оценку клиента.

## 8. Функциональные требования по модулям

### 8.1. Публичный каталог и страница компании

- `CAT-001 MUST`: публичный каталог возвращает только опубликованные компании и разрешённые публичные поля.
- `CAT-002 MUST`: фильтрация по категории, городу, услуге и строке поиска выполняется сервером.
- `CAT-003 SHOULD`: геопоиск выполняется по координатам с явным согласием пользователя.
- `CAT-004 MUST`: страница содержит название, категорию, адрес, контакты, часы, услуги, мастеров, фотографии и ближайшее доступное время.
- `CAT-005 MUST`: неопубликованная, заблокированная или просроченная по тарифу компания не принимает новые записи согласно серверной entitlement policy.
- `CAT-006 MUST`: клиент, пришедший по branded-link, не должен автоматически получать доступ к чужим клиентским данным.
- `CAT-007 SHOULD`: публичные URL имеют стабильный slug и корректные preview metadata.
- `CAT-008 MUST`: контактные ссылки, адреса и пользовательский текст проходят нормализацию и экранирование.

### 8.2. Компания и филиалы

- `COM-001 MUST`: у компании есть владелец, статус, тариф, валюта, locale и юридические настройки.
- `COM-002 MUST`: у филиала есть название, адрес, контакты, IANA timezone, координаты и часы работы.
- `COM-003 MUST`: нельзя удалить последний активный филиал.
- `COM-004 MUST`: публикация запрещена без обязательных данных.
- `COM-005 MUST`: блокировка компании действует серверно на все write-операции, кроме оплаты, экспорта и обращения в поддержку.
- `COM-006 SHOULD`: изменение публичных данных может проходить moderation workflow.
- `COM-007 SHOULD`: поддержать несколько филиалов без изменения модели записей и платежей.

### 8.3. Услуги

- `SVC-001 MUST`: название, категория, описание, цена, валюта, длительность, буфер до/после, активность и фотография.
- `SVC-002 MUST`: цена неотрицательна и хранится в минимальных денежных единицах целым числом.
- `SVC-003 MUST`: длительность и буферы имеют допустимые серверные диапазоны.
- `SVC-004 MUST`: услуга назначается одному или нескольким сотрудникам явно; пустой список не означает «все».
- `SVC-005 MUST`: деактивация не ломает исторические записи.
- `SVC-006 SHOULD`: поддержать вариантные цены и длительность по мастеру/филиалу.
- `SVC-007 MUST`: тарифные лимиты проверяются сервером при создании и активации.

### 8.4. Команда и приглашения

- `TEAM-001 MUST`: приглашение содержит криптографически стойкий одноразовый токен; в БД хранится только hash.
- `TEAM-002 MUST`: consume приглашения выполняется атомарно вместе с созданием membership.
- `TEAM-003 MUST`: приглашение имеет срок, роль, permissions, компанию/филиал, создателя, статус и дату отзыва.
- `TEAM-004 MUST`: список токенов никогда не возвращается глобально.
- `TEAM-005 MUST`: увольнение запрещает будущий доступ и требует решения по будущим записям.
- `TEAM-006 MUST`: при увольнении предлагаются перенос записей, массовое переназначение либо отмена.
- `TEAM-007 MUST`: изменение роли журналируется.
- `TEAM-008 MUST`: лимиты сотрудников проверяются по активным memberships.

### 8.5. Графики и доступность

- `SCH-001 MUST`: недельный график задаётся для филиала и сотрудника.
- `SCH-002 MUST`: поддерживаются несколько перерывов в день.
- `SCH-003 MUST`: поддерживаются разовые изменения, блокировки, отпуск, больничный и отсутствие.
- `SCH-004 MUST`: интервалы валидируются: начало раньше конца, нет некорректных пересечений.
- `SCH-005 MUST`: timezone берётся из филиала, а не из устройства пользователя или сервера.
- `SCH-006 MUST`: availability учитывает часы филиала, график мастера, услуги, буферы, записи, отсутствия, lead time и горизонт записи.
- `SCH-007 MUST`: slot engine один для бота, Mini App, API и админских операций.
- `SCH-008 SHOULD`: поддержать индивидуальный шаг сетки и минимальное время до записи.
- `SCH-009 SHOULD`: массовое копирование графика требует preview и подтверждения.

### 8.6. Записи

Статусы записи:

`pending_payment` → `confirmed` → `checked_in` → `completed`  
Альтернативные: `cancelled_by_client`, `cancelled_by_company`, `no_show`, `expired`, `payment_failed`.

- `APT-001 MUST`: ID генерируется UUID/ULID на сервере.
- `APT-002 MUST`: создание идемпотентно.
- `APT-003 MUST`: конфликт интервала определяется сервером внутри транзакции.
- `APT-004 MUST`: appointment хранит снимок цены, длительности и названий на момент записи.
- `APT-005 MUST`: одна запись может содержать несколько услуг.
- `APT-006 MUST`: изменения не удаляют историю; создаются appointment events.
- `APT-007 MUST`: клиент работает только со своими записями.
- `APT-008 MUST`: сотрудник работает только с разрешёнными филиалами и календарями.
- `APT-009 MUST`: отменённая запись не занимает слот.
- `APT-010 MUST`: перенос сбрасывает и пересоздаёт релевантные напоминания.
- `APT-011 MUST`: завершение и no-show доступны только после разумного временного порога.
- `APT-012 SHOULD`: поддержать внутренний комментарий и отдельный комментарий клиента.
- `APT-013 SHOULD`: поддержать waitlist для освободившихся окон.

### 8.7. CRM клиентов

- `CRM-001 MUST`: карточка клиента принадлежит конкретной компании, но связана с общей Telegram identity при наличии согласия.
- `CRM-002 MUST`: телефон, Telegram ID и username хранятся раздельно.
- `CRM-003 MUST`: нормализация телефона выполняется сервером.
- `CRM-004 MUST`: поиск поддерживает имя, телефон и Telegram username.
- `CRM-005 MUST`: дубликаты объединяются только явной операцией с preview.
- `CRM-006 MUST`: заметки видны только разрешённым сотрудникам и журналируются.
- `CRM-007 MUST`: чувствительные заметки имеют отдельную политику доступа и хранения.
- `CRM-008 MUST`: доступны экспорт и удаление/анонимизация по утверждённому процессу.
- `CRM-009 SHOULD`: теги, предпочтения, источник привлечения, последний и следующий визит.
- `CRM-010 SHOULD`: массовые действия требуют permissions и audit.

### 8.8. Отзывы

- `REV-001 MUST`: отзыв может оставить только клиент завершённой записи.
- `REV-002 MUST`: повторная отправка идемпотентна.
- `REV-003 MUST`: рейтинг пересчитывается сервером.
- `REV-004 MUST`: отзыв может быть скрыт moderation-операцией, но не переписан компанией.
- `REV-005 SHOULD`: компания может ответить.
- `REV-006 SHOULD`: уведомление об отзыве отправляется владельцу/мастеру по настройкам.

### 8.9. Финансы и аналитика

- `FIN-001 MUST`: фактический доход отделён от ожидаемого.
- `FIN-002 MUST`: финансовая операция хранит сумму, валюту, категорию, дату, источник и связь с appointment/payment.
- `FIN-003 MUST`: деньги хранятся целым числом в минимальных единицах.
- `FIN-004 MUST`: отчёты всегда ограничены компанией и разрешёнными филиалами.
- `FIN-005 MUST`: удаление операции заменяется отменой/корректировкой с audit trail.
- `FIN-006 SHOULD`: доходы, расходы, прибыль, средний чек, загрузка, повторные визиты, отмены и источники записи.
- `FIN-007 SHOULD`: экспорт CSV/XLSX с асинхронной генерацией для больших объёмов.
- `FIN-008 SHOULD`: timezone и валюта явно отображаются в каждом отчёте.

### 8.10. Рассылки

- `MSG-001 MUST`: отправка разрешена только адресатам с действующим согласием.
- `MSG-002 MUST`: есть отписка и suppression list.
- `MSG-003 MUST`: аудитория рассчитывается сервером и фиксируется снимком.
- `MSG-004 MUST`: рассылка отправляется через очередь с rate limit Telegram.
- `MSG-005 MUST`: тестовая отправка действительно приходит инициатору.
- `MSG-006 MUST`: статистика delivered/failed/blocked считается по фактическому результату.
- `MSG-007 MUST`: тарифные лимиты проверяются атомарно.
- `MSG-008 SHOULD`: шаблоны, отложенный запуск, отмена до старта и повтор неуспешных.

### 8.11. AI-помощник

- `AI-001 MUST`: provider API key хранится только на сервере в secrets manager.
- `AI-002 MUST`: браузер не может задавать произвольный provider URL.
- `AI-003 MUST`: backend формирует минимальный контекст без лишних PII.
- `AI-004 MUST`: запрос, tenant, модель, стоимость, latency и результат политики журналируются без раскрытия полного чувствительного текста в обычных логах.
- `AI-005 MUST`: quotas и rate limits применяются по тарифу.
- `AI-006 MUST`: AI не выполняет изменение данных без отдельного подтверждения пользователя и серверной проверки прав.
- `AI-007 MUST`: предусмотрен режим полного отключения AI для компании.
- `AI-008 SHOULD`: redaction персональных данных перед внешним провайдером.
- `AI-009 SHOULD`: fallback при недоступности провайдера.

### 8.12. Поддержка и Super Admin

- `ADM-001 MUST`: platform roles хранятся серверно отдельно от company roles.
- `ADM-002 MUST`: список компаний, пользователей и платежей имеет pagination и фильтры.
- `ADM-003 MUST`: блокировка, смена тарифа, refund и impersonation требуют причины.
- `ADM-004 MUST`: опасные операции имеют confirm + step-up auth.
- `ADM-005 MUST`: все admin actions попадают в неизменяемый audit log.
- `ADM-006 MUST`: frontend error tracker получает release, route, user/tenant pseudonymous ID и correlation ID.
- `ADM-007 MUST`: support ticket имеет status, priority, category, tenant, сообщения, исполнителя и SLA timestamps.
- `ADM-008 MUST`: support agent не получает PII автоматически; доступ выдаётся по необходимости.
- `ADM-009 SHOULD`: feature flags и staged rollout управляются централизованно.

### 8.13. Локализация и доступность

- `UX-001 MUST`: RU, KK и EN покрывают 100% пользовательских строк; hardcoded русский текст запрещён ESLint/проверкой каталога переводов.
- `UX-002 MUST`: даты, числа, деньги и plural forms форматируются locale-aware.
- `UX-003 MUST`: валюта берётся из company/branch settings.
- `UX-004 MUST`: все экраны имеют семантический заголовок.
- `UX-005 MUST`: icon-only controls имеют `aria-label`.
- `UX-006 MUST`: input/textarea/select связаны с label через `for/id` или `aria-labelledby`.
- `UX-007 MUST`: управление доступно клавиатурой, focus не теряется в modal/sheet.
- `UX-008 MUST`: контраст и target size соответствуют принятому accessibility baseline.
- `UX-009 MUST`: поддерживается `prefers-reduced-motion`.
- `UX-010 MUST`: интерфейс проверяется в Telegram Android, iOS и Desktop, а также обычных мобильных браузерах.
- `UX-011 SHOULD`: Super Admin и большие календари имеют tablet/desktop layout.
- `UX-012 MUST`: offline/degraded состояние видно пользователю; success не показывается до подтверждения сервера.

## 9. Telegram-бот и Mini App

### 9.1. Общие требования

- Бот и Mini App используют одинаковую авторитетную БД через backend API.
- В боте не должно быть отдельной модели расписания, отдельного списка бронирований или псевдослучайной занятости.
- Стабильные идентификаторы услуги, сотрудника, филиала и записи используются во всех callback payload.
- Callback не должен содержать относительный номер дня или индекс элемента в массиве.
- Устаревший callback возвращает понятное сообщение и предлагает открыть актуальный экран.
- Обработка Telegram update идемпотентна по `update_id`.
- Update считается обработанным только после успешной фиксации результата либо помещения в durable retry/DLQ.
- Ошибка одной команды не должна приводить к потере следующего update или остановке worker.

### 9.2. Рекомендуемая схема работы бота

- Production: Telegram webhook на отдельный endpoint backend.
- Допустимый резервный режим: один long-polling worker с leader lease и мониторингом.
- Webhook имеет секретный path/token и дополнительную проверку Telegram secret header, если поддерживается выбранной интеграцией.
- Update сначала записывается в inbox table, затем обрабатывается идемпотентно.
- Исходящие сообщения идут через notification outbox, а не напрямую из бизнес-транзакции.
- Rate limit, `retry_after`, 429 и временные 5xx обрабатываются worker.

### 9.3. Меню клиента

- Открыть страницу выбранной компании.
- Записаться.
- Мои записи.
- Услуги и цены.
- Адрес и контакты.
- Перенос/отмена доступной записи.
- Управление уведомлениями и согласием.
- Переход в каталог.

### 9.4. Меню бизнеса

- Кабинет.
- Календарь.
- Клиенты согласно permissions.
- Публичная ссылка.
- Подписка.
- Поддержка.
- Переключение только между компаниями, где пользователь имеет membership.

### 9.5. Требования Mini App

- Mini App отправляет `initData` только на auth exchange endpoint.
- Приложение не использует `initDataUnsafe` как доказательство identity.
- Состояние роли и tenant получается из `/me`.
- Прямой ввод hash/URL чужой роли возвращает `403`/безопасный экран, а не данные.
- Клиентские debug exports, DEV dock, demo time machine и seed reset исключаются из production build.
- Telegram BackButton, safe area, theme, requestContact и закрытие приложения проверяются в поддерживаемых версиях Telegram.

## 10. Целевая архитектура

### 10.1. Компоненты

Рекомендуемый reference stack:

| Компонент | Рекомендуемая реализация | Назначение |
|---|---|---|
| Web frontend | текущие ES modules с production build либо TypeScript/Vite | Mini App и web-интерфейс |
| Backend API | Python 3.12 + FastAPI | auth, RBAC, CRUD, slots, payments, admin |
| ORM/migrations | SQLAlchemy 2 + Alembic | схема и миграции PostgreSQL |
| Основная БД | PostgreSQL 16+ | source of truth и транзакции |
| Cache/queue coordination | Redis | rate limits, short locks, cache, worker coordination |
| Worker | Python worker framework с поддержкой retry | уведомления, рассылки, exports, AI jobs |
| Bot adapter | webhook handler | команды и callback Telegram |
| Object storage | S3-compatible | изображения, exports и вложения |
| Reverse proxy | Caddy/Nginx/managed ingress | TLS, headers, limits, routing |
| Observability | OpenTelemetry + metrics/log/error backend | traces, metrics, errors и alerts |

Допускается эквивалентный стек, если сохраняются контракты, транзакции, безопасность и эксплуатационные требования ТЗ.

### 10.2. Принципы архитектуры

- Backend stateless; состояние сессий и данных не хранится на локальном диске контейнера.
- PostgreSQL — единственный источник бизнес-данных.
- Redis не является единственным хранилищем критичных данных.
- Все фоновые задания восстанавливаются после перезапуска.
- Платежные события и Telegram updates идемпотентны.
- Внутренние события создаются в той же транзакции, что и бизнес-изменение, через transactional outbox.
- Миграции БД версионируются и запускаются отдельным release step.
- Публичные и приватные API логически разделены.
- Все tenant-owned таблицы имеют `company_id`; branch-owned также `branch_id`.
- Repository/service layer не позволяет выполнить tenant query без scope.

### 10.3. Контуры окружений

- `local`: локальная разработка с тестовыми ключами и fixture-данными.
- `test`: автоматические integration tests.
- `staging`: максимально идентичен production, отдельный bot и payment sandbox.
- `production`: реальные пользователи и провайдеры.

Данные и секреты окружений не пересекаются. Production dump запрещено использовать в development без утверждённой анонимизации.

## 11. Модель данных

Ниже задан обязательный логический состав. Физическая схема уточняется ERD и миграциями.

### 11.1. Identity и tenancy

#### `users`

- `id UUID PK`;
- `telegram_user_id BIGINT UNIQUE NOT NULL`;
- `username`, `first_name`, `last_name`, `language_code`;
- `status` (`active`, `blocked`, `deleted`);
- `created_at`, `updated_at`, `last_seen_at`;
- `deleted_at` для soft delete/anonymization workflow.

#### `sessions`

- `id UUID PK`, `user_id FK`;
- hash refresh token;
- device/session metadata без избыточного fingerprinting;
- `created_at`, `expires_at`, `revoked_at`, `last_used_at`.

#### `companies`

- `id UUID PK`, `name`, `slug UNIQUE`;
- `category`, `status`, `default_locale`, `currency_code`;
- `subscription_id`, `published_at`;
- `created_at`, `updated_at`, `deleted_at`.

#### `branches`

- `id UUID PK`, `company_id FK`;
- `name`, `slug`, `address`, `phone`, `email`;
- `latitude`, `longitude`;
- `timezone` в формате IANA;
- `status`, `published_at`.

#### `memberships`

- `id UUID PK`, `company_id FK`, `user_id FK`;
- `role`, `status`, `permissions JSONB`;
- `created_at`, `activated_at`, `terminated_at`;
- unique активного membership пользователя в компании.

### 11.2. Каталог и расписание

#### `service_categories`

- `id`, `company_id`, `name`, `color`, `sort_order`, `active`.

#### `services`

- `id`, `company_id`, optional `branch_id`;
- `category_id`, `name`, `description`;
- `price_minor BIGINT`, `currency_code`;
- `duration_minutes`, `buffer_before_minutes`, `buffer_after_minutes`;
- `active`, `public`, `sort_order`;
- `media_asset_id`, timestamps.

#### `employees`

- `id`, `company_id`, `user_id nullable`;
- `display_name`, `role_title`, `phone`;
- `takes_appointments`, `active`, `rating`;
- `media_asset_id`, timestamps.

#### `employee_branches`, `employee_services`

Связи many-to-many с уникальными составными ключами.

#### `weekly_schedule_rules`

- `id`, `company_id`, `branch_id`, `employee_id nullable`;
- `weekday`, `start_local_time`, `end_local_time`;
- период действия `valid_from/valid_to`;
- признак активности.

#### `schedule_breaks`

- ссылка на rule либо конкретную дату;
- начало/конец local time.

#### `schedule_exceptions`

- `id`, tenant scope, employee/branch;
- `starts_at timestamptz`, `ends_at timestamptz`;
- type (`blocked`, `break`, `vacation`, `sick`, `custom_open`);
- причина, создатель, timestamps.

### 11.3. Клиенты и записи

#### `clients`

- `id`, `company_id`;
- `user_id nullable` для подтверждённой Telegram identity;
- `display_name`, normalized phone, Telegram username snapshot;
- `source`, `status`, `consent_status`;
- `created_at`, `updated_at`, `anonymized_at`.

Ограничение: один подтверждённый `user_id` не создаёт автоматически чужую карточку; связывание выполняется в tenant scope.

#### `client_notes`, `client_tags`, `client_tag_links`

- отдельные сущности с автором, временем, visibility и audit.

#### `appointments`

- `id UUID/ULID PK`;
- `company_id`, `branch_id`, `client_id`, `employee_id`;
- `starts_at timestamptz`, `ends_at timestamptz`;
- `status`, `source`, `created_by_user_id`;
- `price_minor`, `currency_code`, `duration_minutes` snapshot;
- `client_comment`, `internal_note`;
- `payment_status`, `version` для optimistic concurrency;
- timestamps и cancellation fields.

Обязательная защита: активные интервалы одного сотрудника не пересекаются. Предпочтительно PostgreSQL exclusion constraint по `tstzrange(starts_at, ends_at)` для бронирующих статусов.

#### `appointment_services`

- `appointment_id`, `service_id`;
- snapshot name, price, duration, buffers;
- sort order.

#### `appointment_events`

- append-only история статусов, переносов, изменения мастера, цены и инициатора;
- `event_type`, `actor_user_id`, `before JSONB`, `after JSONB`, timestamp.

#### `reviews`

- `id`, `appointment_id UNIQUE`, tenant scope;
- `rating 1..5`, `comment`, `status`;
- company reply, timestamps.

### 11.4. Приглашения

#### `team_invites`

- `id`, `company_id`, optional `branch_id`;
- `token_hash UNIQUE`;
- роль и permissions;
- `created_by`, `expires_at`, `used_at`, `used_by`, `revoked_at`;
- consume выполняется условным UPDATE в транзакции.

### 11.5. Тарифы и платежи

#### `plans`, `plan_entitlements`

- стабильный plan code, display name, billing period;
- price_minor, currency, active;
- лимиты и feature entitlements хранятся типизированно, а не только текстом.

#### `subscriptions`

- `id`, `company_id UNIQUE`, `plan_id`;
- status (`trialing`, `active`, `past_due`, `grace`, `suspended`, `cancelled`);
- period start/end, grace end, auto-renew;
- provider customer/subscription references;
- timestamps.

#### `payment_orders`

- `id`, `company_id`, optional `appointment_id`;
- type (`platform_subscription`, `client_service`, `deposit`);
- amount, currency, status;
- provider, provider order reference;
- idempotency key UNIQUE в требуемом scope;
- created/expired/paid timestamps.

#### `payment_transactions`

- order ID, direction, provider transaction ID UNIQUE;
- amount, currency, status;
- raw provider payload reference с защищённым хранением;
- created/confirmed/failed timestamps.

#### `provider_events`

- provider event ID UNIQUE;
- signature verification status;
- received/processed timestamps;
- processing error и retry count.

#### `refunds`

- order/transaction ID, amount, reason, status;
- provider refund ID UNIQUE;
- requester/approver и timestamps.

### 11.6. Коммуникации и эксплуатация

#### `notification_jobs`

- tenant/user/appointment references;
- channel, template, recipient Telegram ID;
- scheduled_at, status (`pending`, `processing`, `sent`, `retry`, `failed`, `cancelled`);
- attempt count, next_attempt_at, provider response code;
- idempotency key UNIQUE.

#### `broadcasts`, `broadcast_recipients`

- audience snapshot, consent state, delivery status и фактические результаты.

#### `support_tickets`, `ticket_messages`

- tenant, author, assignee, category, priority, status и SLA timestamps.

#### `audit_events`

- append-only;
- actor, role, tenant, action, target type/id;
- correlation ID, timestamp, redacted before/after;
- retention согласно политике.

#### `media_assets`

- owner tenant, type, object key, MIME, size, checksum;
- processing status и variants;
- запрещено хранить публичный write URL.

#### `outbox_events`, `inbox_events`

- надёжная доставка внутренних событий и идемпотентная обработка Telegram/provider webhook.

## 12. API

### 12.1. Общие правила

- Base path: `/api/v1`.
- JSON UTF-8; даты только ISO 8601 с timezone.
- Денежные значения — integer minor units + ISO currency code.
- Все write-запросы имеют request/correlation ID.
- Критические POST поддерживают `Idempotency-Key`.
- Pagination: cursor-based; offset допускается только для малых admin-справочников.
- Ошибка имеет единый формат: `code`, `message`, `details`, `request_id`.
- Stack trace и внутренние исключения клиенту не возвращаются.
- `409` используется для slot/version/idempotency conflict.
- `422` — ошибка бизнес-валидации.
- `401` — отсутствующая/невалидная сессия; `403` — недостаточно прав.
- OpenAPI является обязательным артефактом и проходит contract tests.

### 12.2. Auth и профиль

| Метод | Endpoint | Назначение |
|---|---|---|
| POST | `/auth/telegram/exchange` | Проверить initData и создать сессию |
| POST | `/auth/refresh` | Обновить сессию |
| POST | `/auth/logout` | Отозвать текущую сессию |
| GET | `/me` | Профиль, memberships, активный tenant и permissions |
| PATCH | `/me/profile` | Имя, телефон и locale с валидацией |
| GET | `/me/appointments` | Только собственные записи клиента |

### 12.3. Публичные endpoint

| Метод | Endpoint | Назначение |
|---|---|---|
| GET | `/public/companies` | Каталог с filters/cursor |
| GET | `/public/companies/{slug}` | Публичная карточка |
| GET | `/public/companies/{slug}/services` | Активные публичные услуги |
| GET | `/public/companies/{slug}/staff` | Публичные мастера |
| GET | `/public/companies/{slug}/availability` | Даты/слоты с ограниченным горизонтом |

Публичные endpoint не возвращают CRM, membership, финансы, private contacts, внутренние IDs и приглашения.

### 12.4. Компания

| Метод | Endpoint | Назначение |
|---|---|---|
| POST | `/companies` | Регистрация компании |
| GET/PATCH | `/companies/{id}` | Получение/изменение настроек |
| POST | `/companies/{id}/publish` | Публикация после server checklist |
| GET/POST | `/companies/{id}/branches` | Филиалы |
| GET/POST | `/companies/{id}/services` | Услуги |
| PATCH | `/companies/{id}/services/{service_id}` | Изменение/деактивация |
| GET/POST | `/companies/{id}/employees` | Команда |
| PATCH | `/companies/{id}/employees/{employee_id}` | Профиль/статус |
| POST | `/companies/{id}/employees/{employee_id}/terminate` | Увольнение с планом записей |

### 12.5. График и запись

| Метод | Endpoint | Назначение |
|---|---|---|
| GET/PUT | `/companies/{id}/schedule/rules` | Графики |
| GET/POST | `/companies/{id}/schedule/exceptions` | Блокировки и отсутствия |
| GET | `/companies/{id}/availability` | Server slot engine |
| POST | `/companies/{id}/appointments` | Атомарное создание |
| GET | `/companies/{id}/appointments` | Calendar query |
| GET | `/companies/{id}/appointments/{appointment_id}` | Детали |
| POST | `/companies/{id}/appointments/{appointment_id}/reschedule` | Перенос |
| POST | `/companies/{id}/appointments/{appointment_id}/cancel` | Отмена |
| POST | `/companies/{id}/appointments/{appointment_id}/complete` | Завершение |
| POST | `/companies/{id}/appointments/{appointment_id}/no-show` | Неявка |

Frontend не отправляет вычисленный флаг `free`; backend всегда проверяет занятость повторно.

### 12.6. CRM, аналитика и коммуникации

- `/companies/{id}/clients` — search/list/create;
- `/companies/{id}/clients/{client_id}` — card/update;
- `/companies/{id}/clients/{client_id}/notes` — notes с permissions;
- `/companies/{id}/reviews` — список и ответ;
- `/companies/{id}/finance/transactions` — операции;
- `/companies/{id}/analytics/*` — агрегаты по периоду;
- `/companies/{id}/broadcasts` — draft/list/create;
- `/companies/{id}/broadcasts/{id}/send` — enqueue;
- `/companies/{id}/exports` — асинхронные exports;
- `/companies/{id}/audit` — журнал в доступном scope.

### 12.7. Приглашения

| Метод | Endpoint | Назначение |
|---|---|---|
| POST | `/companies/{id}/invites` | Создать токен и вернуть его один раз |
| GET | `/invites/{token}/preview` | Минимальное публичное preview |
| POST | `/invites/{token}/accept` | Атомарно создать membership |
| POST | `/companies/{id}/invites/{invite_id}/revoke` | Отозвать |

Глобальный `GET /invites` запрещён.

### 12.8. Billing и payments

- `GET /billing/plans`;
- `GET /companies/{id}/subscription`;
- `POST /companies/{id}/subscription/orders`;
- `POST /appointments/{id}/payment-orders`;
- `GET /payment-orders/{id}` в разрешённом scope;
- `POST /payments/{provider}/webhook` без пользовательской auth, но с обязательной provider signature verification;
- `POST /payments/{order_id}/refunds` с permission и idempotency;
- admin reconciliation endpoints отдельно от пользовательских.

## 13. Серверный slot engine

### 13.1. Входные данные

- компания и филиал;
- timezone филиала;
- услуга или набор услуг;
- выбранный сотрудник либо «любой»;
- дата/период;
- график филиала и сотрудника;
- перерывы и исключения;
- buffers;
- active appointments;
- lead time, booking horizon и шаг сетки;
- entitlement/status компании.

### 13.2. Выход

- UTC timestamp начала и конца;
- локальное отображение;
- employee ID;
- рассчитанная цена и длительность;
- краткоживущий opaque availability token либо version для защиты от устаревшего UI.

### 13.3. Транзакция создания записи

1. Проверить auth, tenant и permission.
2. Проверить company/branch/subscription status.
3. Проверить услугу, сотрудника и их связь.
4. Нормализовать время в UTC через branch timezone.
5. Проверить график, исключения и lead time.
6. Попытаться вставить appointment под constraint пересечения.
7. При конфликте вернуть `409 SLOT_TAKEN` и актуальные альтернативы.
8. Зафиксировать appointment event и outbox events в той же транзакции.
9. Вернуть подтверждённую запись.

Никакая предварительная проверка availability не заменяет шаг 6.

## 14. Платёжный контур

### 14.1. Виды платежей

1. Оплата тарифа компанией.
2. Продление/смена тарифа.
3. Предоплата или полная оплата услуги клиентом.
4. Возврат полный или частичный.

Конкретный первый провайдер выбирается после подтверждения договора, API, требований юрисдикции и фискализации. Бизнес-логика не должна зависеть от одного провайдера.

### 14.2. Создание платежа

- Сумму, валюту, назначение и получателя рассчитывает backend.
- Frontend не может передать произвольную итоговую сумму.
- Order создаётся до обращения к provider.
- Повторный запрос с тем же idempotency key возвращает тот же order.
- Provider redirect/invoice payload связывается с внутренним order ID.
- Секретные provider credentials находятся только на backend.

### 14.3. Webhook

- Сохраняется raw event либо его защищённая ссылка.
- Подпись проверяется до изменения бизнес-данных.
- Provider event ID уникален.
- Повторный webhook безопасен.
- Статус заказа меняется одной транзакцией с subscription/appointment payment state.
- Клиентский redirect не является подтверждением оплаты.
- Неизвестный или неверно подписанный event не применяется и создаёт security signal.

### 14.4. Подписки и entitlement

- Backend проверяет entitlement на каждом защищённом действии.
- Статусы: trial, active, past due, grace, suspended, cancelled.
- Grace policy конфигурируется.
- При окончании подписки ранее созданные данные не удаляются.
- Владелец сохраняет доступ к оплате, экспорту и поддержке.
- Ограничения staff/services/broadcasts проверяются атомарно.
- Downgrade не удаляет данные автоматически; UI требует привести использование к лимиту.

### 14.5. Возвраты и сверка

- Refund создаётся сервером с permission и причиной.
- Сумма возврата не превышает доступный остаток.
- Повторный запрос идемпотентен.
- Ежедневная reconciliation job сверяет внутренние paid/refunded операции с provider.
- Несовпадение создаёт alert и admin case.
- Должны быть предусмотрены failed, delayed, duplicate, chargeback и manual review сценарии.

## 15. Уведомления и фоновые задачи

### 15.1. Типы уведомлений

- подтверждение записи;
- напоминание за настраиваемое время, по умолчанию 24 часа и 2 часа;
- перенос и отмена;
- освободившееся окно/waitlist;
- запрос отзыва;
- дневная сводка сотруднику;
- истечение подписки и результат оплаты;
- служебные сообщения платформы;
- рассылки компании.

### 15.2. Надёжность

- Notification job создаётся в БД.
- Успех фиксируется только после успешного ответа provider.
- 429 использует `retry_after`.
- Временные ошибки используют exponential backoff + jitter.
- Постоянные ошибки переводятся в `failed`/suppression.
- После заданного количества попыток задача попадает в DLQ и alert.
- Отмена/перенос записи отменяет устаревшие jobs.
- У каждого сообщения есть idempotency key.
- Worker безопасно переживает рестарт в середине отправки.

### 15.3. Время

- В БД хранится UTC.
- Филиал хранит IANA timezone.
- Шаблоны получают локальную дату/время филиала.
- Изменение timezone имеет preview влияния на будущие записи.
- Автотесты покрывают границы суток и DST даже если начальный рынок обычно не использует DST.

## 16. Медиафайлы

- Загрузка выполняется через backend-authorized presigned URL или streaming endpoint.
- Разрешены только утверждённые MIME и расширения.
- Проверяется реальный тип содержимого, размер и dimensions.
- Генерируются thumbnail/small/large variants.
- Метаданные очищаются по принятой privacy policy.
- Объекты имеют случайные ключи, tenant ownership и lifecycle policy.
- Удаление сущности не должно немедленно необратимо удалять файл до истечения recovery window.
- CDN URL не даёт права записи.
- Небезопасные SVG/HTML uploads запрещены либо санитизируются отдельным безопасным процессом.

## 17. Информационная безопасность

### 17.1. Модель угроз

До production команда должна провести threat modeling минимум для следующих границ:

- Telegram client → Mini App;
- Mini App → API;
- Telegram webhook → bot service;
- API/worker → PostgreSQL, Redis и object storage;
- backend → AI/payment/messaging providers;
- admin/support → данные клиентов;
- CI/CD → registry и production environment.

Для каждой угрозы фиксируются актив, возможный нарушитель, сценарий атаки, вероятность, ущерб, компенсирующие меры и владелец риска. Обязательные сценарии: подмена Telegram-пользователя, horizontal/vertical privilege escalation, IDOR между компаниями, повтор webhook, захват invite, массовый подбор идентификаторов, утечка токенов, XSS через пользовательский контент, CSV injection, SSRF через URL, вредоносная загрузка, booking/payment race condition, злоупотребление рассылками и выгрузка всей клиентской базы.

### 17.2. Аутентификация и сессии

- `initData` валидируется только сервером по официальному алгоритму Telegram.
- Проверяются hash/signature, `auth_date`, допустимый возраст, bot identity и обязательные поля.
- Нельзя доверять `user`, `role`, `companyId`, `plan` и permissions из клиентского состояния.
- После проверки выдаётся короткоживущая серверная сессия или access token.
- Refresh/session rotation защищена от повторного использования.
- Logout и отзыв доступа инвалидируют серверную сессию.
- Сессии администратора и поддержки имеют сокращённый TTL и усиленный аудит.
- При изменении membership/permissions ранее выданные права прекращают действовать в установленный SLA.
- Для вне-Telegram admin interface обязательна MFA.
- Все auth failures логируются без токенов и полного `initData`.

### 17.3. Авторизация и tenant isolation

- Каждая операция с данными компании проверяет membership и конкретный permission на backend.
- Tenant/company scope выводится из авторизованного контекста, а не принимается как доверенный параметр.
- Object-level authorization проверяется после загрузки сущности и до раскрытия данных.
- Public endpoints возвращают только явно опубликованные поля.
- Поддержка получает временный, обоснованный и аудируемый доступ; режим impersonation визуально заметен.
- SQL-запросы, cache keys, object storage keys и background jobs содержат tenant scope.
- Автотесты специально пытаются прочитать и изменить объекты другого tenant.

### 17.4. Секреты и криптография

- Bot token, DB credentials, payment/AI keys и signing secrets не попадают в frontend bundle, localStorage, Git, логи, аналитические события или сообщения об ошибках.
- Секреты хранятся в secret manager/environment injection с разграничением по средам.
- Определён регламент rotation и экстренного отзыва.
- Весь внешний трафик использует TLS; внутренний трафик защищается согласно инфраструктурной модели.
- Чувствительные данные шифруются at rest средствами managed storage или отдельным application-level encryption, где это необходимо.
- Backup зашифрован отдельным ключом и доступен ограниченному кругу ролей.
- Пароли, если появятся вне Telegram, хешируются современным password hashing алгоритмом; обратимое хранение запрещено.

### 17.5. Защита API и интерфейса

- Ввод валидируется по allowlist-схемам; неизвестные поля отклоняются или игнорируются предсказуемо.
- Строки имеют ограничения длины; числовые значения, даты, URL и enum проверяются строго.
- Все SQL-операции параметризованы через ORM/query builder.
- HTML/Markdown/имена/комментарии выводятся с корректным escaping.
- CSP, `frame-ancestors`, HSTS, `X-Content-Type-Options`, `Referrer-Policy` и ограниченная `Permissions-Policy` настроены согласно Telegram Mini App.
- CORS содержит только разрешённые origins, методы и headers.
- CSRF-модель документирована для выбранного типа сессии.
- Rate limit вводится для auth, public search, booking, invites, review, AI, broadcasts, upload и support endpoints.
- Защита от enumeration возвращает безопасные ошибки и ограничивает частоту.
- Pagination и экспорт имеют server-side limits.
- Пользовательские URL, импорт и provider callbacks защищены от SSRF.

### 17.6. Платёжная безопасность

- Номер карты, CVC и другие полные платёжные реквизиты не проходят через систему, если это не требуется выбранной сертифицированной схемой.
- Provider webhook проверяется по подписи, timestamp и replay policy.
- Денежные суммы хранятся в минимальных денежных единицах целым числом с currency.
- Все финансовые изменения имеют immutable audit trail.
- Ручная смена paid/refunded статуса требует отдельного permission и причины.
- Финансовые endpoints имеют более строгие rate limits и alerts.

### 17.7. Безопасность разработки

- В CI работают secret scanning, dependency audit, SAST и container/image scanning.
- Pull request не может быть смержен при critical/high vulnerability без формального исключения владельца безопасности.
- Production dependencies зафиксированы lockfile; обновления проходят тесты.
- Административные debug endpoints, source maps и dev tools не публикуются без осознанной настройки.
- Ошибки в production не раскрывают stack trace, SQL, ключи, внутренние пути и персональные данные.
- До запуска проводится независимый security review или penetration test критических потоков.

### 17.8. Security incident response

- Определены severity, контакты, on-call, канал эскалации и шаблон инцидента.
- Команда умеет отозвать bot/payment/AI credentials, заблокировать пользователя/tenant и остановить опасный endpoint.
- Сохраняются пригодные для расследования audit/security logs.
- Есть сценарии уведомления затронутых пользователей и регуляторов в зависимости от юрисдикции.
- После инцидента выполняется postmortem с corrective actions и сроками.

## 18. Персональные данные, юридические требования и контент

Юридические формулировки и конкретные сроки хранения утверждаются профильным юристом для фактических стран работы. Реализация должна поддерживать утверждённую политику, а не зашивать предположения в код.

### 18.1. Обязательные документы

- пользовательское соглашение;
- политика конфиденциальности и обработки персональных данных;
- согласие на необходимые коммуникации;
- отдельные правила рекламных/маркетинговых сообщений;
- условия подписки, оплаты, автопродления и возврата;
- публичная оферта/условия для компаний, если применимо;
- правила публикации отзывов и пользовательского контента;
- реквизиты оператора и рабочие контакты поддержки.

Версия и время принятия юридически значимых документов сохраняются. При существенном обновлении система запрашивает повторное согласие там, где это требуется.

### 18.2. Privacy requirements

- Собираются только данные, необходимые для продукта и заявленных целей.
- Для каждого типа данных определены purpose, lawful basis/consent, owner, retention и recipients.
- Клиенту доступна информация о том, какая компания получает его данные при записи.
- Владелец компании видит только данные своих клиентов в рамках законной цели.
- Предусмотрены запросы на доступ, исправление, экспорт, ограничение и удаление данных.
- Удаление учитывает обязательное хранение финансовых документов и antifraud/audit данных.
- Удалённые данные исключаются из активных систем, cache, поисковых индексов и очередей; backup следует утверждённому retention cycle.
- Analytics и error tracking не получают лишние ФИО, телефоны, текст заметок и токены.
- Неproduction среды используют синтетические или обезличенные данные.

### 18.3. Коммуникации и согласия

- Транзакционные уведомления отделены от маркетинговых.
- Рекламная рассылка возможна только по допустимому основанию и с учётом opt-in/opt-out.
- Отписка применяется до следующей отправки и не блокирует обязательные сервисные сообщения.
- Источник, версия и время согласия сохраняются.
- Сегменты не должны раскрывать чувствительные признаки другим получателям.

### 18.4. Контент и модерация

- Определены запрещённые материалы и процедура жалобы.
- Отзывы и медиа имеют status moderation, причину скрытия и audit trail.
- Администратор может ограничить компанию, контент или пользователя без физического удаления доказательств.
- Пользователь видит понятное объяснение блокировки и доступный канал обжалования, когда это допустимо.

## 19. Нефункциональные требования

### 19.1. Доступность и SLO

До запуска владелец продукта утверждает измеримые SLO. Начальная целевая рамка:

- доступность public booking и подтверждения оплаты — не ниже 99,9% в месяц;
- доступность кабинета компании — не ниже 99,5% в месяц;
- успешная обработка валидных Telegram/payment webhooks — не ниже 99,95% с учётом повторов;
- критические фоновые задачи не теряются;
- error budget используется при принятии решений о новых релизах.

Плановое обслуживание объявляется заранее и учитывается по утверждённой политике. Статус внешнего provider не должен маскироваться как внутренний успех.

### 19.2. Производительность

При согласованной стартовой нагрузке:

- p95 чтения API без внешнего provider — до 500 мс;
- p95 мутаций API без внешнего provider — до 800 мс;
- p95 получения доступных слотов — до 1 с;
- стартовый экран Mini App на целевом мобильном соединении показывает полезный skeleton/content в установленный performance budget;
- поиск и основные списки поддерживают pagination и не загружают весь tenant в память;
- webhook подтверждается provider в допустимый срок, тяжёлая работа переносится в очередь.

Конкретные значения пересматриваются после baseline load test и фиксируются в release acceptance profile.

### 19.3. Масштабирование и ёмкость

- API и workers по возможности stateless и масштабируются горизонтально.
- PostgreSQL является единственным источником истины для транзакционных данных.
- Redis не является единственным хранилищем бизнес-состояния.
- Для очередей определены concurrency, retry, DLQ и backpressure.
- Capacity model включает MAU/DAU, companies, employees, appointments/day, peak RPS, reminders/minute, broadcast recipients, media volume, payment webhooks и growth factor.
- Load test должен превышать прогнозируемый пик минимум на согласованный запас.
- Large tenant не должен деградировать работу всех остальных tenants.

### 19.4. Надёжность и консистентность

- Booking, invite acceptance, plan limits, payment transition и refund выполняются транзакционно.
- Для внешних side effects применяется outbox/inbox или эквивалентный надёжный паттерн.
- Все повторяемые команды имеют idempotency strategy.
- Приложение не показывает окончательный успех до подтверждения authoritative backend state.
- При timeout клиент может безопасно повторить запрос и получить результат предыдущей операции.
- Деградация AI, analytics, CDN или необязательных уведомлений не останавливает основную запись.

### 19.5. Совместимость

- Утверждается матрица поддерживаемых версий Telegram iOS, Android, Desktop и Web.
- Основные сценарии тестируются на iOS/Android устройствах и Telegram WebView, а не только в desktop browser.
- Учитываются safe areas, virtual keyboard, back button, theme params, reduced motion и системный размер шрифта.
- Неподдерживаемый клиент получает понятное сообщение и безопасную альтернативу.

### 19.6. Доступность интерфейса

- Цель — соответствие WCAG 2.2 AA для применимых экранов.
- Все действия доступны с клавиатуры там, где платформа её поддерживает.
- Есть видимый focus, семантические labels, связанные ошибки формы и корректный порядок чтения.
- Контраст текста и controls соответствует целевому уровню.
- Иконка без текста имеет accessible name.
- Toast не является единственным способом сообщить критическую информацию.
- Диалоги управляют focus и закрываются предсказуемо.

## 20. Наблюдаемость и эксплуатационная диагностика

### 20.1. Логи

- Используется структурированный JSON logging.
- Каждая запись содержит environment, service, version, timestamp, level, request/correlation ID и безопасный actor/tenant identifier.
- Секреты, полный `initData`, Authorization headers, номера карт и лишние персональные данные редактируются.
- Webhook, booking, payment, invite, permission change и admin action имеют сквозной correlation ID.
- Retention и доступ к логам разграничены.

### 20.2. Метрики

Минимальный набор:

- HTTP RPS, latency, error rate и saturation по endpoint/status;
- DB connections, query latency, locks, deadlocks и replication/backup status;
- queue depth, oldest job age, retries, DLQ;
- Telegram/provider API success, 429, timeouts и delivery latency;
- booking attempts/success/conflicts/cancellations;
- payment created/paid/failed/refunded, webhook lag и reconciliation mismatch;
- auth failures, rate-limit hits и suspicious access;
- frontend crash rate и Core Web Vitals;
- product funnel: catalog → card → slot → confirmation → completed appointment.

### 20.3. Tracing и error tracking

- Distributed tracing связывает API, DB, worker и provider calls для критических потоков.
- Frontend/backend exceptions попадают в error tracker с release/environment tags.
- Source maps доступны только error-tracking системе с контролируемым доступом.
- Error grouping не объединяет разные tenants в раскрывающий данные контекст.

### 20.4. Health checks и alerts

- `/live` проверяет, что процесс жив, без тяжёлых внешних запросов.
- `/ready` проверяет возможность безопасно принимать трафик и критические зависимости.
- Отдельно видны состояния DB, Redis/queue, bot webhook и worker heartbeat.
- Alerts настроены по пользовательскому эффекту и SLO, а не только по CPU.
- Для каждого critical/high alert есть runbook, owner и escalation path.
- Alert проверяется synthetic test или controlled failure до production launch.

## 21. Резервное копирование, восстановление и непрерывность

### 21.1. Цели восстановления

- RPO и RTO утверждаются владельцем бизнеса для БД, медиа и конфигурации.
- Начальная рекомендуемая цель для transactional database: RPO не более 15 минут, RTO не более 2 часов.
- Для платёжного контура допустимая потеря подтверждённых provider events — ноль за счёт повторов provider и inbox/reconciliation.

### 21.2. Backup

- Выполняются автоматические полные и инкрементальные/PITR backup согласно возможностям платформы.
- Backup хранится отдельно от основного production account/instance и шифруется.
- Доступ, запуск и удаление backup аудируются.
- Сроки хранения соответствуют юридической и recovery policy.
- Object storage использует versioning/lifecycle либо отдельную backup strategy.
- Секреты и инфраструктурная конфигурация восстанавливаются через документированный безопасный процесс.

### 21.3. Проверка восстановления

- Restore drill проводится до запуска и затем регулярно.
- Проверка выполняется на изолированном окружении с контролем утечки production данных.
- Тест подтверждает целостность записей, платежей, memberships, медиа-ссылок и миграций.
- Фактические RPO/RTO фиксируются, отклонения превращаются в задачи.
- Существует runbook действий при повреждении БД, ошибочной миграции, потере storage и недоступности региона/provider.

## 22. Инфраструктура, CI/CD и релизы

### 22.1. Infrastructure as Code

- Production, staging и базовые managed resources описаны кодом либо декларативной конфигурацией.
- Изменения проходят review и сохраняют историю.
- Права сервисных аккаунтов следуют least privilege.
- Production network не публикует PostgreSQL, Redis и internal workers в интернет.
- Egress к внешним providers ограничивается и наблюдается настолько, насколько позволяет платформа.
- Все ресурсы имеют owner, environment, service и cost tags.

### 22.2. Контейнеры и процессы

- Каждый deployable service имеет собственный health check и graceful shutdown.
- Контейнер работает не от root, использует read-only filesystem там, где возможно, и не содержит dev dependencies.
- Образ собирается повторяемо из lockfile и минимального base image.
- API, bot webhook, scheduler и worker не разделяют локальный JSON/файл как бизнес-хранилище.
- Несколько replicas безопасны: leader-only задачи имеют distributed lock либо запускаются специализированным scheduler.
- При SIGTERM сервис перестаёт принимать новые задачи и завершает/возвращает текущие в очередь.

### 22.3. CI pipeline

Для каждого pull request обязательны:

1. установка из lockfile;
2. lint и formatting check;
3. TypeScript/type check и Python static check;
4. unit tests;
5. component/integration tests;
6. сборка frontend/backend/container;
7. migration validation на чистой БД и на копии предыдущей схемы;
8. secret, dependency, SAST и image scanning;
9. проверка отсутствия accidental production config/secrets;
10. публикация тестовых отчётов и coverage.

Существующая ситуация, при которой frontend test script проверяет лишь наличие небольшого числа строк/файлов и даёт ложные падения, должна быть устранена. Проверки должны подтверждать поведение, а не структуру исходников.

### 22.4. CD и стратегия релиза

- Artifact один раз собирается и продвигается между средами без пересборки.
- Deployment выполняется из защищённой ветки/tag с approvals.
- Миграции БД совместимы с rolling deploy по схеме expand → migrate/backfill → contract.
- Перед переключением трафика выполняются readiness и smoke checks.
- Используется rolling, blue-green или canary стратегия с автоматическим rollback по health/SLO.
- Feature flags имеют owner, срок удаления и безопасное значение по умолчанию.
- Rollback приложения не должен ломаться из-за необратимой миграции.
- Каждый релиз имеет changelog, список миграций, риск, план проверки и rollback plan.

### 22.5. Конфигурация

- Конфигурация валидируется при старте; отсутствие обязательной переменной завершает процесс с понятной ошибкой.
- Значения по умолчанию не могут случайно включить demo mode, debug, fake payment или permissive CORS в production.
- Environment variables описаны в безопасном `.env.example` без секретов.
- Production URLs, bot name, provider mode и feature flags явно выводятся в release manifest, но секреты — нет.
- Clock/timezone контейнеров стандартизированы; бизнес-время вычисляется из timezone филиала.

### 22.6. Управление доступом

- Нет постоянного общего production admin account.
- Доступ выдаётся индивидуально, с MFA и журналированием.
- Deploy, data export, secret read и database access разделены по ролям.
- Emergency break-glass доступ ограничен временем и анализируется после использования.
- Периодически проводится access review сотрудников и сервисных аккаунтов.

## 23. Требования к frontend и UX-реализации

### 23.1. Удаление demo-архитектуры

- LocalStorage не является источником истины для пользователей, компаний, ролей, записей, клиентов, тарифов и оплат.
- Допускается хранить только безопасные пользовательские предпочтения: язык, тема, закрытые подсказки — без прав доступа и секретов.
- Seed/demo data не импортируется в production bundle и не показывается новому пользователю.
- Удаляются/выключаются dev dock, ручное переключение ролей, debug routes, fake notifications, fake AI/payment success и demo banners.
- Любой offline/network error показывает ошибку и возможность повторить; создание записи или оплаты не может завершаться локальным «успехом».
- Тестовые deep links и значения по умолчанию не ведут к чужой компании/клиенту.

### 23.2. Слой данных

- Все серверные данные загружаются через единый typed API client.
- Query/cache keys включают scope; invalidation следует mutation outcome.
- Optimistic update разрешён только с rollback и там, где конфликт безопасен.
- Для каждой страницы определены loading, empty, error, partial и permission-denied states.
- Повторный mount/navigation не создаёт дублирующие команды.
- Нельзя молча подменять ошибку API seed/local data.
- Abort/cancellation предотвращает обновление unmounted screen и race при быстром поиске.

### 23.3. Формы

- Схемы client validation синхронизированы с server validation.
- Поля имеют label, required marker, help/error text и формат ввода.
- Телефон нормализуется и валидируется с учётом утверждённых стран; email валидируется без чрезмерно строгих эвристик.
- Денежные значения вводятся и отображаются без floating-point ошибок.
- Даты и время всегда показывают timezone контекст там, где возможна неоднозначность.
- Submit блокируется только на время активного запроса; повторный submit не создаёт дубль.
- Server field errors отображаются рядом с полем, общие — в доступном summary.
- Несохранённые изменения защищены от случайного закрытия.

### 23.4. Навигация и Telegram integration

- BackButton соответствует реальной вложенности и не закрывает Mini App при наличии внутреннего шага.
- MainButton используется согласованно и не конфликтует с собственными fixed controls.
- ThemeParams применяются без flash некорректной темы.
- Viewport и safe-area обновляются при изменении высоты и открытии клавиатуры.
- Deep link после auth/onboarding возвращает пользователя к исходному контексту, если доступ разрешён.
- Системные confirm/haptic/openLink применяются только как progressive enhancement.
- В browser fallback Telegram-specific actions имеют понятную замену или сообщение.

### 23.5. Дизайн-система и состояния

- Цвета, spacing, typography, radius, elevation и motion вынесены в tokens.
- Buttons, inputs, select, date/time picker, dialog, sheet, toast, table/list, skeleton, empty state и error state имеют единые компоненты.
- Удаляется смешение языков, случайные emoji/иконки и несогласованные термины.
- Статусы записей, платежей и подписок имеют единый текст, цвет и icon semantics.
- Опасные действия отделены визуально и требуют подтверждения с описанием последствий.
- На малых экранах нет горизонтальной прокрутки основных форм и перекрытия CTA клавиатурой.

### 23.6. Производительность frontend

- Routes и тяжёлые компоненты загружаются лениво, если это уменьшает initial bundle.
- Изображения имеют размеры, современные форматы, placeholders и lazy loading.
- Большие списки используют pagination/virtualization по необходимости.
- Bundle analyzer работает в CI; устанавливается budget для initial JS/CSS и route chunks.
- Неиспользуемые demo libraries/assets удаляются.
- Нельзя блокировать первый рендер загрузкой всей CRM/analytics модели.

### 23.7. Аналитические события

- Имена событий и свойства описаны в tracking plan.
- Событие отправляется после реального действия/ответа, а не при простом рендере.
- `user_id`/`company_id` передаются в псевдонимизированном виде согласно privacy policy.
- Тексты заметок, телефоны, ФИО и payment payload не попадают в analytics.
- Основная воронка и ошибки booking/payment проверяются аналитическими тестами.

## 24. Backend hardening и устранение текущих технических ограничений

### 24.1. Хранилище

- Локальные JSON-файлы полностью исключаются из production read/write path.
- Все текущие сущности переносятся в PostgreSQL с foreign keys, unique/check constraints и indexes.
- Ограничения массивов/истории не достигаются молчаливым обрезанием важных данных.
- Изменения нескольких сущностей выполняются одной транзакцией.
- Concurrency tests подтверждают отсутствие lost update и двойной записи.

### 24.2. HTTP/API

- Public unauthenticated CRUD отсутствует.
- Endpoint объявляет schema request/response и documented status codes.
- Ошибки централизованно преобразуются в безопасный формат.
- Неизвестная сущность возвращает 404, недостаточное право — согласованный 403, конфликт версии/слота — 409.
- API не возвращает внутренние ORM/debug поля.
- List endpoints используют pagination, filtering, sorting allowlist и server limits.
- API docs защищены или отключены в production согласно политике.

### 24.3. Bot handlers

- У каждого callback есть уникальный handler и явная state machine.
- Устраняются дублирующие handlers и неоднозначные patterns, включая повторные обработчики одного callback.
- Callback data имеет версию, ограниченную длину и серверную проверку доступа.
- Долгие действия подтверждают callback быстро, дальнейшая работа идёт асинхронно.
- Повторное нажатие безопасно и не создаёт дубль.
- FSM state имеет TTL и корректный cancel/reset path.
- Ошибка пользователю локализована, а диагностический контекст попадает в logs.

### 24.4. Тарифные ограничения

- Ограничения сотрудников, услуг, филиалов, AI запросов, рассылок и других ресурсов описаны в едином entitlement service.
- Проверка выполняется на backend внутри транзакции изменения.
- Frontend показывает текущий usage/limit, но не является enforcement layer.
- Изменение тарифа имеет effective date и предсказуемо влияет на права.
- Race двух параллельных созданий не позволяет превысить лимит.

### 24.5. Администрирование

- Временные hard-coded admin IDs заменяются role/permission model.
- Массовые и необратимые операции требуют подтверждения, reason и audit.
- Просмотр персональных/финансовых данных минимизирован и журналируется.
- Support tooling не использует прямую правку БД как штатный процесс.

## 25. Миграция от demo к production

### 25.1. Инвентаризация demo-механик

До переноса составляется проверяемый реестр:

- seed users/companies/appointments/clients/reviews/payments;
- localStorage keys и версии client store;
- fake API adapters и offline success branches;
- role switch/dev dock/debug pages;
- mock AI/payment/notification providers;
- локальные JSON stores и test endpoints;
- placeholder links, реквизиты, тарифы, legal texts и support contacts;
- feature flags, которые по умолчанию включают demo behavior.

Для каждого элемента устанавливается одно действие: удалить, заменить production implementation, оставить только в отдельной demo/test среде.

### 25.2. Решение по существующим данным

- Demo/seed данные не импортируются автоматически в production.
- Если имеются реальные данные, владелец подтверждает их происхождение, согласия и необходимость переноса.
- Миграционный скрипт идемпотентен, имеет dry-run, validation report и rollback/compensation plan.
- Идентификаторы и связи сохраняются через mapping table; дубли пользователей/телефонов разбираются по утверждённым правилам.
- До импорта данные очищаются от фиктивных платежей, тестовых клиентов и секретов.
- Итоговые counts, суммы и связи сверяются до и после миграции.

### 25.3. Схема перехода

1. Заморозить изменение demo-схемы и зафиксировать inventory.
2. Создать production DB migrations и новый API.
3. Перевести frontend на API за feature flag.
4. Запустить end-to-end tests на staging с синтетическими данными.
5. Выполнить пробную миграцию и reconciliation.
6. Провести pilot с ограниченным числом компаний без скрытого demo fallback.
7. Исправить pilot issues и повторить go-live review.
8. Выполнить финальный import/cutover при необходимости.
9. Перекрыть legacy write path.
10. Наблюдать метрики и иметь ограниченное окно rollback.

### 25.4. Обратная совместимость

- Старые клиенты получают поддерживаемый ответ/upgrade prompt, а не повреждают новую модель.
- Версия API и minimum supported frontend version управляются сервером.
- Deep links, ранее выданные invites и незавершённые оплаты либо мигрируются, либо завершаются понятным сообщением.
- При dual-read/dual-write периоде источник истины и правила конфликта документированы; период ограничен датой удаления.

## 26. Стратегия тестирования

### 26.1. Общие требования

- Тесты автоматизированы настолько, насколько это экономически обосновано; критические денежные и booking сценарии не остаются только ручными.
- Для каждого requirement ID существует ссылка на тест, acceptance scenario либо формальное основание, почему он проверяется иначе.
- Tests изолированы, детерминированы и не зависят от порядка запуска.
- Время, timezone, provider responses и Telegram context подменяются контролируемыми test doubles.
- Flaky test не игнорируется бесконечно: он quarantined с owner, причиной и сроком исправления.
- Production secrets и реальные клиентские данные не используются.

### 26.2. Unit tests

Обязательное покрытие бизнес-логики:

- role/permission и tenant scope;
- slot generation, duration, buffers, exceptions и timezone;
- allowed appointment transitions;
- price/money calculation, discounts, commissions и refunds;
- plan entitlement и limits;
- invite lifecycle;
- consent/notification eligibility;
- payment/webhook state machine и idempotency;
- retry/backoff/DLQ decisions;
- validation/normalization;
- analytics aggregation и date boundaries.

Coverage не является единственной метрикой. Для критических модулей включается mutation testing либо review сценариев/ветвлений.

### 26.3. Database и integration tests

- Тесты выполняются на реальном PostgreSQL той же major version, а не только in-memory substitute.
- Проверяются migrations up/down там, где down допустим, constraints и indexes.
- Параллельные транзакции пытаются забронировать один слот и принять один invite.
- Outbox/inbox сохраняют события при падении между commit и отправкой.
- Redis/queue outage, duplicate delivery и worker restart не теряют задачи.
- Storage upload проверяет MIME, size, ownership и deletion policy.

### 26.4. Contract tests

- Frontend ↔ API schemas проверяются автоматически.
- Bot ↔ API и worker ↔ provider adapters имеют contract fixtures.
- Telegram webhook/callback payloads проверяются на поддерживаемых вариантах.
- Payment provider sandbox покрывает создание, success, failure, delayed webhook, duplicate, invalid signature, refund и reconciliation.
- AI provider adapter проверяет timeout, rate limit, malformed response и budget limit.

### 26.5. Frontend component tests

- Формы: required, invalid, server error, submit lock, retry.
- Route guards: unauthenticated, onboarding, wrong role, missing permission.
- Loading/empty/error/partial/offline states.
- Диалоги, focus management, keyboard и accessible names.
- Localization: interpolation, pluralization, long text и отсутствие untranslated keys.
- Money/date/time отображаются в заданной locale/timezone.

### 26.6. End-to-end tests

Минимальный blocking набор:

1. новый клиент открывает branded link, выбирает филиал/услугу/сотрудника/слот и создаёт запись;
2. повторная конкурентная запись того же слота отклоняется;
3. клиент видит, переносит и отменяет только свою запись;
4. новый владелец создаёт компанию, филиал, услуги, расписание и публикует карточку;
5. владелец приглашает сотрудника, сотрудник принимает invite один раз и видит только разрешённые разделы;
6. администратор вручную создаёт запись и клиента без дубля;
7. сотрудник завершает запись, клиент получает запрос и оставляет один отзыв;
8. создаётся subscription/payment order, валидный webhook активирует entitlement;
9. duplicate/invalid webhook не создаёт вторую оплату и не меняет статус;
10. отмена/перенос корректирует jobs и уведомления;
11. broadcast соблюдает consent, limits, retry и opt-out;
12. удаление/выход из компании немедленно лишает доступа;
13. Telegram deep link, BackButton и theme работают на целевых клиентах;
14. нет сети/500/timeout не приводят к ложному успеху;
15. support/admin action требует право и появляется в audit log.

### 26.7. Security tests

- Tampered/expired/missing `initData` отклоняется.
- Пользователь меняет company/object IDs и получает отказ без утечки.
- Client пытается вызвать owner/admin endpoint.
- Invite token нельзя подобрать, повторить или использовать после revoke/expiry.
- Rate limits покрываются автоматизированными сценариями.
- XSS/SQLi/CSV injection/SSRF/file upload abuse проверяются на релевантных входах.
- CORS/CSP/security headers проверяются в deployed environment.
- Secret scanner подтверждает отсутствие ключей в bundle/repository/artifacts.
- Dependency/image scan не содержит неразобранных critical/high issues.
- Перед запуском проводится DAST и ручная проверка критических authorization flows.

### 26.8. Performance и resilience tests

- Load profile моделирует реальный mix catalog, slot search, booking, dashboard, webhook и reminders.
- Spike test моделирует начало рабочего дня/рассылку/рекламную кампанию.
- Soak test выявляет leaks, рост queue lag и исчерпание connections.
- Conflict test создаёт параллельные booking/payment/invite/limit операции.
- Chaos/resilience scenarios: restart API/worker, временная недоступность DB/Redis/provider, slow provider, duplicate messages.
- После восстановления backlog обрабатывается без массовых дублей и нарушения rate limits provider.

### 26.9. Compatibility, localization и accessibility tests

- Device matrix включает реальные iOS/Android устройства с поддерживаемыми Telegram versions и desktop/web fallback.
- Проверяются portrait, small viewport, safe area, keyboard, dark/light themes и font scaling.
- Все поддерживаемые языки проходят missing-key check и pseudo-localization.
- Автоматизированный accessibility scanner дополняется keyboard/screen-reader ручной проверкой ключевых потоков.
- Длинные имена, услуги, адреса и translated strings не ломают layout.

### 26.10. Payment acceptance tests

- Денежные значения совпадают между UI, order, provider и ledger.
- Redirect success без webhook не активирует оплату.
- Webhook до возвращения пользователя корректно активирует результат.
- Delayed, out-of-order и duplicate events приводят к одному корректному состоянию.
- Partial/full refund и repeated refund ограничены доступной суммой.
- Reconciliation находит специально созданное расхождение.
- Sandbox и production credentials/config нельзя перепутать незаметно.

### 26.11. Backup/restore и disaster recovery tests

- Восстанавливается выбранная точка времени в чистой среде.
- Проверяется вход, memberships, будущие записи, payment ledger, jobs и media links.
- Система документирует потерю данных относительно RPO и время относительно RTO.
- Повторный запуск recovery runbook даёт воспроизводимый результат.

### 26.12. UAT

UAT проводят минимум владелец продукта, представитель компании-владельца, сотрудник, клиент, поддержка и ответственный за финансы. Для каждого сценария фиксируются build, environment, test data, ожидаемый/фактический результат, доказательство и sign-off.

## 27. Критерии приёмки по ключевым контурам

### 27.1. Auth и права

- Ни один защищённый endpoint не работает без валидной серверной identity.
- Роль, tenant и entitlement невозможно повысить изменением browser storage/request body.
- Матрица ролей подтверждена automated authorization tests.
- Выход/удаление membership отзывает доступ в утверждённый срок.

### 27.2. Запись

- Сервер возвращает только фактически доступные слоты.
- В конкурентном тесте ровно один запрос занимает слот.
- Созданная запись видна клиенту и компании после повторной загрузки на другом устройстве.
- Сеть/500/timeout не создают локальную фиктивную запись.
- Перенос/отмена соблюдают policy и корректируют уведомления.

### 27.3. Платежи и тарифы

- Только валидный provider webhook/reconciliation подтверждает оплату.
- Duplicate events и requests не удваивают заказ, entitlement или refund.
- Ledger сходится с provider sandbox в acceptance выборке.
- Тарифные лимиты нельзя обойти параллельными запросами или прямым API.
- Нет production path, который возвращает fake paid/success.

### 27.4. Данные и миграция

- Demo данные отсутствуют в production, если они не были отдельно подтверждены к переносу.
- Migration/reconciliation report не содержит необъяснённых потерь или дублей.
- Между tenants нет доступа к данным во всех проверенных object types.
- Backup успешно восстановлен и проверен до go-live.

### 27.5. Уведомления

- Каждое обязательное сообщение имеет persisted delivery state.
- Retry и restart worker не создают непредусмотренных дублей.
- Отмена/перенос не отправляет устаревшее напоминание.
- Marketing opt-out и quiet/rate policies выполняются.

### 27.6. UX

- Все release-scope screens имеют loading, empty, error и success states.
- Нет смешанных языков, placeholder реквизитов/ссылок и неработающих controls.
- Ключевые flows проходят на целевой device matrix.
- Accessibility review не содержит blocker/critical дефектов.

### 27.7. Эксплуатация

- Alerts, dashboards и runbooks проверены controlled failures.
- On-call знает процедуру payment mismatch, webhook outage, DB recovery и credential rotation.
- Релиз можно откатить без потери подтверждённых бизнес-операций.
- SLO и error budget видны команде после запуска.

## 28. Этапы реализации и рекомендуемая очередность

Сроки определяются после оценки командой. Переход к следующему этапу разрешён только после выполнения exit criteria предыдущего. Параллельная работа допустима, если не создаёт временный публичный контур с ложной безопасностью.

### Этап 0. Product freeze и решения

Работы:

- утвердить первый release scope и отложенные функции;
- выбрать юрисдикцию, валюты, payment provider, hosting region и support model;
- утвердить роли/permissions, тарифы, cancellation/refund policies;
- составить inventory demo и data migration decision;
- назначить owners по продукту, backend, frontend, infrastructure, security, payments, legal и support;
- определить SLO, capacity assumptions и pilot cohort.

Результат: подписанный decision log, scope, risk register и release acceptance profile.

Exit criteria: нет открытых решений, блокирующих схему данных, payment integration, legal texts или архитектуру.

### Этап 1. Production foundation

Работы:

- PostgreSQL schema и migrations;
- typed configuration и secrets;
- Telegram authentication/session layer;
- tenant membership, RBAC/permissions и audit log;
- API conventions, error model, idempotency и rate limiting base;
- Redis/queue, outbox/inbox base;
- CI quality/security gates;
- staging environment, logs, metrics, tracing, `/live` и `/ready`.

Результат: защищённый skeleton, на котором можно реализовывать бизнес-модули без local JSON/localStorage authority.

Exit criteria: cross-tenant/auth tests проходят; deploy/rollback и migration работают на staging.

### Этап 2. Company setup и справочники

Работы:

- company/branch CRUD;
- services/categories/prices/duration;
- employees, invitations и permissions;
- schedules, breaks, exceptions, vacations;
- media uploads;
- onboarding и settings UI на API.

Результат: владелец с нуля настраивает публикуемую компанию, не прибегая к прямой правке данных.

Exit criteria: company UAT проходит; тарифные limits и audit работают транзакционно.

### Этап 3. Booking core

Работы:

- public company page/catalog release subset;
- server slot engine;
- client identity/profile;
- booking create/read/reschedule/cancel;
- owner/manual booking;
- appointment state machine, history и policies;
- notification jobs для подтверждения/изменения/напоминания;
- критический E2E и concurrency tests.

Результат: end-to-end запись является серверной, консистентной и воспроизводимой на другом устройстве.

Exit criteria: zero fake/offline success; double-booking test допускает ровно одну запись; reminder restart test проходит.

### Этап 4. CRM, отзывы, коммуникации и аналитика

Работы:

- tenant-isolated client profiles/history/notes/tags;
- reviews eligibility/moderation;
- broadcast consent/segments/queue/limits;
- operational dashboard и definitions;
- CSV import/export с безопасностью и аудитом;
- funnels/events согласно tracking plan.

Результат: компании получают рабочие инструменты удержания клиентов без утечки данных и неподтверждённых метрик.

Exit criteria: consent/export/security tests проходят, показатели сверены на контрольных наборах.

### Этап 5. Billing и реальные оплаты

Работы:

- plans/entitlements/subscriptions;
- payment provider adapter, sandbox и production configuration isolation;
- orders, transactions, webhooks, ledger, refunds;
- reconciliation и admin cases;
- legal payment texts/receipts/status UI;
- payment dashboards/alerts/runbooks.

Результат: подтверждённая оплата атомарно меняет entitlement, а финансы можно сверить с provider.

Exit criteria: payment acceptance suite, security review и reconciliation проходят; fake payment paths удалены.

### Этап 6. Hardening и pilot

Работы:

- performance/spike/soak/resilience tests;
- accessibility/device/localization pass;
- penetration/security review;
- backup restore и incident drills;
- demo removal audit;
- pilot на ограниченном числе компаний;
- устранение blocker/critical/high issues;
- support training и documentation.

Результат: pilot report, актуальный risk register, verified go-live checklist.

Exit criteria: нет P0/P1, приняты остаточные риски, owners подписали launch readiness.

### Этап 7. General availability

Работы:

- финальный cutover/migration;
- canary/controlled rollout;
- усиленный мониторинг и on-call;
- ежедневная reconciliation;
- сбор funnel/support feedback;
- быстрый rollback/feature disable при нарушении stop conditions.

Результат: официальный продукт доступен утверждённой аудитории с реальными пользователями и оплатами.

Exit criteria: stabilization window завершён без неразобранных критических инцидентов.

### Этап 8. После стабилизации

После подтверждения надёжности можно последовательно включать отложенные функции: расширенный AI, marketplace ranking, waitlist, loyalty/абонементы, multi-currency, дополнительные payment providers, расширенную аналитику и автоматические маркетинговые кампании. Каждая функция проходит тот же security/privacy/observability/acceptance цикл.

## 29. Оценка и структура backlog

ТЗ должно быть разложено в системе управления задачами по иерархии:

- Initiative: переход к official production;
- Epic: один крупный домен/этап;
- Story: законченная пользовательская или эксплуатационная ценность;
- Task: техническая работа;
- Bug: отклонение от согласованного поведения;
- Spike: ограниченное исследование с конкретным вопросом и результатом.

Каждая story содержит:

- ссылку на requirement ID этого ТЗ;
- user/business outcome;
- in scope / out of scope;
- acceptance criteria в проверяемой форме;
- макет/contract/data changes;
- security/privacy/analytics/observability impact;
- migration/backward compatibility;
- test plan;
- dependencies, risks и owner;
- оценку и release target.

Запрещено закрывать большие пункты формулировкой «сделать backend» или «доделать интерфейс» без измеримого результата.

## 30. Обязательные артефакты проекта

К production release команда передаёт и поддерживает:

1. утверждённое ТЗ и release scope;
2. архитектурную схему и ADR для ключевых решений;
3. ER diagram/data dictionary и миграции;
4. OpenAPI/contract документацию;
5. role-permission matrix;
6. appointment/payment/subscription state machines;
7. provider integration specifications;
8. threat model, security review и risk acceptance;
9. privacy data map, retention matrix и legal texts;
10. test strategy, traceability matrix, reports и UAT sign-offs;
11. infrastructure/deployment/rollback/backup configuration;
12. dashboards, alerts, SLO и runbooks;
13. migration plan, dry-run и reconciliation reports;
14. support playbook, incident process и escalation contacts;
15. release notes, known limitations и post-launch plan.

Документы хранятся с версиями рядом с кодом либо в утверждённой базе знаний и имеют владельца актуальности.

## 31. Go-live checklist

### 31.1. Product и контент

- [ ] Release scope и доступные функции явно утверждены.
- [ ] Нет неработающих кнопок, пустых routes и функций, выдающих заглушку за результат.
- [ ] Все компании/услуги/тарифы/цены/валюты/контакты/ссылки production-актуальны.
- [ ] Onboarding, empty/error/offline states проверены.
- [ ] Поддерживаемые языки полностью вычитаны.
- [ ] Support channel реально обслуживается.

### 31.2. Данные и backend

- [ ] PostgreSQL — источник истины; local JSON write path отключён.
- [ ] Demo/seed data и test accounts отсутствуют либо строго изолированы.
- [ ] Migrations проверены на production-like copy.
- [ ] Constraints, indexes, pagination и retention jobs включены.
- [ ] Idempotency/concurrency tests пройдены.
- [ ] Final migration dry-run и reconciliation подписаны.

### 31.3. Auth и безопасность

- [ ] Telegram `initData` проверяется server-side с freshness policy.
- [ ] Все endpoints классифицированы public/authenticated/permissioned.
- [ ] Tenant isolation и role matrix покрыты тестами.
- [ ] Production secrets отсутствуют в Git, bundle, logs и artifacts.
- [ ] CORS/CSP/TLS/rate limits/security headers настроены.
- [ ] Dependency/SAST/DAST/image scans пройдены.
- [ ] Penetration/security review не содержит непринятых blocker/critical/high проблем.
- [ ] Credential rotation и incident response отрепетированы.

### 31.4. Запись и уведомления

- [ ] Server slot engine учитывает расписание, timezone, buffer, exceptions и conflicts.
- [ ] Double-booking невозможен на уровне транзакции/constraint.
- [ ] Appointment state machine и policies утверждены.
- [ ] Network failure не показывает ложный success.
- [ ] Retry/DLQ/idempotency/reminder cancellation проверены.
- [ ] Шаблоны сообщений и deep links ведут в правильный tenant/context.

### 31.5. Платежи

- [ ] Provider contract и юридические условия утверждены.
- [ ] Sandbox suite полностью пройдена.
- [ ] Production и sandbox config технически разделены.
- [ ] Webhook signature/replay/idempotency работают.
- [ ] Redirect не активирует оплату без server confirmation.
- [ ] Ledger, refund и reconciliation проверены финансовым ответственным.
- [ ] Alerts и runbook payment mismatch проверены.
- [ ] Fake paid/success ветки удалены.

### 31.6. Frontend и устройства

- [ ] LocalStorage не управляет identity, role, company, plan и business records.
- [ ] Dev dock/role switch/debug/test routes выключены в production build.
- [ ] Целевые Telegram iOS/Android/Desktop/Web сценарии пройдены.
- [ ] Dark/light, safe area, keyboard, back navigation проверены.
- [ ] Accessibility blocking issues отсутствуют.
- [ ] Bundle/performance budgets соблюдены.

### 31.7. Инфраструктура и эксплуатация

- [ ] Production/staging изолированы.
- [ ] Deploy, migration, canary и rollback проверены.
- [ ] `/live`, `/ready`, worker heartbeat и dependency dashboards работают.
- [ ] Critical alerts доходят on-call и имеют runbook.
- [ ] Backup/PITR выполняется; restore drill успешен в рамках RPO/RTO.
- [ ] Capacity/load/soak tests соответствуют release profile.
- [ ] Status/incident/support процессы готовы.

### 31.8. Legal и privacy

- [ ] Юрист утвердил документы для фактической юрисдикции.
- [ ] Consent/version history и opt-out реализованы.
- [ ] Privacy data map/retention/delete/export процессы проверены.
- [ ] Analytics/logging не собирают лишние персональные/платёжные данные.
- [ ] Договоры/условия с providers и processors оформлены.

### 31.9. Release decision

- [ ] Все P0/P1 закрыты.
- [ ] Оставшиеся риски имеют owner, mitigation и письменное acceptance.
- [ ] Product, engineering, security, operations, finance/payments, support и legal дали sign-off.
- [ ] Назначены release commander, on-call и rollback authority.
- [ ] Определены stop conditions и окно усиленного наблюдения.

## 32. Stop conditions и rollback

Новые регистрации/платежи/booking rollout приостанавливаются, если обнаружено хотя бы одно из условий:

- подтверждённый cross-tenant access или privilege escalation;
- утечка секрета, платёжных или существенных персональных данных;
- двойные списания, неверная активация entitlement или необъяснимое расхождение ledger;
- массовые двойные записи или потеря подтверждённых записей;
- невозможность восстановить authoritative state после ошибки;
- критическая недоступность сверх error budget без ясного времени восстановления;
- неконтролируемая отправка сообщений/рассылок;
- миграция создаёт необъяснимые потери или дубли.

Rollback plan должен определить:

- кто принимает решение;
- как остановить новый трафик и фоновые side effects;
- какие feature flags/версии откатываются;
- совместимость текущей схемы БД с предыдущей версией;
- как обрабатываются операции, уже принятые provider;
- как выполняются reconciliation и уведомление пользователей;
- как сохраняются доказательства для расследования.

При платёжной или data-integrity проблеме простой откат приложения без сверки внешних событий не считается завершённым восстановлением.

## 33. После запуска

### 33.1. Stabilization window

В первые дни/недели, определённые release plan:

- действует усиленный on-call;
- ежедневно проверяются booking conflicts, failed notifications, payment reconciliation, auth/security anomalies и support themes;
- новые рискованные функции заморожены;
- инциденты и customer-impact bugs имеют ускоренный triage;
- результат каждого дня фиксируется launch dashboard/report.

### 33.2. Product feedback

- Support обращения связываются с экраном, build и tenant при сохранении privacy.
- Funnel анализируется на разрывы, но не заменяет качественные интервью.
- Feedback классифицируется: bug, usability, missing functionality, billing, performance, policy.
- Изменения, затрагивающие деньги, права и данные, проходят полноценный change review даже после запуска.

### 33.3. Регулярные процессы

- еженедельный review SLO, errors, queues и provider health;
- ежедневная/регулярная payment reconciliation по установленному режиму;
- ежемесячный dependency/security update cycle;
- регулярный access review;
- регулярный restore/incident drill;
- квартальный review retention, permissions, feature flags и technical debt;
- review SLO/capacity перед крупной кампанией или подключением большого клиента.

## 34. Риски и меры снижения

| Риск | Последствие | Обязательная мера |
|---|---|---|
| Попытка «допатчить» localStorage/JSON | потеря данных, гонки, невозможность нескольких replicas | убрать их из production source-of-truth, мигрировать в PostgreSQL |
| Доверие frontend роли/tenant | доступ к чужим данным и админ-функциям | server auth, RBAC, tenant isolation tests |
| Клиентский slot calculation | двойные записи | server slot engine, transaction/constraint, conflict response |
| Fake/offline success | клиент уверен в несуществующей записи/оплате | authoritative server confirmation, retry/pending UX |
| Подтверждение оплаты redirect-страницей | бесплатная активация или неверный статус | signed webhook, ledger, idempotency, reconciliation |
| Ненадёжный worker/reminder | пропущенные или дублированные сообщения | persisted jobs, retry, DLQ, idempotency, monitoring |
| Массовая рассылка без consent/limits | жалобы, блокировка bot, юридический риск | consent model, rate limit, suppression, audit |
| Неполная локализация | ошибки доверия и непрофессиональный UX | key scan, pseudo-localization, editorial review |
| Отсутствие restore drill | backup существует, но не восстанавливается | регулярное практическое восстановление с RPO/RTO |
| Большой одномоментный rewrite | срыв сроков и новые регрессии | этапы, vertical slices, feature flags, pilot |
| Неопределённые тарифы/юрисдикция/provider | переделка схемы и юридические блокеры | закрыть decision log на этапе 0 |
| Недооценка support/ops | долгие инциденты и потеря клиентов | on-call, runbooks, dashboards, support playbook |
| AI получает лишние данные или ключ на клиенте | утечка данных/ключа и неконтролируемые расходы | server proxy, redaction, budgets, audit |
| Отсутствие тестов поведения | регрессии при каждом релизе | test pyramid, contract/E2E, blocking CI gates |

## 35. Открытые продуктовые решения

Эти пункты нельзя окончательно определить только по коду. Они должны быть закрыты владельцем продукта и профильными ответственными до соответствующего этапа:

1. страны запуска, юридическое лицо, применимое право и место хранения данных;
2. первая валюта и необходимость multi-currency;
3. provider оплаты, чеки/налоги, автопродление, возвраты и chargebacks;
4. является ли платной подписка компании, клиентская запись или обе модели;
5. точные тарифы, trial, grace period, limits и downgrade behavior;
6. cancellation/no-show/deposit policies и кто их настраивает;
7. обязательные и маркетинговые Telegram уведомления;
8. языки первого запуска и приоритетные устройства;
9. входит ли общий marketplace/catalog в первый релиз или только branded company links;
10. нужна ли модерация компаний до публикации;
11. правила рейтинга, отзывов и права на ответ;
12. support hours, SLA и каналы;
13. capacity forecast и география инфраструктуры;
14. RPO/RTO и SLO, принимаемые бизнесом;
15. мигрируются ли какие-либо текущие данные как реальные;
16. какие AI-функции разрешены в первом релизе и какие данные им доступны;
17. срок хранения CRM, audit, finance, logs и backups;
18. необходимость отдельного web admin вне Telegram.

Решения фиксируются ADR/decision log с датой, owner, вариантами, основанием и влиянием на ТЗ. Пока решение не принято, команда не должна скрыто выбирать вариант с необратимыми последствиями.

## 36. Definition of Ready

Story готова к разработке, если:

- понятен пользователь и измеримый результат;
- указаны requirement ID и acceptance criteria;
- нет блокирующих product/legal/provider решений;
- доступны макеты/контракт/схема данных либо явно указано, что они не нужны;
- описаны permission, tenant, privacy и failure cases;
- определены analytics/logging/alert needs;
- понятна миграция и backward compatibility;
- есть test approach и зависимости;
- команда может оценить работу без критических предположений.

## 37. Definition of Done

Функция считается завершённой только если одновременно:

- код прошёл review и обязательные CI gates;
- acceptance criteria подтверждены тестами;
- server-side auth/permission/tenant checks реализованы;
- success, loading, empty, validation, permission, network и server error states реализованы;
- telemetry не содержит секретов/лишних персональных данных;
- logs/metrics/traces и нужные alerts добавлены;
- migrations обратимо/совместимо развертываются и протестированы;
- localization и accessibility применены;
- документация/API/runbook/support material обновлены;
- feature flag и rollback path определены;
- нет новых blocker/critical/high vulnerabilities;
- staging acceptance пройдена на production-like конфигурации;
- demo/mock fallback недоступен в production;
- product/technical owner принял результат.

«Работает у разработчика», успешная сборка или визуально готовый экран по отдельности не являются Done.

## 38. Матрица состояний

### 38.1. Appointment

Минимальный набор состояний: `pending` (если нужен), `confirmed`, `completed`, `cancelled_by_client`, `cancelled_by_company`, `no_show`, `rejected`, `expired`. Фактический enum утверждается продуктом.

| Из | В | Кто | Основные условия |
|---|---|---|---|
| pending | confirmed | system/company | слот всё ещё занят этой записью; при необходимости выполнена оплата/подтверждение |
| pending | rejected/expired | company/system | фиксируется причина; освобождается слот; отменяются jobs |
| confirmed | completed | employee/manager | наступило допустимое время; permission и audit |
| confirmed | no_show | employee/manager | наступило допустимое время; фиксируется actor |
| confirmed | cancelled_by_client | client | соблюдена cancellation policy |
| confirmed | cancelled_by_company | employee/manager | permission, причина, уведомление клиенту |
| confirmed | confirmed | client/company | перенос оформляется специальной транзакционной командой с новой версией и слотом |

Недопустимый переход возвращает conflict/domain error и не меняет side effects. История переходов append-only.

### 38.2. Payment order

Минимальный набор: `created`, `pending`, `paid`, `failed`, `cancelled`, `partially_refunded`, `refunded`, `expired`, `manual_review`.

- `paid` устанавливается только server-side по доверенному событию/reconciliation.
- terminal state не откатывается событием с меньшей достоверностью.
- out-of-order events сравниваются по provider semantics и recorded event history.
- сумма всех успешных refunds не превышает paid amount.

### 38.3. Subscription

Минимальный набор: `trial`, `active`, `past_due`, `grace`, `suspended`, `cancelled`, `expired`.

- Entitlement вычисляется сервером из status, period и product/plan rules.
- Payment order status и subscription status — разные сущности.
- Cancel at period end и immediate suspension имеют разные команды и UX.

### 38.4. Invitation

Минимальный набор: `created`, `accepted`, `expired`, `revoked`.

- `created → accepted` выполняется один раз транзакционно.
- Expired/revoked token не раскрывает tenant details сверх необходимого.
- Повторная отправка не создаёт бесконечно действующих параллельных токенов без явной политики.

## 39. Базовая role-permission matrix

Точные роли и названия могут быть изменены, но backend-проверки должны оставаться granular.

| Действие | Client | Employee | Manager | Owner | Support | Platform admin |
|---|---:|---:|---:|---:|---:|---:|
| Смотреть публичную карточку | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Создавать/менять свою запись | ✓ | по client context | по client context | по client context | только support procedure | только admin procedure |
| Смотреть своё расписание | — | ✓ | ✓ | ✓ | support scope | admin scope |
| Смотреть расписание команды | — | по permission | ✓ | ✓ | support scope | admin scope |
| Завершать запись | — | назначенную | ✓ | ✓ | — | emergency only |
| Управлять услугами/расписанием | — | по permission | ✓ | ✓ | — | emergency only |
| Смотреть CRM | только свои данные | по permission | ✓ | ✓ | временный scope | audit scope |
| Экспортировать CRM | — | обычно нет | по permission | ✓ | обычно нет | отдельно разрешено |
| Управлять сотрудниками/правами | — | — | ограниченно | ✓ | — | emergency only |
| Управлять billing | — | — | обычно нет | ✓ | support metadata | finance/admin role |
| Делать рассылку | — | по permission | ✓ | ✓ | — | platform-only messages |
| Модерировать платформу | — | — | — | — | по permission | ✓ |

Support/platform access всегда ограничен purpose, audit и сроком. Таблица не заменяет object-level и tenant checks.

## 40. Трассировка критических проблем текущей версии

| Текущее ограничение | Требуемое изменение | Где определено |
|---|---|---|
| LocalStorage — источник пользователей, ролей и бизнес-данных | typed API, server identity, PostgreSQL | §§ 6, 10–12, 23–25 |
| Public API/CRUD без надёжной auth | Telegram validation, session, RBAC, tenant isolation | §§ 6, 12, 17, 24 |
| Новый клиент может попасть в seed/чужой профиль | отсутствие production seed fallback, identity-bound queries | §§ 5, 6, 23, 25 |
| Запись может «успешно» создаться offline | authoritative server result, idempotent retry, pending/error UX | §§ 8, 13, 19, 23, 27 |
| Нет серверной защиты от двойного слота | slot engine, transaction, unique/exclusion strategy | §§ 13, 26, 27 |
| Оплата и тарифы демонстрационные | orders/webhooks/ledger/entitlements/reconciliation | §§ 14, 26–28, 31 |
| JSON store имеет race/corruption/caps | PostgreSQL, transactions, migrations, indexes | §§ 11, 19, 24–25 |
| Несколько процессов/containers не разделяют state | stateless services, shared durable DB/queue | §§ 10, 19, 22 |
| Напоминания теряются или дублируются | persisted jobs, retry, DLQ, timezone, idempotency | §§ 15, 20, 26–27 |
| Invite можно повторить/перехватить | hashed high-entropy token, expiry, transaction, audit | §§ 8, 17, 26 |
| Тарифные лимиты существуют только визуально | central server entitlement service | §§ 14, 24, 27 |
| AI key/логика могут оказаться на клиенте | backend proxy, secrets, budgets, redaction | §§ 8, 17, 34 |
| Смешанная локализация и проблемы доступности | единая i18n, pseudo-localization, WCAG checks | §§ 8, 19, 23, 26 |
| Существующие проверки не тестируют поведение | unit/integration/contract/E2E/security/load suite | §§ 22, 26 |
| Нет production observability/backup/legal readiness | SLO, logs/metrics/alerts, restore, legal/privacy | §§ 18–21, 31 |

## 41. Классификация дефектов и release policy

| Severity | Определение | Примеры | Допуск к запуску |
|---|---|---|---|
| P0 Blocker | запуск/основной поток невозможен либо существует немедленная критическая угроза | утечка данных/секрета, неверные списания, массовая потеря записей, production не запускается | запрещён |
| P1 Critical | критический поток существенно нарушен, безопасного workaround нет | обход прав, двойная запись, оплата не активируется, backup не восстанавливается | запрещён |
| P2 High | заметный пользовательский/операционный ущерб, workaround ограничен | часть уведомлений не доставляется, важный экран сломан на поддерживаемом устройстве | только с письменным risk acceptance, owner и близким сроком; для затронутого критического потока launch запрещён |
| P3 Medium | функция работает, но есть ограничение/неудобство | некритичная validation/локализация/UX-проблема | допустим при известном workaround и сроке |
| P4 Low | косметическое или малозначительное отклонение | spacing, редкий текстовый дефект | допустим в backlog |

- Severity определяется пользовательским и бизнес-ущербом, а не сложностью исправления.
- Security/privacy/payment defect может быть повышен ответственным за соответствующий контур.
- При споре действует более высокий severity до завершения triage.
- Для каждого P0–P2 фиксируются affected versions/tenants, owner, mitigation, test и дата исправления.
- Закрытие требует проверки исправления и релевантной регрессии.

## 42. Команда и ответственность

Минимальные функции должны быть явно закреплены; один человек может совмещать несколько ролей, но ответственность не должна оставаться ничьей.

| Функция | Зона ответственности |
|---|---|
| Product owner | scope, policies, приоритеты, UAT, go/no-go |
| Tech lead/architect | архитектура, ADR, cross-domain consistency, technical risks |
| Backend | API, data model, auth/RBAC, booking, payments, workers |
| Frontend/Mini App | flows, API integration, Telegram UX, performance, accessibility |
| Bot engineer | handlers/FSM, webhook, message templates, deep links |
| QA | strategy, automation, device/UAT evidence, release report |
| DevOps/SRE | environments, CI/CD, monitoring, backup, capacity, incident response |
| Security owner | threat model, review, vulnerability/incident process |
| Finance/payment owner | provider contract, ledger/reconciliation/refund acceptance |
| Legal/privacy owner | документы, consent, retention, data subject processes |
| Support owner | knowledge base, escalation, customer communication |
| Release commander | checklist, coordination, stop/rollback decision execution |

Для каждого production service, alert, scheduled job, provider integration и критического документа назначается owner и резервный контакт. Уход или недоступность одного специалиста не должны делать невозможными deploy, rollback, credential rotation, reconciliation и recovery.

## 43. Итоговое правило допуска

Официальный запуск с реальными пользователями, клиентскими данными и оплатами запрещён, пока не выполнены все MUST-требования, checklist §31, acceptance criteria §27 и sign-off ответственных. Исключение возможно только для явно ограниченного pilot без реальных списаний либо с отдельно одобренным платёжным контуром, при документированном риске, ограничении аудитории, наблюдаемости и немедленном rollback.

Ключевой принцип релиза: система должна не просто показывать готовые экраны, а доказуемо сохранять правильные данные, соблюдать права и денежные состояния, безопасно переживать повторы и сбои, восстанавливаться и давать команде возможность быстро увидеть и устранить проблему.
