import os

from redis import Redis
from rq import SimpleWorker, Worker
from rq.timeouts import TimerDeathPenalty

from app.settings import settings


def main() -> None:
    conn = Redis.from_url(settings.redis_url)
    # Windows lacks os.fork/SIGALRM; use SimpleWorker + timer timeout there.
    if os.name == "nt":
        worker = SimpleWorker(["video-jobs"], connection=conn)
        worker.death_penalty_class = TimerDeathPenalty
    else:
        worker = Worker(["video-jobs"], connection=conn)
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()

