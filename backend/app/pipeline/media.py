from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True, text=True)

def _ffmpeg_available(ffmpeg_bin: str) -> bool:
    try:
        subprocess.run([ffmpeg_bin, "-version"], check=True, capture_output=True, text=True)
        return True
    except Exception:
        return False


def normalize_video(input_path: str, output_path: str, ffmpeg_bin: str = "ffmpeg") -> None:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    if _ffmpeg_available(ffmpeg_bin):
        run(
            [
                ffmpeg_bin,
                "-y",
                "-i",
                input_path,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                output_path,
            ]
        )
        return

    # Fallback: skip normalization if ffmpeg isn't installed.
    Path(output_path).write_bytes(Path(input_path).read_bytes())


def extract_audio_wav(input_video: str, wav_path: str, ffmpeg_bin: str = "ffmpeg", sr: int = 16000) -> None:
    Path(wav_path).parent.mkdir(parents=True, exist_ok=True)
    if _ffmpeg_available(ffmpeg_bin):
        # Speech-focused extraction: boost quiet audio + filter for speech band.
        # (This materially improves ASR on screen recordings / Zoom exports.)
        af = "loudnorm,volume=3.0,highpass=f=200,lowpass=f=3000"
        run(
            [
                ffmpeg_bin,
                "-y",
                "-i",
                input_video,
                "-vn",
                "-ac",
                "1",
                "-ar",
                str(sr),
                "-af",
                af,
                "-f",
                "wav",
                wav_path,
            ]
        )
        return

    # Fallback: decode audio with PyAV (comes with faster-whisper dependency).
    import av

    container = av.open(input_video)
    audio_streams = [s for s in container.streams if s.type == "audio"]
    if not audio_streams:
        sf.write(wav_path, np.zeros((sr,), dtype=np.float32), sr)
        return

    astream = audio_streams[0]
    astream.thread_type = "AUTO"

    samples: list[np.ndarray] = []
    for frame in container.decode(astream):
        arr = frame.to_ndarray()
        # arr shape: (channels, samples) for planar, or (samples, channels) depending on format
        if arr.ndim == 2 and arr.shape[0] <= 8:  # likely (channels, samples)
            arr = arr.mean(axis=0)
        elif arr.ndim == 2:
            arr = arr.mean(axis=1)
        arr = arr.astype(np.float32)
        samples.append(arr)

    if not samples:
        sf.write(wav_path, np.zeros((sr,), dtype=np.float32), sr)
        return

    audio = np.concatenate(samples)
    # Resample if needed using librosa (already in deps)
    if astream.rate and int(astream.rate) != int(sr):
        import librosa

        audio = librosa.resample(audio, orig_sr=int(astream.rate), target_sr=int(sr))
    sf.write(wav_path, audio, sr)

    # Normalize audio to improve ASR robustness (avoid too-quiet inputs).
    try:
        y, file_sr = sf.read(wav_path, dtype="float32")
        if y.ndim > 1:
            y = y.mean(axis=1)
        peak = float(np.max(np.abs(y))) if y.size else 0.0
        if peak > 0:
            y = y / peak * 0.95
        # target RMS ~= -20 dBFS
        rms = float(np.sqrt(np.mean(y * y))) if y.size else 0.0
        target_rms = 10 ** (-20 / 20)
        if rms > 1e-6:
            gain = min(10.0, target_rms / rms)
            y = np.clip(y * gain, -1.0, 1.0)
        sf.write(wav_path, y, file_sr)
    except Exception:
        pass


def extract_frames(
    input_video: str,
    frames_dir: str,
    ffmpeg_bin: str = "ffmpeg",
    fps: float = 5.0,
    width: int = 640,
) -> None:
    out_dir = Path(frames_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if _ffmpeg_available(ffmpeg_bin):
        run(
            [
                ffmpeg_bin,
                "-y",
                "-i",
                input_video,
                "-vf",
                f"fps={fps},scale={width}:-1",
                str(out_dir / "frame_%06d.jpg"),
            ]
        )
        return

    # Fallback: decode video frames with OpenCV.
    import cv2

    cap = cv2.VideoCapture(input_video)
    if not cap.isOpened():
        return
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(native_fps / max(0.1, fps))))
    idx = 0
    out_idx = 1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        idx += 1
        if idx % step != 0:
            continue
        h, w = frame.shape[:2]
        if w > width:
            new_h = int(round(h * (width / w)))
            frame = cv2.resize(frame, (width, new_h))
        cv2.imwrite(str(out_dir / f"frame_{out_idx:06d}.jpg"), frame)
        out_idx += 1
    cap.release()

