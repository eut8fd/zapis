"""
Единый entitlement service (ТЗ 24.4).

Все лимиты тарифа проверяются здесь и только здесь. Проверка идёт внутри
транзакции изменения — иначе два параллельных создания сотрудника оба
увидят «лимит не достигнут» и оба пройдут.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntitlementExceeded, SubscriptionInactive
from app.db.models import (
    Broadcast, Company, Employee, EntitlementUsage, Plan, PlanEntitlement, Service,
    Subscription,
)
from app.db.types import new_uuid, utcnow
from app.domain import ENTITLED_SUBSCRIPTION_STATUSES


class Key:
    MAX_BRANCHES = 'max_branches'
    MAX_EMPLOYEES = 'max_employees'
    MAX_SERVICES = 'max_services'
    BROADCASTS_PER_MONTH = 'broadcasts_per_month'
    AI_REQUESTS_PER_MONTH = 'ai_requests_per_month'
    FEATURE_ANALYTICS = 'feature_analytics'
    FEATURE_AI = 'feature_ai'
    FEATURE_ONLINE_PAYMENTS = 'feature_online_payments'


#: Тарифы по умолчанию. Реальные цены и состав утверждаются на Этапе 0 ТЗ;
#: код обязан работать с любым набором из БД, а не с этим списком.
DEFAULT_PLANS: tuple[dict, ...] = (
    {
        'code': 'trial', 'name': 'Пробный', 'price_minor': 0, 'billing_period': 'month',
        'trial_days': 14, 'sort_order': 0,
        'entitlements': {
            Key.MAX_BRANCHES: 1, Key.MAX_EMPLOYEES: 3, Key.MAX_SERVICES: 15,
            Key.BROADCASTS_PER_MONTH: 2, Key.AI_REQUESTS_PER_MONTH: 50,
            Key.FEATURE_ANALYTICS: True, Key.FEATURE_AI: True,
            Key.FEATURE_ONLINE_PAYMENTS: False,
        },
    },
    {
        'code': 'start', 'name': 'Старт', 'price_minor': 990000, 'billing_period': 'month',
        'trial_days': 0, 'sort_order': 1,
        'entitlements': {
            Key.MAX_BRANCHES: 1, Key.MAX_EMPLOYEES: 5, Key.MAX_SERVICES: 40,
            Key.BROADCASTS_PER_MONTH: 8, Key.AI_REQUESTS_PER_MONTH: 300,
            Key.FEATURE_ANALYTICS: True, Key.FEATURE_AI: True,
            Key.FEATURE_ONLINE_PAYMENTS: True,
        },
    },
    {
        'code': 'pro', 'name': 'Профи', 'price_minor': 2490000, 'billing_period': 'month',
        'trial_days': 0, 'sort_order': 2,
        'entitlements': {
            Key.MAX_BRANCHES: 3, Key.MAX_EMPLOYEES: 20, Key.MAX_SERVICES: 200,
            Key.BROADCASTS_PER_MONTH: 40, Key.AI_REQUESTS_PER_MONTH: 2000,
            Key.FEATURE_ANALYTICS: True, Key.FEATURE_AI: True,
            Key.FEATURE_ONLINE_PAYMENTS: True,
        },
    },
)


@dataclass(frozen=True)
class Entitlements:
    plan_code: str
    subscription_status: str
    limits: dict[str, int | None]
    features: dict[str, bool]

    def limit(self, key: str) -> int | None:
        return self.limits.get(key)

    def feature(self, key: str) -> bool:
        return self.features.get(key, False)

    @property
    def active(self) -> bool:
        return self.subscription_status in ENTITLED_SUBSCRIPTION_STATUSES


async def load(session: AsyncSession, company_id: uuid.UUID) -> Entitlements:
    row = (await session.execute(
        select(Subscription, Plan)
        .join(Plan, Plan.id == Subscription.plan_id)
        .where(Subscription.company_id == company_id)
    )).first()
    if row is None:
        # Компания без подписки не может ничего создавать — это не «безлимит».
        return Entitlements(plan_code='none', subscription_status='cancelled', limits={}, features={})

    subscription, plan = row
    rows = (await session.execute(
        select(PlanEntitlement).where(PlanEntitlement.plan_id == plan.id)
    )).scalars().all()

    limits: dict[str, int | None] = {}
    features: dict[str, bool] = {}
    for item in rows:
        if item.key.startswith('feature_'):
            features[item.key] = item.enabled
        else:
            limits[item.key] = item.limit_value
    return Entitlements(
        plan_code=plan.code,
        subscription_status=subscription.status,
        limits=limits,
        features=features,
    )


async def _count_usage(session: AsyncSession, company_id: uuid.UUID, key: str) -> int:
    if key == Key.MAX_EMPLOYEES:
        # TEAM-008: считаем по активным memberships и активным карточкам —
        # уволенный сотрудник место в тарифе не занимает.
        return int(await session.scalar(
            select(func.count()).select_from(Employee).where(
                Employee.company_id == company_id, Employee.active.is_(True),
            )
        ) or 0)
    if key == Key.MAX_SERVICES:
        return int(await session.scalar(
            select(func.count()).select_from(Service).where(
                Service.company_id == company_id, Service.active.is_(True),
            )
        ) or 0)
    if key == Key.MAX_BRANCHES:
        from app.db.models import Branch
        from app.domain import BranchStatus
        return int(await session.scalar(
            select(func.count()).select_from(Branch).where(
                Branch.company_id == company_id, Branch.status == BranchStatus.ACTIVE,
            )
        ) or 0)
    if key == Key.BROADCASTS_PER_MONTH:
        start, _ = current_period()
        return int(await session.scalar(
            select(func.count()).select_from(Broadcast).where(
                Broadcast.company_id == company_id, Broadcast.started_at >= start,
            )
        ) or 0)
    # Остальное считаем по счётчику окна.
    start, _ = current_period()
    return int(await session.scalar(
        select(EntitlementUsage.used).where(
            EntitlementUsage.company_id == company_id,
            EntitlementUsage.key == key,
            EntitlementUsage.period_start == start,
        )
    ) or 0)


def current_period(now: datetime | None = None) -> tuple[datetime, datetime]:
    """Календарный месяц в UTC. Достаточно для лимитов; биллинг считает свой период."""
    now = now or utcnow()
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = (start + timedelta(days=32)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start, end


async def require_capacity(
    session: AsyncSession, company_id: uuid.UUID, key: str, *, adding: int = 1,
) -> None:
    """Бросает EntitlementExceeded, если после добавления лимит будет превышен."""
    entitlements = await load(session, company_id)
    if not entitlements.active:
        raise SubscriptionInactive(details={'subscription_status': entitlements.subscription_status})

    limit = entitlements.limit(key)
    if limit is None:
        return
    used = await _count_usage(session, company_id, key)
    if used + adding > limit:
        raise EntitlementExceeded(key, limit, used)


async def require_feature(session: AsyncSession, company_id: uuid.UUID, key: str) -> None:
    entitlements = await load(session, company_id)
    if not entitlements.active:
        raise SubscriptionInactive(details={'subscription_status': entitlements.subscription_status})
    if not entitlements.feature(key):
        raise EntitlementExceeded(key, 0, 0)


async def consume(
    session: AsyncSession, company_id: uuid.UUID, key: str, *, amount: int = 1,
) -> None:
    """Увеличивает счётчик окна. Вызывается в той же транзакции, что и действие."""
    start, end = current_period()
    usage = await session.scalar(
        select(EntitlementUsage).where(
            EntitlementUsage.company_id == company_id,
            EntitlementUsage.key == key,
            EntitlementUsage.period_start == start,
        )
    )
    if usage is None:
        usage = EntitlementUsage(
            id=new_uuid(), company_id=company_id, key=key,
            period_start=start, period_end=end, used=amount,
        )
        session.add(usage)
        return
    usage.used += amount


async def usage_report(session: AsyncSession, company_id: uuid.UUID) -> dict[str, dict]:
    """Что показать в интерфейсе: текущее использование и лимит (ТЗ 24.4)."""
    entitlements = await load(session, company_id)
    report: dict[str, dict] = {}
    for key, limit in entitlements.limits.items():
        report[key] = {'used': await _count_usage(session, company_id, key), 'limit': limit}
    for key, enabled in entitlements.features.items():
        report[key] = {'enabled': enabled}
    report['plan'] = {'code': entitlements.plan_code, 'status': entitlements.subscription_status}
    return report


async def ensure_default_plans(session: AsyncSession) -> None:
    """Идемпотентный посев тарифов: нужен на старте окружения и в тестах."""
    for spec in DEFAULT_PLANS:
        plan = await session.scalar(select(Plan).where(Plan.code == spec['code']))
        if plan is None:
            plan = Plan(
                id=new_uuid(), code=spec['code'], name=spec['name'],
                price_minor=spec['price_minor'], currency_code='KZT',
                billing_period=spec['billing_period'], trial_days=spec['trial_days'],
                active=True, sort_order=spec['sort_order'],
                created_at=utcnow(), updated_at=utcnow(),
            )
            session.add(plan)
            await session.flush()

        existing = {
            e.key: e for e in (await session.execute(
                select(PlanEntitlement).where(PlanEntitlement.plan_id == plan.id)
            )).scalars().all()
        }
        for key, value in spec['entitlements'].items():
            if key in existing:
                continue
            session.add(PlanEntitlement(
                id=new_uuid(), plan_id=plan.id, key=key,
                limit_value=None if isinstance(value, bool) else int(value),
                enabled=bool(value),
            ))


async def start_trial(session: AsyncSession, company: Company) -> Subscription:
    """Подписка создаётся вместе с компанией — без неё write-операции закрыты."""
    from app.domain import SubscriptionStatus

    plan = await session.scalar(select(Plan).where(Plan.code == 'trial'))
    if plan is None:
        await ensure_default_plans(session)
        await session.flush()
        plan = await session.scalar(select(Plan).where(Plan.code == 'trial'))

    now = utcnow()
    subscription = Subscription(
        id=new_uuid(),
        company_id=company.id,
        plan_id=plan.id,
        status=SubscriptionStatus.TRIALING,
        current_period_start=now,
        current_period_end=now + timedelta(days=max(plan.trial_days, 1)),
        auto_renew=False,
        created_at=now,
        updated_at=now,
    )
    session.add(subscription)
    return subscription
