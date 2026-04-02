from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.settings import settings


class Base(DeclarativeBase):
    pass


def _engine_kwargs():
    url = settings.db_url or ""
    if url.startswith("sqlite"):
        return dict(
            connect_args={"check_same_thread": False},
        )
    # Postgres (Railway / Neon / etc.): avoid stale connections and long hangs.
    return dict(
        pool_pre_ping=True,
        pool_recycle=280,
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

