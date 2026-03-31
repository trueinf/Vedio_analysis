from __future__ import annotations

from app.agents.types import VisionAgentOutput
from app.pipeline.vision_analysis import analyze_video
from app.settings import settings


class VisionAgent:
    def run(
        self,
        video_path: str,
        *,
        duration_sec: int,
        target_fps_override: float | None = None,
        max_frames_override: int | None = None,
        width_override: int | None = None,
    ) -> VisionAgentOutput:
        duration = max(1, int(duration_sec or 1))
        max_frames = int(max_frames_override) if max_frames_override is not None else 12000
        width = int(width_override or 480)

        # Minimum 1 FPS always; scale down for very long videos but never below 1
        if duration <= 30:
            fps = 5.0
        elif duration <= 300:
            fps = 3.0
        elif duration <= 1800:
            fps = 2.0
        else:
            fps = max(0.2, min(2.0, float(max_frames) / float(duration)))
        if target_fps_override is not None:
            fps = float(target_fps_override)

        vm = analyze_video(
            video_path,
            target_fps=fps,
            width=width,
            max_frames=max_frames,
            use_gpu=settings.vision_insightface_gpu,
        )
        return VisionAgentOutput(
            eye_contact=vm.eye_contact,
            expressions=vm.expressions,
            gestures=vm.gestures,
            quality=vm.quality,
            timeline_bins=vm.timeline_bins or [],
            metric_events=vm.metric_events or [],
            speakers=vm.speakers or [],
        )
