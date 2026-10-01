"""
Реэкспорт моделей. Alembic и `create_all` видят таблицу только если модуль
импортирован — поэтому импорт здесь обязателен, а не «для удобства».
"""
from app.db.base import Base
from app.db.models.billing import (
    EntitlementUsage, FinanceTransaction, PaymentOrder, PaymentTransaction, Plan,
    PlanEntitlement, ProviderEvent, Refund, Subscription,
)
from app.db.models.booking import (
    Appointment, AppointmentEvent, AppointmentService, Client, ClientNote, ClientTag,
    ClientTagLink, Review,
)
from app.db.models.catalog import (
    Employee, EmployeeBranch, EmployeeService, Service, ServiceCategory,
)
from app.db.models.identity import Session, User, UserConsent
from app.db.models.ops import (
    AuditEvent, Broadcast, BroadcastRecipient, IdempotencyRecord, InboxEvent, MediaAsset,
    NotificationJob, OutboxEvent, SuppressionEntry, SupportTicket, TicketMessage,
)
from app.db.models.schedule import ScheduleBreak, ScheduleException, WeeklyScheduleRule
from app.db.models.tenancy import Branch, Company, Membership, TeamInvite

__all__ = [
    'Base',
    'Appointment', 'AppointmentEvent', 'AppointmentService', 'AuditEvent',
    'Branch', 'Broadcast', 'BroadcastRecipient',
    'Client', 'ClientNote', 'ClientTag', 'ClientTagLink', 'Company',
    'Employee', 'EmployeeBranch', 'EmployeeService', 'EntitlementUsage',
    'FinanceTransaction', 'IdempotencyRecord', 'InboxEvent',
    'MediaAsset', 'Membership', 'NotificationJob', 'OutboxEvent',
    'PaymentOrder', 'PaymentTransaction', 'Plan', 'PlanEntitlement', 'ProviderEvent',
    'Refund', 'Review',
    'ScheduleBreak', 'ScheduleException', 'Service', 'ServiceCategory', 'Session',
    'Subscription', 'SuppressionEntry', 'SupportTicket',
    'TeamInvite', 'TicketMessage', 'User', 'UserConsent', 'WeeklyScheduleRule',
]
