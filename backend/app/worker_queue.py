from __future__ import annotations

from redis import Redis
from rq import Queue

from app.settings import settings


def get_queue() -> Queue:
    conn = Redis.from_url(settings.redis_url)
    return Queue("video-jobs", connection=conn, default_timeout=60 * 60 * 6)  # up to 6h


def enqueue_job(job_id: str) -> None:
    # Local dev convenience: if Redis isn't running, fall back to inline processing.
    try:
        q = get_queue()
        # touch connection to ensure it's reachable
        q.connection.ping()
        q.enqueue("app.worker_tasks.process_job", job_id)
    except Exception:
        from app.worker_tasks import process_job

        import threading

        t = threading.Thread(target=process_job, args=(job_id,), daemon=True)
        t.start()

