"""
Health checks (ТЗ 20.4).

Различие принципиальное: `/live` отвечает, пока процесс жив, и не должен
падать из-за БД — иначе оркестратор будет перезапускать здоровые поды при
проблеме с базой. `/ready` проверяет зависимости и снимает трафик.
"""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.api.deps import AppSettings
from app.api.v1 import schemas as s
from app.db import base as db

router = APIRouter(tags=['ops'])


@router.get('/live', response_model=s.HealthOut)
async def live(settings: AppSettings) -> s.HealthOut:
    return s.HealthOut(status='ok', release=settings.release, env=settings.env)


@router.get('/ready', response_model=s.HealthOut)
async def ready(settings: AppSettings, response: Response) -> s.HealthOut:
    checks: dict[str, str] = {}
    healthy = True

    try:
        await db.ping()
        checks['database'] = 'ok'
    except Exception as exc:                       # noqa: BLE001 — наружу отдаём код, не текст
        checks['database'] = 'fail'
        checks['database_error'] = type(exc).__name__
        healthy = False

    if settings.redis_url:
        # Redis подключается вместе с worker-контуром; пока лимиты живут
        # в памяти процесса, а конфигурация не пускает production без URL.
        checks['redis'] = 'configured'

    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return s.HealthOut(
        status='ok' if healthy else 'degraded',
        release=settings.release, env=settings.env, checks=checks,
    )
