# Бот и статика без внешних зависимостей — хватает голого Python.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    DATA_DIR=/data

COPY bot/ /app/bot/
COPY server/ /app/server/
COPY webapp/ /app/webapp/

RUN mkdir -p /data

# По умолчанию запускается бот; статику поднимает отдельный сервис в compose
CMD ["python", "-u", "bot/bot.py"]
