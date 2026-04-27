from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool, StaticPool
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.settings import settings


class Base(DeclarativeBase):
    pass


def _engine_kwargs():
    url = settings.db_url or ""
    if url.startswith("sqlite"):
        # SQLite defaults to QueuePool (size=5, overflow=10). Under API polling bursts this can
        # exhaust and start timing out, causing cascading 500s. Disable pooling for SQLite.
        #
        # If you're using in-memory SQLite, StaticPool is required to keep a single shared DB.
        if ":memory:" in url:
            return dict(
                connect_args={"check_same_thread": False},
                poolclass=StaticPool,
            )
        return dict(
            connect_args={"check_same_thread": False},
            poolclass=NullPool,
        )
    # Postgres (Railway / Neon / etc.): avoid stale connections and long hangs.
    return dict(
        pool_pre_ping=True,
        pool_recycle=280,
        pool_size=10,
        max_overflow=20,
        pool_timeout=30,
        connect_args={"connect_timeout": 15},
    )


engine = create_engine(settings.db_url, **_engine_kwargs())
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

