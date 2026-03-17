from redis import Redis
from rq import Worker

from app.settings import settings


def main() -> None:
    conn = Redis.from_url(settings.redis_url)
    worker = Worker(["video-jobs"], connection=conn)
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()

