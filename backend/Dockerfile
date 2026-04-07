FROM python:3.11-slim

WORKDIR /app

# Default: process jobs in-process (see USE_RQ_QUEUE in .env.example). Omit or override in Railway if using a worker service.
ENV USE_RQ_QUEUE=false

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN python -m pip install --upgrade pip setuptools wheel \
 && pip install --no-cache-dir --progress-bar off --default-timeout=180 --retries=10 -r requirements.txt

COPY . .

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
