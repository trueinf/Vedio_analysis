from __future__ import annotations

from typing import TYPE_CHECKING

from app.settings import settings

if TYPE_CHECKING:
    from rq import Queue as RQQueue


def get_queue() -> "RQQueue":
    """Imported lazily so API startup does not require Redis unless USE_RQ_QUEUE is enabled."""
    from redis import Redis
    from rq import Queue

    conn = Redis.from_url(settings.redis_url)
    return Queue("video-jobs", connection=conn, default_timeout=60 * 60 * 6)  # up to 6h


def _enqueue_in_thread(job_id: str) -> None:
    from app.worker_tasks import process_job

    import threading

    t = threading.Thread(target=process_job, args=(job_id,), daemon=True)
    t.start()


def _enqueue_task_in_thread(func_path: str, *args) -> None:
    import importlib
    import threading

    mod_name, fn_name = func_path.rsplit(".", 1)
    mod = importlib.import_module(mod_name)
    fn = getattr(mod, fn_name)
    t = threading.Thread(target=fn, args=args, daemon=True)
    t.start()


def enqueue_job(job_id: str) -> None:
    """
    Queue analysis work. Default: in-process daemon thread (single Railway/uvicorn container).

    If USE_RQ_QUEUE=true and Redis is reachable, enqueue to RQ — you must run `python -m app.worker`
    as a separate process, or jobs will sit in Redis forever.
    """
    if not settings.use_rq_queue:
        _enqueue_in_thread(job_id)
        return
    try:
        q = get_queue()
        q.connection.ping()
        q.enqueue("app.worker_tasks.process_job", job_id)
    except Exception:
        _enqueue_in_thread(job_id)


def enqueue_task(func_path: str, *args) -> None:
    if not settings.use_rq_queue:
        _enqueue_task_in_thread(func_path, *args)
        return
    try:
        q = get_queue()
        q.connection.ping()
        q.enqueue(func_path, *args)
    except Exception:
        _enqueue_task_in_thread(func_path, *args)

