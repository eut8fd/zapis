# Backend Zapis: API и worker собираются из одного образа, отличаются командой.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=UTC

WORKDIR /app

# Зависимости отдельным слоем: правки кода не пересобирают их каждый раз.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# ТЗ 17.5: процесс не работает от root.
RUN useradd --create-home --uid 10001 zapis && chown -R zapis:zapis /app
USER zapis

EXPOSE 8000

# Миграции — отдельный шаг релиза, в CMD их намеренно нет (ТЗ 10.2).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
