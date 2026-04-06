from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine


def _has_column(engine: Engine, table: str, column: str) -> bool:
    with engine.connect() as c:
        rows = c.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(r[1] == column for r in rows)


def ensure_job_progress_columns(engine: Engine) -> None:
    # SQLite-friendly, best-effort migrations.
    try:
        if not _has_column(engine, "jobs", "stage"):
            with engine.begin() as c:
                c.execute(text("ALTER TABLE jobs ADD COLUMN stage VARCHAR(64) NOT NULL DEFAULT 'queued'"))
        if not _has_column(engine, "jobs", "progress"):
            with engine.begin() as c:
                c.execute(text("ALTER TABLE jobs ADD COLUMN progress FLOAT NOT NULL DEFAULT 0.0"))
        if not _has_column(engine, "jobs", "collection_id"):
            with engine.begin() as c:
                c.execute(text("ALTER TABLE jobs ADD COLUMN collection_id VARCHAR(36) NOT NULL DEFAULT ''"))
    except Exception:
        # If something goes wrong, keep startup alive; worker will still function.
        return


def ensure_job_source_column(engine: Engine) -> None:
    """Add jobs.job_source for direct-to-Storage uploads (Postgres + SQLite)."""
    try:
        from sqlalchemy import inspect

        insp = inspect(engine)
        cols = [c["name"] for c in insp.get_columns("jobs")]
        if "job_source" in cols:
            return
        with engine.begin() as c:
            c.execute(text("ALTER TABLE jobs ADD COLUMN job_source VARCHAR(32) NOT NULL DEFAULT 'file'"))
    except Exception:
        pass


def ensure_agent_tables(engine: Engine) -> None:
    # Create tables if missing (SQLite).
    try:
        with engine.begin() as c:
            c.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS channels ("
                    "id VARCHAR(36) PRIMARY KEY,"
                    "created_at DATETIME NOT NULL,"
                    "name VARCHAR(256) NOT NULL UNIQUE"
                    ")"
                )
            )
            c.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS collections ("
                    "id VARCHAR(36) PRIMARY KEY,"
                    "created_at DATETIME NOT NULL,"
                    "channel_id VARCHAR(36) NOT NULL,"
                    "title VARCHAR(256) NOT NULL DEFAULT '',"
                    "FOREIGN KEY(channel_id) REFERENCES channels(id)"
                    ")"
                )
            )
            c.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS videos ("
                    "id VARCHAR(36) PRIMARY KEY,"
                    "created_at DATETIME NOT NULL,"
                    "original_filename VARCHAR(512) NOT NULL,"
                    "video_path VARCHAR(1024) NOT NULL,"
                    "duration_sec INTEGER NOT NULL DEFAULT 0"
                    ")"
                )
            )
            c.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS metrics ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                    "video_id VARCHAR(36) NOT NULL,"
                    "created_at DATETIME NOT NULL,"
                    "metrics_json TEXT NOT NULL,"
                    "FOREIGN KEY(video_id) REFERENCES videos(id)"
                    ")"
                )
            )
            c.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS feedback ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                    "video_id VARCHAR(36) NOT NULL,"
                    "created_at DATETIME NOT NULL,"
                    "feedback_text TEXT NOT NULL,"
                    "FOREIGN KEY(video_id) REFERENCES videos(id)"
                    ")"
                )
            )
    except Exception:
        return


def ensure_youtube_tables(engine: Engine) -> None:
    # Create tables if missing (SQLite).
    try:
        with engine.begin() as c:
            c.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS youtube_channels ("
                    "id VARCHAR(36) PRIMARY KEY,"
                    "created_at DATETIME NOT NULL,"
                    "handle VARCHAR(256) NOT NULL UNIQUE,"
                    "channel_id VARCHAR(64) NOT NULL DEFAULT '',"
                    "title VARCHAR(512) NOT NULL DEFAULT '',"
                    "last_ingest_id VARCHAR(36) NOT NULL DEFAULT '',"
                    "last_benchmark_json TEXT NOT NULL DEFAULT '{}',"
                    "last_benchmark_sample_size INTEGER NOT NULL DEFAULT 0,"
                    "last_benchmark_updated_at DATETIME NOT NULL"
                    ")"
                )
            )
            c.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS youtube_ingests ("
                    "id VARCHAR(36) PRIMARY KEY,"
                    "created_at DATETIME NOT NULL,"
                    "updated_at DATETIME NOT NULL,"
                    "channel_handle VARCHAR(256) NOT NULL,"
                    "requested_video_count INTEGER NOT NULL DEFAULT 10,"
                    "status VARCHAR(32) NOT NULL DEFAULT 'queued',"
                    "message TEXT NOT NULL DEFAULT ''"
                    ")"
                )
            )
            c.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS youtube_videos ("
                    "id VARCHAR(36) PRIMARY KEY,"
                    "created_at DATETIME NOT NULL,"
                    "updated_at DATETIME NOT NULL,"
                    "ingest_id VARCHAR(36) NOT NULL,"
                    "channel_handle VARCHAR(256) NOT NULL,"
                    "youtube_video_id VARCHAR(32) NOT NULL,"
                    "title VARCHAR(512) NOT NULL DEFAULT '',"
                    "url VARCHAR(1024) NOT NULL DEFAULT '',"
                    "video_path VARCHAR(1024) NOT NULL DEFAULT '',"
                    "job_id VARCHAR(36) NOT NULL DEFAULT '',"
                    "status VARCHAR(32) NOT NULL DEFAULT 'queued',"
                    "error_message TEXT NOT NULL DEFAULT '',"
                    "FOREIGN KEY(ingest_id) REFERENCES youtube_ingests(id)"
                    ")"
                )
            )
    except Exception:
        return

