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


def ensure_agent_tables(engine: Engine) -> None:
    # Create tables if missing (SQLite).
    try:
        with engine.begin() as c:
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

