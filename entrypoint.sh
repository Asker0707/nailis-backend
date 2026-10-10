#!/bin/sh
set -e

wait_for_postgres() {
  echo "⏳ Waiting for PostgreSQL..."
  while ! pg_isready -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do
    sleep 1
  done
}

case "$1" in
  web)
    wait_for_postgres
    echo "🛠 Running migrations..."
    poetry run alembic upgrade head
    echo "🚀 Starting web server..."
    if [ "${ENV:-development}" = "production" ]; then
      exec poetry run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
    else
      exec poetry run uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    fi
    ;;
  celery_main)
    echo "🚀 Starting main Celery worker..."
    exec poetry run celery -A celery_app.celery worker --loglevel=info -Q default -n default@%h -c 2 --pool=solo
    ;;
  celery_email)
    echo "🚀 Starting Celery email worker..."
    exec poetry run celery -A celery_app.celery worker --loglevel=info -Q emails -n emails@%h -c 2
    ;;
  celery_videos)
    echo "🚀 Starting Celery video worker..."
    exec poetry run celery -A celery_app.celery worker --loglevel=info -Q videos -n videos@%h -c 1 --pool=prefork
    
    ;;
  flower)
    echo "🚀 Starting Flower..."
    exec poetry run celery -A celery_app.celery flower --basic_auth=admin:${FLOWER_PASSWORD} --port=5555
    ;;
  *)
    exec "$@"
    ;;
esac
