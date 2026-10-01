"""
Работа с текстом: slug и нормализация пользовательского ввода (CAT-007, CAT-008).
"""
from __future__ import annotations

import re
import unicodedata

# Транслитерация кириллицы: slug должен быть читаемым в URL, а не набором
# процентных escape-последовательностей.
_TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
    'я': 'ya',
    # казахские буквы
    'ә': 'a', 'ғ': 'g', 'қ': 'q', 'ң': 'n', 'ө': 'o', 'ұ': 'u', 'ү': 'u', 'һ': 'h', 'і': 'i',
}

_NON_SLUG = re.compile(r'[^a-z0-9]+')
_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
_SPACES = re.compile(r'[ \t]{2,}')


def slugify(value: str, *, max_length: int = 60) -> str:
    lowered = (value or '').strip().lower()
    transliterated = ''.join(_TRANSLIT.get(ch, ch) for ch in lowered)
    ascii_only = unicodedata.normalize('NFKD', transliterated).encode('ascii', 'ignore').decode()
    slug = _NON_SLUG.sub('-', ascii_only).strip('-')
    return slug[:max_length].strip('-') or 'company'


def clean(value: str | None, *, max_length: int | None = None) -> str | None:
    """
    Убирает управляющие символы и схлопывает пробелы. Экранирование HTML —
    задача слоя вывода; здесь мы только не даём положить в БД строку,
    которая ломает логи и терминалы.
    """
    if value is None:
        return None
    text = _CONTROL.sub('', str(value)).strip()
    text = _SPACES.sub(' ', text)
    if max_length is not None:
        text = text[:max_length]
    return text or None
