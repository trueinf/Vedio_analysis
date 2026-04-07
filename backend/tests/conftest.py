"""
Set DB_URL before any app import so tests use an isolated SQLite file (not ./data/app.db).
"""

from __future__ import annotations

import os
from pathlib import Path

_backend_root = Path(__file__).resolve().parent.parent
_test_db = _backend_root / "tests" / "_test_app.db"
_test_db.parent.mkdir(parents=True, exist_ok=True)
# SQLAlchemy URL: absolute path (works on Windows with forward slashes)
os.environ["DB_URL"] = f"sqlite:///{_test_db.as_posix()}"
