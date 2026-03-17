from __future__ import annotations

import os
from pathlib import Path


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def safe_filename(name: str) -> str:
    name = name.strip().replace("\\", "_").replace("/", "_")
    name = "".join(c for c in name if c.isalnum() or c in ("-", "_", ".", " "))
    return name[:200] if name else "upload"


def atomic_write_bytes(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)

