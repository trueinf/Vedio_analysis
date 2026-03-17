from __future__ import annotations

import math
from pathlib import Path

import av
import numpy as np


def main() -> None:
    out = Path(__file__).resolve().parent / "sample.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)

    duration_s = 8
    fps = 25
    w, h = 640, 360
    sr = 16000

    container = av.open(str(out), mode="w")

    vstream = container.add_stream("libx264", rate=fps)
    vstream.width = w
    vstream.height = h
    vstream.pix_fmt = "yuv420p"

    astream = container.add_stream("aac", rate=sr)
    astream.layout = "mono"

    # Audio: sine wave with quiet amplitude
    t = np.arange(duration_s * sr, dtype=np.float32) / sr
    audio = (0.08 * np.sin(2 * math.pi * 220.0 * t)).astype(np.float32)

    # Encode video frames
    for i in range(duration_s * fps):
        img = np.zeros((h, w, 3), dtype=np.uint8)
        x = int((w - 80) * (i / (duration_s * fps)))
        img[120:200, x : x + 80] = (255, 255, 255)
        frame = av.VideoFrame.from_ndarray(img, format="bgr24")
        for packet in vstream.encode(frame):
            container.mux(packet)

    # Encode audio in 20ms frames
    frame_len = int(sr * 0.02)
    for start in range(0, len(audio), frame_len):
        chunk = audio[start : start + frame_len]
        if len(chunk) < frame_len:
            chunk = np.pad(chunk, (0, frame_len - len(chunk)))
        af = av.AudioFrame.from_ndarray(((chunk * 32767).astype(np.int16))[None, :], format="s16", layout="mono")
        af.sample_rate = sr
        for packet in astream.encode(af):
            container.mux(packet)

    for packet in vstream.encode():
        container.mux(packet)
    for packet in astream.encode():
        container.mux(packet)

    container.close()
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()

