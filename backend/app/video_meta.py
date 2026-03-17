from __future__ import annotations

import json
import subprocess


def probe_duration_sec(video_path: str, ffprobe_bin: str = "ffprobe") -> int:
    try:
        p = subprocess.run(
            [
                ffprobe_bin,
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                video_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        data = json.loads(p.stdout)
        fmt = data.get("format", {}) or {}
        dur = fmt.get("duration")
        if dur is None:
            return 0
        return int(float(dur))
    except Exception:
        try:
            import av

            c = av.open(video_path)
            if c.duration is None:
                return 0
            return int(float(c.duration) / 1_000_000)  # microseconds
        except Exception:
            return 0

