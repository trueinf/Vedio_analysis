from __future__ import annotations

from app.agents.types import VisionAgentOutput
from app.pipeline.vision_analysis import analyze_video


class VisionAgent:
    def run(self, video_path: str, *, duration_sec: int) -> VisionAgentOutput:
        duration = max(1, int(duration_sec or 1))
        max_frames = 6000
        if duration <= 30:
            fps = 5.0
        elif duration <= 300:
            fps = 2.0
        else:
            fps = max(0.2, min(2.0, float(max_frames) / float(duration)))

        vm = analyze_video(video_path, target_fps=fps, width=480, max_frames=max_frames)
        return VisionAgentOutput(
            eye_contact=vm.eye_contact,
            expressions=vm.expressions,
            gestures=vm.gestures,
            quality=vm.quality,
            timeline_bins=vm.timeline_bins or [],
        )

