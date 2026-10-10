FROM python:3.12.3-slim-bookworm

RUN addgroup --system --gid 1000 appuser && \
    adduser --system --uid 1000 --gid 1000 --home /app --shell /bin/sh appuser

RUN apt-get update && \
    apt-get install -y gcc libpq-dev postgresql-client curl netcat-openbsd ffmpeg && \
    rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV APP_HOME=/app
ENV PATH="/home/appuser/.local/bin:${PATH}"
ENV PYTHONPATH=/app

WORKDIR $APP_HOME

COPY . .

RUN pip install --upgrade pip && \
    pip install --no-cache-dir poetry && \
    poetry config virtualenvs.create false && \
    poetry install --only main --no-interaction --no-ansi


RUN mkdir -p /app/migrations/versions /app/static/videos && \
    chown -R appuser:appuser /app && \
    chmod -R 775 /app && \
    touch /app.log && chown appuser:appuser /app.log && chmod 664 /app.log && \
    chmod +x /app/entrypoint.sh

USER appuser

ENTRYPOINT ["/app/entrypoint.sh"]
