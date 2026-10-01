"""
Тексты уведомлений на трёх языках (UX-001).

Хардкод русского в коде отправки запрещён: шаблон выбирается по locale
компании или пользователя. Отсутствующий перевод падает на русский, но
это видно в логах, а не молча.
"""
from __future__ import annotations

from datetime import datetime

from app.core.logging import get_logger

log = get_logger('zapis.messages')

LOCALES = ('ru', 'kk', 'en')
DEFAULT_LOCALE = 'ru'

TEMPLATES: dict[str, dict[str, str]] = {
    'appointment_confirmed': {
        'ru': 'Вы записаны: {title}\n{date} в {time}\n{company}{address}',
        'kk': 'Сіз жазылдыңыз: {title}\n{date} {time}\n{company}{address}',
        'en': 'You are booked: {title}\n{date} at {time}\n{company}{address}',
    },
    'appointment_rescheduled': {
        'ru': 'Запись перенесена: {title}\nНовое время — {date} в {time}',
        'kk': 'Жазба ауыстырылды: {title}\nЖаңа уақыт — {date} {time}',
        'en': 'Your booking moved: {title}\nNew time — {date} at {time}',
    },
    'appointment_cancelled': {
        'ru': 'Запись отменена: {title}\n{date} в {time}',
        'kk': 'Жазба тоқтатылды: {title}\n{date} {time}',
        'en': 'Booking cancelled: {title}\n{date} at {time}',
    },
    'appointment_reminder': {
        'ru': 'Напоминание: {title}\n{date} в {time}\n{company}{address}',
        'kk': 'Еске салу: {title}\n{date} {time}\n{company}{address}',
        'en': 'Reminder: {title}\n{date} at {time}\n{company}{address}',
    },
    'appointment_created_staff': {
        'ru': 'Новая запись: {title}\n{date} в {time}\nКлиент: {client}',
        'kk': 'Жаңа жазба: {title}\n{date} {time}\nКлиент: {client}',
        'en': 'New booking: {title}\n{date} at {time}\nClient: {client}',
    },
    'review_request': {
        'ru': 'Как прошёл визит в {company}? Оцените, это займёт полминуты.',
        'kk': '{company} қалай өтті? Бағалап қойыңыз, жарты минут.',
        'en': 'How was your visit to {company}? A quick rating would help.',
    },
    'invite_created': {
        'ru': 'Вас приглашают в команду {company}. Ссылка действует до {date}.',
        'kk': '{company} командасына шақырылдыңыз. Сілтеме {date} дейін.',
        'en': 'You are invited to join {company}. The link is valid until {date}.',
    },
    'subscription_expiring': {
        'ru': 'Подписка {company} заканчивается {date}. Продлите, чтобы приём записей не остановился.',
        'kk': '{company} жазылымы {date} аяқталады. Жазбалар тоқтамауы үшін ұзартыңыз.',
        'en': 'The {company} subscription ends on {date}. Renew to keep taking bookings.',
    },
    'payment_result': {
        'ru': 'Оплата {status}: {amount}',
        'kk': 'Төлем {status}: {amount}',
        'en': 'Payment {status}: {amount}',
    },
    'broadcast': {
        'ru': '{body}',
        'kk': '{body}',
        'en': '{body}',
    },
}

MONTHS = {
    'ru': ('января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
           'августа', 'сентября', 'октября', 'ноября', 'декабря'),
    'kk': ('қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде',
           'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'),
    'en': ('January', 'February', 'March', 'April', 'May', 'June', 'July',
           'August', 'September', 'October', 'November', 'December'),
}


def format_date(value: datetime, locale: str) -> str:
    """UX-002: дата форматируется по локали, а не одним общим шаблоном."""
    months = MONTHS.get(locale, MONTHS[DEFAULT_LOCALE])
    return f'{value.day} {months[value.month - 1]}'


def format_money(amount_minor: int, currency: str, locale: str) -> str:
    whole = amount_minor // 100
    cents = amount_minor % 100
    grouped = f'{whole:,}'.replace(',', ' ' if locale != 'en' else ',')
    return f'{grouped}.{cents:02d} {currency}' if cents else f'{grouped} {currency}'


def render(template: str, locale: str, values: dict) -> str:
    variants = TEMPLATES.get(template)
    if variants is None:
        log.warning('message.template_missing', extra={'template': template})
        return values.get('body') or ''

    text = variants.get(locale)
    if text is None:
        log.warning('message.locale_missing', extra={'template': template, 'locale': locale})
        text = variants[DEFAULT_LOCALE]

    # Отсутствующий плейсхолдер не должен ронять отправку — подставляем пусто.
    safe = {key: values.get(key, '') for key in _placeholders(text)}
    return text.format(**safe).strip()


def _placeholders(text: str) -> set[str]:
    import string
    return {name for _, name, _, _ in string.Formatter().parse(text) if name}
