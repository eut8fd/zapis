"""
Точка входа worker: `python -m app.workers.run`.

Отдельный процесс от API — так требует ТЗ 22.2. Останавливается по SIGTERM
корректно: текущая пачка дорабатывается, новая не берётся.
"""
from __future__ import annotations

import asyncio
import signal

from app.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db import base as db
from app.workers.notifier import requeue_stale, run_forever

log = get_logger('zapis.worker')


async def main() -> None:
    settings = get_settings()
    configure_logging('DEBUG' if settings.debug else 'INFO', json_output=not settings.debug)
    log.info('worker.boot', extra={'env': settings.env, 'release': settings.release})

    # После падения предыдущего процесса часть задач осталась в processing.
    async with db.get_sessionmaker()() as session:
        recovered = await requeue_stale(session)
    if recovered:
        log.warning('worker.requeued_stale', extra={'count': recovered})

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            # Windows не умеет add_signal_handler для SIGTERM — там worker
            # останавливается по Ctrl+C через KeyboardInterrupt.
            pass

    try:
        await run_forever(stop)
    finally:
        await db.dispose_engine()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
