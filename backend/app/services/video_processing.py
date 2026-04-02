from __future__ import annotations

import os
from pathlib import Path

from app.pipeline.media import normalize_video
from app.settings import settings


def needs_mp4_normalization(input_path: str) -> bool:
    ext = os.path.splitext(input_path)[1].lower()
    return ext != ".mp4"


def convert_to_mp4(input_path: str, *, ffmpeg_bin: str | None = None) -> str:
    """
    Re-encode or remux to MP4 next to the input (same stem, .mp4).
    Returns path to the mp4 file.
    """
    inp = Path(input_path)
    if not inp.is_file():
        raise FileNotFoundError(f"convert_to_mp4: missing file {input_path}")
    out = inp.with_suffix(".mp4")
    if inp.resolve() == out.resolve():
        return str(out)
    ff = ffmpeg_bin or settings.ffmpeg_bin
    normalize_video(str(inp), str(out), ffmpeg_bin=ff)
    return str(out)


def prepare_input_for_pipeline(local_video: str, work_dir: Path, *, ffmpeg_bin: str | None = None) -> str:
    """
    Ensure an mp4-like input for normalize_video in the worker (optional pre-normalize).
    The main pipeline still writes artifacts/normalized.mp4 — this handles stubborn containers.
    """
    p = Path(local_video)
    if not p.is_file():
        raise FileNotFoundError(local_video)
    if not needs_mp4_normalization(str(p)):
        return str(p)
    work_dir.mkdir(parents=True, exist_ok=True)
    out = work_dir / "input_normalized.mp4"
    ff = ffmpeg_bin or settings.ffmpeg_bin
    normalize_video(str(p), str(out), ffmpeg_bin=ff)
    return str(out)
