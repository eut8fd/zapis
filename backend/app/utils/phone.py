"""
Нормализация телефона (CRM-003).

Нормализацию делает сервер, а не форма: один и тот же номер приходит из
Mini App, из бота через requestContact и из ручного ввода сотрудника —
и во всех трёх случаях в БД должна лечь одна строка, иначе поиск по
телефону и склейка дублей не работают.

Библиотеку международного разбора номеров не тянем: список стран проекта
утверждается отдельно (ТЗ 23.3), а сейчас поддержаны KZ и RU плюс общий
формат E.164.
"""
from __future__ import annotations

import re

from app.core.errors import ValidationFailed

_DIGITS = re.compile(r'\D+')

#: Коды, где локальная «8» в начале означает «+7».
_LEADING_EIGHT_COUNTRIES = ('7',)


def normalize_phone(value: str | None, *, required: bool = False) -> str | None:
    """
    Приводит к E.164. Возвращает None для пустого значения, если оно
    не обязательно.
    """
    if value is None or not str(value).strip():
        if required:
            raise ValidationFailed('Укажите телефон', fields={'phone': 'required'})
        return None

    raw = str(value).strip()
    has_plus = raw.startswith('+')
    digits = _DIGITS.sub('', raw)

    if not digits:
        raise ValidationFailed('Телефон указан неверно', fields={'phone': 'invalid'})

    if not has_plus and digits.startswith('8') and len(digits) == 11:
        digits = _LEADING_EIGHT_COUNTRIES[0] + digits[1:]

    if len(digits) < 8 or len(digits) > 15:
        raise ValidationFailed('Телефон указан неверно', fields={'phone': 'invalid_length'})

    return '+' + digits


def mask_phone(value: str | None) -> str | None:
    """Для экранов, где полный номер видеть не положено (CRM-001, ТЗ 18.2)."""
    if not value:
        return None
    tail = value[-4:]
    return f'{value[:2]}{"*" * max(0, len(value) - 6)}{tail}'
