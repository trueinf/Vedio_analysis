from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

import numpy as np
import librosa
import soundfile as sf
from faster_whisper import WhisperModel

from app.settings import settings


FILLERS = ["uh", "um", "like", "so", "basically", "you know"]
CHUNK_DURATION_SEC = 600
PROSODY_MAX_DURATION_SEC = 300
SAMPLING_RATE = 16000


@dataclass
class AudioMetrics:
    transcript: str
    segments: list[dict[str, Any]]
    words_timed: list[dict[str, Any]]
    duration_sec: float
    low_speech_detected: bool
    words: int
    speaking_sec: float
    wpm: float
    fillers: dict[str, Any]
    prosody: dict[str, Any]
    timeline_bins: list[dict[str, Any]]
    metric_events: list[dict[str, Any]]


def _count_words(text: str) -> int:
    tokens = re.findall(r"[A-Za-z']+", text)
    return len(tokens)


def _norm_token(token: str) -> str:
    return re.sub(r"[^a-zA-Z']", "", token).lower().strip()


def _merge_nearby_events(events: list[dict[str, Any]], gap_sec: float = 1.0) -> list[dict[str, Any]]:
    if not events:
        return []
    events = sorted(events, key=lambda e: (str(e.get("metric", "")), str(e.get("label", "")), float(e.get("t0", 0.0))))
    out: list[dict[str, Any]] = []
    cur = dict(events[0])
    for e in events[1:]:
        same_key = cur.get("metric") == e.get("metric") and cur.get("label") == e.get("label")
        if same_key and float(e.get("t0", 0.0)) - float(cur.get("t1", 0.0)) <= gap_sec:
            cur["t1"] = max(float(cur.get("t1", 0.0)), float(e.get("t1", 0.0)))
            if cur.get("value") is None and e.get("value") is not None:
                cur["value"] = e.get("value")
            continue
        out.append(cur)
        cur = dict(e)
    out.append(cur)
    return out


def _count_fillers(text: str) -> dict[str, Any]:
    t = text.lower()
    counts: dict[str, int] = {}

    # multi-word fillers first (e.g., "you know")
    for f in sorted(FILLERS, key=lambda x: -len(x.split())):
        if " " in f:
            n = len(re.findall(rf"(?<!\w){re.escape(f)}(?!\w)", t))
        else:
            n = len(re.findall(rf"(?<!\w){re.escape(f)}(?!\w)", t))
        if n:
            counts[f] = n

    total = int(sum(counts.values()))
    top = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    return {"total": total, "by_type": dict(top)}


def _get_wav_duration(wav_path: str) -> float:
    with sf.SoundFile(wav_path) as f:
        return float(len(f)) / float(f.samplerate)


def _prosody_summary(wav_path: str, max_duration_sec: float | None = None) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"sr": None}
    if max_duration_sec is not None and max_duration_sec > 0:
        kwargs["duration"] = max_duration_sec
    y, sr = librosa.load(wav_path, **kwargs)
    pitches, _ = librosa.piptrack(y=y, sr=sr)
    pitch_values = pitches[pitches > 0]

    if pitch_values.size == 0:
        return {"score": 0.0, "label": "flat"}

    std = float(np.std(pitch_values))
    if std < 20:
        label = "monotone"
    elif std < 60:
        label = "moderate"
    else:
        label = "expressive"

    return {"score": round(std, 2), "label": label}


def _segment_to_out(s: Any, chunk_start: float) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    st = float(s.start or 0.0) + chunk_start
    en = float(s.end or st) + chunk_start
    txt = (s.text or "").strip()
    seg_fillers = _count_fillers(txt)
    words_timed_chunk: list[dict[str, Any]] = []
    if getattr(s, "words", None):
        for w in s.words:
            if not getattr(w, "word", None):
                continue
            wst = float(getattr(w, "start", st - chunk_start) or (st - chunk_start)) + chunk_start
            wen = float(getattr(w, "end", wst - chunk_start) or (wst - chunk_start)) + chunk_start
            token = str(w.word).strip()
            if token:
                words_timed_chunk.append({"word": token, "start": wst, "end": wen})
    seg_out_item = {
        "start": st,
        "end": en,
        "text": txt,
        "words": _count_words(txt),
        "fillers_total": seg_fillers["total"],
        "fillers_by_type": seg_fillers["by_type"],
    }
    return seg_out_item, words_timed_chunk


def _transcribe_chunked(
    wav_path: str,
    duration_sec: float,
    model_size: str,
    device: str,
    compute_type: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    model = WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type,
        download_root=settings.models_dir,
        local_files_only=bool(settings.whisper_local_files_only),
    )
    seg_out: list[dict[str, Any]] = []
    words_timed: list[dict[str, Any]] = []
    with sf.SoundFile(wav_path) as f:
        sr = int(f.samplerate)
        for chunk_start in range(0, int(math.ceil(duration_sec)), CHUNK_DURATION_SEC):
            chunk_end = min(chunk_start + CHUNK_DURATION_SEC, duration_sec)
            start_f = int(chunk_start * sr)
            frames_to_read = int((chunk_end - chunk_start) * sr)
            if frames_to_read <= 0:
                continue
            f.seek(start_f)
            chunk_audio = f.read(frames=frames_to_read, dtype="float32")
            if chunk_audio.ndim > 1:
                chunk_audio = chunk_audio.mean(axis=1)
            if sr != SAMPLING_RATE:
                chunk_audio = librosa.resample(
                    chunk_audio.astype(np.float32), orig_sr=sr, target_sr=SAMPLING_RATE
                )
            segment_gen, _ = model.transcribe(
                chunk_audio,
                vad_filter=True,
                word_timestamps=True,
                language=settings.whisper_language,
            )
            for s in segment_gen:
                so, wt = _segment_to_out(s, float(chunk_start))
                seg_out.append(so)
                words_timed.extend(wt)
    return seg_out, words_timed


def transcribe_and_measure(
    wav_path: str,
    model_size: str | None = None,
    device: str = "cpu",
    compute_type: str = "int8",
) -> AudioMetrics:
    def _run(model_name: str) -> tuple[Any, Any]:
        model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            download_root=settings.models_dir,
            local_files_only=bool(settings.whisper_local_files_only),
        )
        return model.transcribe(
            wav_path,
            vad_filter=True,
            word_timestamps=True,
            language=settings.whisper_language,
        )

    model_size = model_size or settings.whisper_model
    duration_sec_file = _get_wav_duration(wav_path)
    seg_out: list[dict[str, Any]] = []
    words_timed: list[dict[str, Any]] = []

    if duration_sec_file <= CHUNK_DURATION_SEC:
        segments_gen, info = _run(model_size)
        segments = list(segments_gen)
        for s in segments:
            so, wt = _segment_to_out(s, 0.0)
            seg_out.append(so)
            words_timed.extend(wt)
        transcript = " ".join(t["text"] for t in seg_out if t["text"].strip())
        words = _count_words(transcript)
        speaking_sec = sum(max(0.0, t["end"] - t["start"]) for t in seg_out)
        if words_timed:
            duration_sec = max(0.0, float(words_timed[-1]["end"]) - float(words_timed[0]["start"]))
        elif seg_out:
            duration_sec = max(0.0, max(float(s["end"]) for s in seg_out) - min(float(s["start"]) for s in seg_out))
        else:
            duration_sec = 0.0
        wpm = (words / (duration_sec / 60.0)) if duration_sec > 0 else 0.0
        fillers = _count_fillers(transcript)
        fillers_per_min = (fillers["total"] / (duration_sec / 60.0)) if duration_sec > 0 else 0.0

        print("======== ASR DEBUG ========")
        print("Model:", model_size)
        print("Transcript sample:", transcript[:300])
        print("Total words:", words)
        print("Timed words:", len(words_timed))

        if words < 50 and model_size not in ("small", "medium", "large-v3"):
            print("Retrying ASR with stronger model due to low words...")
            segments = list(_run("small")[0])
            seg_out = []
            words_timed = []
            for s in segments:
                so, wt = _segment_to_out(s, 0.0)
                seg_out.append(so)
                words_timed.extend(wt)
            transcript = " ".join(t["text"] for t in seg_out if t["text"].strip())
            words = _count_words(transcript)
            if words_timed:
                duration_sec = max(0.0, float(words_timed[-1]["end"]) - float(words_timed[0]["start"]))
            elif seg_out:
                duration_sec = max(0.0, max(float(s["end"]) for s in seg_out) - min(float(s["start"]) for s in seg_out))
            else:
                duration_sec = 0.0
            wpm = (words / (duration_sec / 60.0)) if duration_sec > 0 else 0.0
            fillers = _count_fillers(transcript)
            fillers_per_min = (fillers["total"] / (duration_sec / 60.0)) if duration_sec > 0 else 0.0
            speaking_sec = sum(max(0.0, t["end"] - t["start"]) for t in seg_out)
            print("======== ASR DEBUG (RETRY) ========")
    else:
        print("======== ASR CHUNKED (long audio) ========")
        seg_out, words_timed = _transcribe_chunked(
            wav_path, duration_sec_file, model_size, device, compute_type
        )
        transcript = " ".join(t["text"] for t in seg_out if t["text"].strip())
        words = _count_words(transcript)
        speaking_sec = sum(max(0.0, t["end"] - t["start"]) for t in seg_out)
        if words_timed:
            duration_sec = max(0.0, float(words_timed[-1]["end"]) - float(words_timed[0]["start"]))
        elif seg_out:
            duration_sec = max(0.0, max(float(s["end"]) for s in seg_out) - min(float(s["start"]) for s in seg_out))
        else:
            duration_sec = 0.0
        wpm = (words / (duration_sec / 60.0)) if duration_sec > 0 else 0.0
        fillers = _count_fillers(transcript)
        fillers_per_min = (fillers["total"] / (duration_sec / 60.0)) if duration_sec > 0 else 0.0
        print("Chunked: total words:", words, "timed words:", len(words_timed))

    low_speech_detected = bool(words < 20 or duration_sec < 5)
    prosody = _prosody_summary(
        wav_path,
        max_duration_sec=PROSODY_MAX_DURATION_SEC if duration_sec_file > CHUNK_DURATION_SEC else None,
    )

    # Timeline bins (60s): allocate per segment by overlap.
    bin_size = 60
    total_dur = max((seg["end"] for seg in seg_out), default=0.0)
    n_bins = int(math.ceil(total_dur / bin_size)) if total_dur > 0 else 0
    bins = [
        {"t0": i * bin_size, "t1": (i + 1) * bin_size, "words": 0, "speaking_sec": 0.0, "fillers": 0}
        for i in range(n_bins)
    ]
    for seg in seg_out:
        st, en = float(seg["start"]), float(seg["end"])
        if en <= st:
            continue
        i0 = int(st // bin_size)
        i1 = int((en - 1e-6) // bin_size)
        for i in range(max(0, i0), min(n_bins, i1 + 1)):
            b0, b1 = bins[i]["t0"], bins[i]["t1"]
            ov = max(0.0, min(en, b1) - max(st, b0))
            if ov <= 0:
                continue
            frac = ov / (en - st)
            bins[i]["words"] += int(round(seg["words"] * frac))
            bins[i]["fillers"] += int(round(seg["fillers_total"] * frac))
            bins[i]["speaking_sec"] += float(ov)

    timeline_bins: list[dict[str, Any]] = []
    for b in bins:
        sp = float(b["speaking_sec"])
        wpm_bin = (b["words"] / (sp / 60.0)) if sp > 0 else 0.0
        fillers_pm = (b["fillers"] / (sp / 60.0)) if sp > 0 else 0.0
        timeline_bins.append(
            {
                "t0": b["t0"],
                "t1": b["t1"],
                "wpm": float(wpm_bin),
                "fillers_per_min": float(fillers_pm),
                "speaking_sec": sp,
            }
        )

    metric_events: list[dict[str, Any]] = []
    # filler events from word timestamps
    fillers_set = {f.lower() for f in FILLERS if " " not in f}
    for i, w in enumerate(words_timed):
        token = _norm_token(str(w.get("word", "")))
        if token in fillers_set:
            metric_events.append(
                {
                    "metric": "filler_words",
                    "label": token,
                    "t0": float(w.get("start", 0.0)),
                    "t1": float(w.get("end", w.get("start", 0.0))),
                    "value": 1.0,
                    "note": f'Filler "{token}"',
                    "type": "filler_words",
                    "message": f'Filler "{token}"',
                }
            )
        if i + 1 < len(words_timed):
            two = f"{token} {_norm_token(str(words_timed[i + 1].get('word', '')))}".strip()
            if two == "you know":
                metric_events.append(
                    {
                        "metric": "filler_words",
                        "label": "you know",
                        "t0": float(w.get("start", 0.0)),
                        "t1": float(words_timed[i + 1].get("end", words_timed[i + 1].get("start", 0.0))),
                        "value": 1.0,
                        "note": 'Filler "you know"',
                        "type": "filler_words",
                        "message": 'Filler "you know"',
                    }
                )

    # speech rate events in 10-second bins
    if seg_out:
        sr_chunk = 10.0
        max_t = max(float(s.get("end", 0.0)) for s in seg_out)
        n = int(math.ceil(max_t / sr_chunk))
        for i in range(n):
            t0 = i * sr_chunk
            t1 = min((i + 1) * sr_chunk, max_t)
            if t1 <= t0:
                continue
            wc = 0
            for w in words_timed:
                wst = float(w.get("start", 0.0))
                if t0 <= wst < t1:
                    wc += 1
            wpm_chunk = (wc / ((t1 - t0) / 60.0)) if (t1 - t0) > 0 else 0.0
            label = "slow" if wpm_chunk < 95 else "fast" if wpm_chunk > 160 else "normal"
            metric_events.append(
                {
                    "metric": "speech_rate",
                    "label": label,
                    "t0": float(t0),
                    "t1": float(t1),
                    "value": float(round(wpm_chunk, 2)),
                    "note": f"Speech rate {label} (~{int(wpm_chunk)} WPM)",
                    "type": "speech_rate",
                    "message": f"Speech rate {label} (~{int(wpm_chunk)} WPM)",
                }
            )

    # tonal variation events in 10-second chunks using pitch std
    try:
        with sf.SoundFile(wav_path) as f:
            sr = int(f.samplerate)
            total_sec = float(len(f)) / float(sr)
            tonal_chunk = 10.0
            for i in range(int(math.ceil(total_sec / tonal_chunk))):
                t0 = i * tonal_chunk
                t1 = min((i + 1) * tonal_chunk, total_sec)
                if t1 <= t0:
                    continue
                f.seek(int(t0 * sr))
                y = f.read(frames=int((t1 - t0) * sr), dtype="float32")
                if y.ndim > 1:
                    y = y.mean(axis=1)
                if y.size < 256:
                    continue
                pitches, _ = librosa.piptrack(y=y, sr=sr)
                pv = pitches[pitches > 0]
                if pv.size == 0:
                    continue
                std = float(np.std(pv))
                label = "monotone" if std < 20 else "expressive"
                metric_events.append(
                    {
                        "metric": "tonal_variation",
                        "label": label,
                        "t0": float(t0),
                        "t1": float(t1),
                        "value": float(round(std, 2)),
                        "note": f"Tonal variation {label} (std={std:.1f})",
                        "type": "tonal_variation",
                        "message": f"Tonal variation {label}",
                    }
                )
    except Exception:
        pass

    metric_events = _merge_nearby_events(metric_events, gap_sec=0.8)

    return AudioMetrics(
        transcript=transcript,
        segments=seg_out,
        words_timed=words_timed,
        duration_sec=float(duration_sec),
        low_speech_detected=low_speech_detected,
        words=words,
        speaking_sec=speaking_sec,
        wpm=float(wpm) if math.isfinite(wpm) else 0.0,
        fillers={"per_minute": float(fillers_per_min), "count": int(fillers["total"]), "by_type": fillers["by_type"]},
        prosody=prosody,
        timeline_bins=timeline_bins,
        metric_events=metric_events[:1000],
    )

