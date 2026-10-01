"""
Время и интервалы.

ТЗ 15.3: в БД всё в UTC, филиал хранит IANA-зону, шаблоны и интерфейс
получают локальное время филиала. Единственное место, где происходит
перевод — этот модуль.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.errors import ValidationFailed

_ZONES: dict[str, ZoneInfo] = {}


def zone(name: str) -> ZoneInfo:
    """Кэш зон: ZoneInfo читает файл, а слоты дёргают её сотнями раз за запрос."""
    tz = _ZONES.get(name)
    if tz is None:
        try:
            tz = ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValidationFailed(
                'Неизвестная часовая зона', fields={'timezone': name},
            ) from exc
        _ZONES[name] = tz
    return tz


def to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError('наивное время недопустимо')
    return value.astimezone(timezone.utc)


def local(value: datetime, tz_name: str) -> datetime:
    return value.astimezone(zone(tz_name))


def local_datetime(day: date, moment: time, tz_name: str) -> datetime:
    """
    Локальные дата и время -> UTC.

    DST: в час перевода стрелок локальное время бывает несуществующим или
    двойным. fold=0 берёт первое вхождение — это ровно то поведение, которое
    проверяют тесты границ суток (ТЗ 15.3).
    """
    return datetime.combine(day, moment).replace(tzinfo=zone(tz_name), fold=0).astimezone(timezone.utc)


def start_of_local_day(day: date, tz_name: str) -> datetime:
    return local_datetime(day, time(0, 0), tz_name)


def end_of_local_day(day: date, tz_name: str) -> datetime:
    # Начало следующего дня, а не 23:59: сутки в DST бывают 23 и 25 часов.
    return start_of_local_day(day + timedelta(days=1), tz_name)


def minutes_since_midnight(value: datetime, tz_name: str) -> int:
    lv = local(value, tz_name)
    return lv.hour * 60 + lv.minute


def parse_hhmm(value: str) -> time:
    try:
        hh, _, mm = value.partition(':')
        return time(int(hh), int(mm))
    except (ValueError, TypeError) as exc:
        raise ValidationFailed('Время указывается как ЧЧ:ММ', fields={'time': value}) from exc


def format_hhmm(value: time) -> str:
    return f'{value.hour:02d}:{value.minute:02d}'


@dataclass(frozen=True, order=True)
class Interval:
    """Полуинтервал [start, end) в UTC. Смежные интервалы не пересекаются."""
    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if self.start >= self.end:
            raise ValueError('интервал должен быть непустым')

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)

    def overlaps(self, other: 'Interval') -> bool:
        return self.start < other.end and other.start < self.end

    def contains(self, other: 'Interval') -> bool:
        return self.start <= other.start and other.end <= self.end


def merge(intervals: list[Interval]) -> list[Interval]:
    """Объединяет пересекающиеся и смежные интервалы."""
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda i: (i.start, i.end))
    out = [ordered[0]]
    for item in ordered[1:]:
        last = out[-1]
        if item.start <= last.end:
            if item.end > last.end:
                out[-1] = Interval(last.start, item.end)
        else:
            out.append(item)
    return out


def intersect(a: list[Interval], b: list[Interval]) -> list[Interval]:
    """
    Пересечение двух наборов. Ровно этим считается рабочее окно мастера:
    его часы, обрезанные часами филиала (грабли `workWindow` из CLAUDE.md).
    """
    a, b = merge(a), merge(b)
    out: list[Interval] = []
    i = j = 0
    while i < len(a) and j < len(b):
        start = max(a[i].start, b[j].start)
        end = min(a[i].end, b[j].end)
        if start < end:
            out.append(Interval(start, end))
        if a[i].end < b[j].end:
            i += 1
        else:
            j += 1
    return out


def subtract(base: list[Interval], cuts: list[Interval]) -> list[Interval]:
    """Вычитает занятое время из свободного."""
    result = merge(base)
    for cut in merge(cuts):
        nxt: list[Interval] = []
        for item in result:
            if not item.overlaps(cut):
                nxt.append(item)
                continue
            if item.start < cut.start:
                nxt.append(Interval(item.start, cut.start))
            if cut.end < item.end:
                nxt.append(Interval(cut.end, item.end))
        result = nxt
    return result


def local_days(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)
