"""
Словарь предметной области: статусы, роли и разрешения.

Все значения — строки со стабильным кодом. В БД хранится код, а не порядковый
номер: перечисление ещё будет пополняться, а данные переживут релизы.
ТЗ 38 (матрица состояний) и ТЗ 39 (role-permission matrix).
"""
from __future__ import annotations

from enum import StrEnum


# ------------------------------------------------------------------ identity

class UserStatus(StrEnum):
    ACTIVE = 'active'
    BLOCKED = 'blocked'
    DELETED = 'deleted'


class PlatformRole(StrEnum):
    """Платформенная роль хранится серверно и не пересекается с ролью в компании (ADM-001)."""
    NONE = 'none'
    SUPPORT_AGENT = 'support_agent'
    PLATFORM_ADMIN = 'platform_admin'
    SUPER_ADMIN = 'super_admin'


# ------------------------------------------------------------------ tenancy

class CompanyStatus(StrEnum):
    DRAFT = 'draft'
    PUBLISHED = 'published'
    SUSPENDED = 'suspended'
    DELETED = 'deleted'


class BranchStatus(StrEnum):
    ACTIVE = 'active'
    ARCHIVED = 'archived'


class CompanyRole(StrEnum):
    OWNER = 'owner'
    MANAGER = 'manager'
    MASTER = 'master'


class MembershipStatus(StrEnum):
    INVITED = 'invited'
    ACTIVE = 'active'
    SUSPENDED = 'suspended'
    TERMINATED = 'terminated'


class InviteStatus(StrEnum):
    PENDING = 'pending'
    ACCEPTED = 'accepted'
    REVOKED = 'revoked'
    EXPIRED = 'expired'


# ------------------------------------------------------------------ booking

class AppointmentStatus(StrEnum):
    PENDING_PAYMENT = 'pending_payment'
    CONFIRMED = 'confirmed'
    CHECKED_IN = 'checked_in'
    COMPLETED = 'completed'
    CANCELLED_BY_CLIENT = 'cancelled_by_client'
    CANCELLED_BY_COMPANY = 'cancelled_by_company'
    NO_SHOW = 'no_show'
    EXPIRED = 'expired'
    PAYMENT_FAILED = 'payment_failed'


#: Статусы, которые занимают время в календаре. Только они участвуют
#: в проверке пересечений (APT-009: отменённая запись слот не держит).
BLOCKING_APPOINTMENT_STATUSES: frozenset[str] = frozenset({
    AppointmentStatus.PENDING_PAYMENT,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.COMPLETED,
})

#: Переходы состояний записи. Всё, чего здесь нет, backend отклоняет (ТЗ 38.1).
APPOINTMENT_TRANSITIONS: dict[str, frozenset[str]] = {
    AppointmentStatus.PENDING_PAYMENT: frozenset({
        AppointmentStatus.CONFIRMED,
        AppointmentStatus.PAYMENT_FAILED,
        AppointmentStatus.EXPIRED,
        AppointmentStatus.CANCELLED_BY_CLIENT,
        AppointmentStatus.CANCELLED_BY_COMPANY,
    }),
    AppointmentStatus.CONFIRMED: frozenset({
        AppointmentStatus.CHECKED_IN,
        AppointmentStatus.COMPLETED,
        AppointmentStatus.NO_SHOW,
        AppointmentStatus.CANCELLED_BY_CLIENT,
        AppointmentStatus.CANCELLED_BY_COMPANY,
    }),
    AppointmentStatus.CHECKED_IN: frozenset({
        AppointmentStatus.COMPLETED,
        AppointmentStatus.NO_SHOW,
        AppointmentStatus.CANCELLED_BY_COMPANY,
    }),
    AppointmentStatus.COMPLETED: frozenset(),
    AppointmentStatus.CANCELLED_BY_CLIENT: frozenset(),
    AppointmentStatus.CANCELLED_BY_COMPANY: frozenset(),
    AppointmentStatus.NO_SHOW: frozenset(),
    AppointmentStatus.EXPIRED: frozenset(),
    AppointmentStatus.PAYMENT_FAILED: frozenset({AppointmentStatus.EXPIRED}),
}


class AppointmentSource(StrEnum):
    CLIENT_APP = 'client_app'
    CLIENT_BOT = 'client_bot'
    STAFF = 'staff'
    IMPORT = 'import'


class AppointmentPaymentStatus(StrEnum):
    NOT_REQUIRED = 'not_required'
    AWAITING = 'awaiting'
    PAID = 'paid'
    REFUNDED = 'refunded'
    FAILED = 'failed'


class ClientStatus(StrEnum):
    ACTIVE = 'active'
    ARCHIVED = 'archived'
    ANONYMIZED = 'anonymized'


class ConsentStatus(StrEnum):
    """MSG-001: рассылка уходит только при действующем согласии."""
    UNKNOWN = 'unknown'
    GRANTED = 'granted'
    DENIED = 'denied'
    REVOKED = 'revoked'


class ReviewStatus(StrEnum):
    PUBLISHED = 'published'
    HIDDEN = 'hidden'
    PENDING_MODERATION = 'pending_moderation'


class ScheduleExceptionType(StrEnum):
    BLOCKED = 'blocked'
    BREAK = 'break'
    VACATION = 'vacation'
    SICK = 'sick'
    CUSTOM_OPEN = 'custom_open'


# ------------------------------------------------------------------ billing

class SubscriptionStatus(StrEnum):
    TRIALING = 'trialing'
    ACTIVE = 'active'
    PAST_DUE = 'past_due'
    GRACE = 'grace'
    SUSPENDED = 'suspended'
    CANCELLED = 'cancelled'


#: Подписки, при которых компания может создавать записи и менять данные.
ENTITLED_SUBSCRIPTION_STATUSES: frozenset[str] = frozenset({
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.GRACE,
})


class PaymentOrderType(StrEnum):
    PLATFORM_SUBSCRIPTION = 'platform_subscription'
    CLIENT_SERVICE = 'client_service'
    DEPOSIT = 'deposit'


class PaymentOrderStatus(StrEnum):
    CREATED = 'created'
    PENDING = 'pending'
    PAID = 'paid'
    FAILED = 'failed'
    EXPIRED = 'expired'
    REFUNDED = 'refunded'
    PARTIALLY_REFUNDED = 'partially_refunded'


class PaymentTransactionStatus(StrEnum):
    PENDING = 'pending'
    SUCCEEDED = 'succeeded'
    FAILED = 'failed'


class RefundStatus(StrEnum):
    REQUESTED = 'requested'
    PROCESSING = 'processing'
    SUCCEEDED = 'succeeded'
    FAILED = 'failed'


# ------------------------------------------------------------------ операции

class NotificationStatus(StrEnum):
    PENDING = 'pending'
    PROCESSING = 'processing'
    SENT = 'sent'
    RETRY = 'retry'
    FAILED = 'failed'
    CANCELLED = 'cancelled'


class NotificationChannel(StrEnum):
    TELEGRAM = 'telegram'


class BroadcastStatus(StrEnum):
    DRAFT = 'draft'
    SCHEDULED = 'scheduled'
    SENDING = 'sending'
    SENT = 'sent'
    CANCELLED = 'cancelled'
    FAILED = 'failed'


class TicketStatus(StrEnum):
    OPEN = 'open'
    PENDING = 'pending'
    RESOLVED = 'resolved'
    CLOSED = 'closed'


class OutboxStatus(StrEnum):
    PENDING = 'pending'
    PROCESSING = 'processing'
    DONE = 'done'
    FAILED = 'failed'


class MediaStatus(StrEnum):
    UPLOADING = 'uploading'
    READY = 'ready'
    FAILED = 'failed'
    DELETED = 'deleted'


class FinanceDirection(StrEnum):
    INCOME = 'income'
    EXPENSE = 'expense'


# ------------------------------------------------------------------ права

class Permission(StrEnum):
    """ТЗ 6.3. Backend проверяет право независимо от того, скрыта ли кнопка в UI."""
    CALENDAR_OWN_READ = 'calendar.own.read'
    CALENDAR_ALL_READ = 'calendar.all.read'
    CALENDAR_WRITE = 'calendar.write'

    APPOINTMENTS_CREATE = 'appointments.create'
    APPOINTMENTS_UPDATE = 'appointments.update'
    APPOINTMENTS_CANCEL = 'appointments.cancel'
    APPOINTMENTS_COMPLETE = 'appointments.complete'

    CLIENTS_READ_BASIC = 'clients.read.basic'
    CLIENTS_READ_FULL = 'clients.read.full'
    CLIENTS_WRITE = 'clients.write'
    CLIENTS_EXPORT = 'clients.export'

    SERVICES_READ = 'services.read'
    SERVICES_WRITE = 'services.write'

    TEAM_READ = 'team.read'
    TEAM_INVITE = 'team.invite'
    TEAM_MANAGE_ROLES = 'team.manage_roles'
    TEAM_TERMINATE = 'team.terminate'

    SCHEDULE_OWN_WRITE = 'schedule.own.write'
    SCHEDULE_ALL_WRITE = 'schedule.all.write'

    FINANCE_READ = 'finance.read'
    FINANCE_WRITE = 'finance.write'

    ANALYTICS_READ = 'analytics.read'

    BROADCASTS_READ = 'broadcasts.read'
    BROADCASTS_SEND = 'broadcasts.send'

    BILLING_READ = 'billing.read'
    BILLING_MANAGE = 'billing.manage'

    COMPANY_SETTINGS_READ = 'company.settings.read'
    COMPANY_SETTINGS_WRITE = 'company.settings.write'

    AI_USE = 'ai.use'
    AUDIT_READ = 'audit.read'


ALL_PERMISSIONS: frozenset[str] = frozenset(p.value for p in Permission)

#: Базовые наборы прав по ролям (ТЗ 39). Владелец получает всё, менеджер —
#: операционку, мастер — только свой календарь и минимум по клиентам.
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    CompanyRole.OWNER: ALL_PERMISSIONS,
    CompanyRole.MANAGER: frozenset({
        Permission.CALENDAR_OWN_READ, Permission.CALENDAR_ALL_READ, Permission.CALENDAR_WRITE,
        Permission.APPOINTMENTS_CREATE, Permission.APPOINTMENTS_UPDATE,
        Permission.APPOINTMENTS_CANCEL, Permission.APPOINTMENTS_COMPLETE,
        Permission.CLIENTS_READ_BASIC, Permission.CLIENTS_READ_FULL, Permission.CLIENTS_WRITE,
        Permission.SERVICES_READ, Permission.SERVICES_WRITE,
        Permission.TEAM_READ, Permission.TEAM_INVITE,
        Permission.SCHEDULE_OWN_WRITE, Permission.SCHEDULE_ALL_WRITE,
        Permission.FINANCE_READ, Permission.ANALYTICS_READ,
        Permission.BROADCASTS_READ, Permission.BROADCASTS_SEND,
        Permission.COMPANY_SETTINGS_READ,
        Permission.AI_USE,
    }),
    CompanyRole.MASTER: frozenset({
        Permission.CALENDAR_OWN_READ,
        Permission.APPOINTMENTS_UPDATE, Permission.APPOINTMENTS_COMPLETE,
        Permission.CLIENTS_READ_BASIC,
        Permission.SERVICES_READ,
        Permission.TEAM_READ,
        Permission.SCHEDULE_OWN_WRITE,
        Permission.COMPANY_SETTINGS_READ,
    }),
}


def permissions_for(role: str, overrides: list[str] | None = None) -> frozenset[str]:
    """
    Итоговый набор прав membership. Overrides — точечные добавки поверх роли:
    например мастеру, которому доверили общий календарь. Владельца не
    урезаем: у него по определению полный доступ к своей компании.
    """
    base = ROLE_PERMISSIONS.get(role, frozenset())
    if role == CompanyRole.OWNER or not overrides:
        return base
    extra = {p for p in overrides if p in ALL_PERMISSIONS}
    return frozenset(base | extra)
