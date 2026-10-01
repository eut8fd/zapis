"""
Точка входа backend.

Здесь собирается приложение: middleware корреляции и лимитов, единый
обработчик ошибок (ТЗ 12.1), маршруты и заголовки безопасности (ТЗ 17.5).
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.core import ratelimit
from app.core.context import get_correlation_id, set_actor, set_correlation_id
from app.core.errors import AppError, InternalError, ValidationFailed
from app.core.logging import configure_logging, get_logger
from app.db import base as db

log = get_logger('zapis.api')

API_PREFIX = '/api/v1'
CORRELATION_HEADER = 'X-Request-Id'


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging('DEBUG' if settings.debug else 'INFO', json_output=not settings.debug)
    log.info('backend.start', extra={'env': settings.env, 'release': settings.release,
                                    'dialect': settings.db_dialect})
    yield
    await db.dispose_engine()
    log.info('backend.stop')


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title='Zapis API',
        version='1.0.0',
        description='Backend онлайн-записи: Mini App, бот и публичный каталог.',
        lifespan=lifespan,
        # ТЗ 24.2: в production документация закрыта.
        docs_url=f'{API_PREFIX}/docs' if settings.expose_api_docs else None,
        redoc_url=None,
        openapi_url=f'{API_PREFIX}/openapi.json' if settings.expose_api_docs else None,
    )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_credentials=True,
            allow_methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
            allow_headers=['Authorization', 'Content-Type', 'Idempotency-Key', CORRELATION_HEADER],
            expose_headers=[CORRELATION_HEADER],
            max_age=600,
        )

    _install_middleware(app, settings)
    _install_error_handlers(app)
    _install_routes(app)
    return app


def _install_middleware(app: FastAPI, settings) -> None:  # noqa: ANN001
    @app.middleware('http')
    async def context_middleware(request: Request, call_next):  # noqa: ANN001
        correlation_id = set_correlation_id(request.headers.get(CORRELATION_HEADER))
        set_actor(None)
        started = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            log.exception('request.failed', extra={
                'path': request.url.path, 'method': request.method,
            })
            raise

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        response.headers[CORRELATION_HEADER] = correlation_id
        # ТЗ 17.5: базовые защитные заголовки на каждом ответе.
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Frame-Options'] = 'DENY'
        if settings.is_production:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'

        # Тихо пропускаем health: иначе лог состоит из них на 90%.
        if not request.url.path.endswith(('/live', '/ready')):
            log.info('request', extra={
                'path': request.url.path,
                'method': request.method,
                'status': response.status_code,
                'duration_ms': elapsed_ms,
            })
        return response

    @app.middleware('http')
    async def rate_limit_middleware(request: Request, call_next):  # noqa: ANN001
        if request.method == 'OPTIONS' or request.url.path.endswith(('/live', '/ready')):
            return await call_next(request)

        # Идентифицируем по токену, если он есть: иначе один NAT-адрес
        # выест лимит на весь офис.
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            bucket = f'user:{auth[-24:]}'
            limit = settings.rate_limit_user_per_minute
        else:
            client = request.headers.get('X-Forwarded-For', '') or (
                request.client.host if request.client else 'unknown'
            )
            bucket = f'anon:{client.split(",")[0].strip()}'
            limit = settings.rate_limit_anonymous_per_minute

        try:
            await ratelimit.check(bucket, limit, 60)
        except AppError as exc:
            return _error_response(exc, request)
        return await call_next(request)


def _error_response(exc: AppError, request: Request) -> JSONResponse:
    request_id = get_correlation_id()
    response = JSONResponse(
        status_code=exc.status_code,
        content=exc.to_payload(request_id),
    )
    for key, value in exc.headers.items():
        response.headers[key] = value
    if request_id:
        response.headers[CORRELATION_HEADER] = request_id
    return response


def _install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):  # noqa: ANN001
        if exc.status_code >= 500:
            log.error('app.error', extra={'code': exc.code, 'path': request.url.path})
        elif exc.status_code in (401, 403, 409, 429):
            log.warning('app.rejected', extra={
                'code': exc.code, 'status': exc.status_code, 'path': request.url.path,
            })
        return _error_response(exc, request)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):  # noqa: ANN001
        # 422 с полями рядом с их именами — фронт покажет ошибку у поля (ТЗ 23.3).
        fields: dict[str, str] = {}
        for error in exc.errors():
            location = [str(p) for p in error.get('loc', []) if p not in ('body', 'query', 'path')]
            fields['.'.join(location) or 'body'] = error.get('msg', 'invalid')
        return _error_response(ValidationFailed(fields=fields), request)

    @app.exception_handler(IntegrityError)
    async def integrity_handler(request: Request, exc: IntegrityError):  # noqa: ANN001
        # Текст ошибки БД наружу не отдаём: в нём имена таблиц и данные.
        log.warning('db.integrity_error', extra={'path': request.url.path})
        from app.core.errors import Conflict
        return _error_response(
            Conflict('Данные конфликтуют с уже существующими'), request,
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception):  # noqa: ANN001
        log.exception('unhandled', extra={'path': request.url.path})
        return _error_response(InternalError(), request)


def _install_routes(app: FastAPI) -> None:
    from app.api.v1 import (
        appointments, auth, clients, companies, health, invites, public, reviews, schedule,
        telegram,
    )

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)
    app.include_router(public.router, prefix=API_PREFIX)
    app.include_router(companies.router, prefix=API_PREFIX)
    app.include_router(schedule.router, prefix=API_PREFIX)
    app.include_router(appointments.router, prefix=API_PREFIX)
    app.include_router(clients.router, prefix=API_PREFIX)
    app.include_router(reviews.router, prefix=API_PREFIX)
    app.include_router(invites.router, prefix=API_PREFIX)
    app.include_router(telegram.router, prefix=API_PREFIX)

    _install_sandbox(app)


def _install_sandbox(app: FastAPI) -> None:
    """
    Локальная песочница подключается только по явному флагу. Конфигурация
    не пускает этот флаг дальше APP_ENV=local, но маршруты всё равно
    не регистрируем без него: чего нет, то не откроют.
    """
    settings = get_settings()
    if not (settings.dev_auth_enabled and settings.env == 'local'):
        return

    from fastapi.staticfiles import StaticFiles

    from app.sandbox import routes as sandbox

    app.include_router(sandbox.router, prefix=API_PREFIX)
    static_dir = Path(__file__).resolve().parent / 'sandbox' / 'static'
    if static_dir.exists():
        app.mount('/sandbox', StaticFiles(directory=str(static_dir), html=True), name='sandbox')
    log.warning('sandbox.enabled', extra={
        'note': 'вход без Telegram и доставка уведомлений в файл',
        'transport': settings.notify_transport,
    })


app = create_app()
