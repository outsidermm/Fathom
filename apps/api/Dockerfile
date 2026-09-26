# Interpretability Observatory API — production image for Render.
#
# Render builds this with `apps/api` as the build context (see render.yaml,
# dockerContext). It injects $PORT at runtime; the app must bind to it.
FROM python:3.12-slim

WORKDIR /app

# Keep layer caching: deps change far less often than app code.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Local `docker run -p 8000:8000` convenience; Render ignores EXPOSE and
# injects its own $PORT.
EXPOSE 8000

# Render (and most PaaS) set $PORT; default to 8000 for local docker run.
# Shell form so ${PORT:-8000} actually expands.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
