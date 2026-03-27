from __future__ import annotations

import os

from app.agents.types import SpeechAgentOutput
from app.pipeline.audio_analysis import transcribe_and_measure


class SpeechAgent:
    def run(
        self,
        wav_path: str,
        *,
        duration_sec: int,
        model_override: str | None = None,
        compute_type_override: str | None = None,
    ) -> SpeechAgentOutput:
        # Speed/quality trade-off for long videos.
        # (tiny/base are much faster on CPU; small is default for shorter clips)
        if duration_sec >= 60 * 60:
            model_size = "base"
        elif duration_sec >= 10 * 60:
            model_size = "base"
        else:
            model_size = None
        if model_override is not None:
            model_size = model_override

        cpu_threads = max(1, (os.cpu_count() or 4) - 1)
        audio = transcribe_and_measure(
            wav_path,
            model_size=model_size,
            device="cpu",
            compute_type=(compute_type_override or "int8"),
        )
        return SpeechAgentOutput(
            transcript=audio.transcript,
            segments=audio.segments,
            words_timed=getattr(audio, "words_timed", []),
            duration_sec=float(getattr(audio, "duration_sec", 0.0) or 0.0),
            low_speech_detected=bool(getattr(audio, "low_speech_detected", False)),
            wpm=audio.wpm,
            words=audio.words,
            speaking_sec=audio.speaking_sec,
            fillers=audio.fillers,
            tonal_variation=audio.prosody,
            timeline_bins=audio.timeline_bins,
            metric_events=getattr(audio, "metric_events", []),
        )

