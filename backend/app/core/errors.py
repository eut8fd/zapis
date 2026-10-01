"""
Единый формат ошибки (ТЗ 12.1): `code`, `message`, `details`, `request_id`.

Клиенту не уходит ни stack trace, ни текст исключения БД — только код,
по которому фронт умеет показать человеку понятную фразу на его языке.
"""
from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Базовая ошибка приложения. Всё остальное — её подклассы."""

    status_code: int = 400
    code: str = 'bad_request'
    message: str = 'Некорректный запрос'

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.details = details or {}
        self.status_code = status_code or self.status_code
        self.headers = headers or {}
        super().__init__(self.message)

    def to_payload(self, request_id: str | None = None) -> dict[str, Any]:
        return {
            'error': {
                'code': self.code,
                'message': self.message,
                'details': self.details,
                'request_id': request_id,
            }
        }


# ---------------------------------------------------------------------- 401/403

class Unauthorized(AppError):
    status_code = 401
    code = 'unauthorized'
    message = 'Требуется вход'


class InvalidTelegramAuth(Unauthorized):
    code = 'invalid_telegram_auth'
    message = 'Не удалось подтвердить данные Telegram'


class SessionExpired(Unauthorized):
    code = 'session_expired'
    message = 'Сессия истекла, войдите заново'


class Forbidden(AppError):
    status_code = 403
    code = 'forbidden'
    message = 'Недостаточно прав'


class PermissionDenied(Forbidden):
    code = 'permission_denied'

    def __init__(self, permission: str) -> None:
        super().__init__(
            'Недостаточно прав для этого действия',
            details={'required_permission': permission},
        )


class TenantMismatch(Forbidden):
    """
    AUTH-006: company_id из URL не доказательство доступа. Наружу отдаём
    ровно 403 без подсказки, существует ли компания.
    """
    code = 'tenant_forbidden'
    message = 'Нет доступа к этой компании'


class StepUpRequired(Forbidden):
    code = 'step_up_required'
    message = 'Операция требует повторного подтверждения'


# ------------------------------------------------------------------------ 404

class NotFound(AppError):
    status_code = 404
    code = 'not_found'
    message = 'Объект не найден'

    def __init__(self, what: str = 'Объект', **kw: Any) -> None:
        super().__init__(f'{what} не найден', **kw)


# ------------------------------------------------------------------------ 409

class Conflict(AppError):
    status_code = 409
    code = 'conflict'
    message = 'Конфликт состояния'


class SlotTaken(Conflict):
    """ТЗ 13.3 шаг 7: конфликт интервала определяет только транзакция вставки."""
    code = 'SLOT_TAKEN'
    message = 'Это время только что заняли'

    def __init__(self, alternatives: list[dict[str, Any]] | None = None) -> None:
        super().__init__(details={'alternatives': alternatives or []})


class VersionConflict(Conflict):
    code = 'version_conflict'
    message = 'Запись изменилась, обновите экран'


class IdempotencyConflict(Conflict):
    code = 'idempotency_conflict'
    message = 'Тот же ключ идемпотентности уже использован с другими данными'


class InvalidStateTransition(Conflict):
    code = 'invalid_state_transition'

    def __init__(self, current: str, target: str) -> None:
        super().__init__(
            f'Нельзя перейти из «{current}» в «{target}»',
            details={'from': current, 'to': target},
        )


# ------------------------------------------------------------------------ 422

class ValidationFailed(AppError):
    status_code = 422
    code = 'validation_failed'
    message = 'Проверьте заполнение полей'

    def __init__(self, message: str | None = None, *, fields: dict[str, str] | None = None) -> None:
        super().__init__(message, details={'fields': fields or {}})


class BusinessRuleViolation(AppError):
    status_code = 422
    code = 'business_rule_violation'
    message = 'Действие противоречит правилам'


class EntitlementExceeded(AppError):
    """ТЗ 24.4: лимит тарифа проверяется сервером внутри транзакции."""
    status_code = 422
    code = 'entitlement_exceeded'
    message = 'Достигнут лимит тарифа'

    def __init__(self, key: str, limit: int | None, used: int) -> None:
        super().__init__(
            'Достигнут лимит тарифа',
            details={'entitlement': key, 'limit': limit, 'used': used},
        )


class SubscriptionInactive(AppError):
    status_code = 402
    code = 'subscription_inactive'
    message = 'Подписка компании неактивна'


# ------------------------------------------------------------------------ 429

class RateLimited(AppError):
    status_code = 429
    code = 'rate_limited'
    message = 'Слишком много запросов, попробуйте позже'

    def __init__(self, retry_after: int) -> None:
        super().__init__(
            details={'retry_after': retry_after},
            headers={'Retry-After': str(retry_after)},
        )


# ------------------------------------------------------------------------ 5xx

class ServiceUnavailable(AppError):
    status_code = 503
    code = 'service_unavailable'
    message = 'Сервис временно недоступен'


class InternalError(AppError):
    status_code = 500
    code = 'internal_error'
    message = 'Внутренняя ошибка, мы уже знаем о ней'
