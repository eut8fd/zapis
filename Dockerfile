# Бот и статика без внешних зависимостей — хватает голого Python.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    DATA_DIR=/data

COPY bot/ /app/bot/
COPY server/ /app/server/
COPY webapp/ /app/webapp/
COPY deploy/run.py /app/deploy/run.py
# тесты в образ не нужны
RUN rm -rf /app/bot/tests /app/server/tests

RUN mkdir -p /data

# По умолчанию запускается бот; статику поднимает отдельный сервис в compose.
# На Fly один контейнер держит оба процесса — там команда переопределена
# в fly.toml на deploy/run.py.
CMD ["python", "-u", "bot/bot.py"]
