from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import mediapipe as mp
import numpy as np


@dataclass
class VisionMetrics:
    eye_contact: dict[str, Any]
    expressions: dict[str, Any]
    gestures: dict[str, Any]
    quality: dict[str, Any]
    timeline_bins: list[dict[str, Any]] | None = None
    metric_events: list[dict[str, Any]] | None = None


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
            continue
        out.append(cur)
        cur = dict(e)
    out.append(cur)
    return out


def _head_pose_yaw_pitch(face_landmarks: np.ndarray) -> tuple[float, float]:
    # Heuristic: use relative positions to estimate yaw/pitch.
    # Landmarks: 1 (nose tip-ish), 33/263 (outer eyes), 61/291 (mouth corners)
    nose = face_landmarks[1]
    left_eye = face_landmarks[33]
    right_eye = face_landmarks[263]
    left_mouth = face_landmarks[61]
    right_mouth = face_landmarks[291]

    eye_mid = (left_eye + right_eye) / 2.0
    mouth_mid = (left_mouth + right_mouth) / 2.0

    x_axis = (right_eye - left_eye)
    x_len = float(np.linalg.norm(x_axis) + 1e-6)

    # yaw: nose offset from eye midpoint normalized by eye distance
    yaw = float((nose[0] - eye_mid[0]) / x_len)
    # pitch: nose relative to eye/mouth midpoint normalized by face height proxy
    face_h = float(np.linalg.norm(mouth_mid - eye_mid) + 1e-6)
    pitch = float((nose[1] - (eye_mid[1] + mouth_mid[1]) / 2.0) / face_h)
    return yaw, pitch


def _expression_label(face_landmarks: np.ndarray) -> str:
    # Simple interpretable heuristics: smile vs neutral vs surprised/open mouth.
    left_mouth = face_landmarks[61]
    right_mouth = face_landmarks[291]
    upper_lip = face_landmarks[13]
    lower_lip = face_landmarks[14]
    left_eye_top = face_landmarks[159]
    left_eye_bottom = face_landmarks[145]

    mouth_w = float(np.linalg.norm(right_mouth - left_mouth))
    mouth_open = float(np.linalg.norm(lower_lip - upper_lip))
    eye_open = float(np.linalg.norm(left_eye_bottom - left_eye_top))

    if mouth_w <= 1e-6:
        return "neutral"

    mouth_open_ratio = mouth_open / mouth_w
    eye_open_ratio = eye_open / mouth_w

    if mouth_open_ratio > 0.35 and eye_open_ratio > 0.12:
        return "surprised"
    if mouth_open_ratio > 0.30:
        return "speaking/open"
    # smile cue: mouth corners stretched (wide mouth) with low openness
    if mouth_open_ratio < 0.18 and mouth_w > 0:
        return "smile"
    return "neutral"


def analyze_video(
    video_path: str,
    target_fps: float,
    width: int = 480,
    max_frames: int | None = None,
) -> VisionMetrics:
    mp_face = mp.solutions.face_mesh
    mp_pose = mp.solutions.pose

    face_mesh = mp_face.FaceMesh(static_image_mode=False, max_num_faces=1, refine_landmarks=True)
    pose = mp_pose.Pose(static_image_mode=False, model_complexity=1, enable_segmentation=False)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return VisionMetrics(
            eye_contact={"not_measurable": True, "reason": "video decode failed"},
            expressions={"not_measurable": True, "reason": "video decode failed"},
            gestures={"not_measurable": True, "reason": "video decode failed"},
            quality={"face_visible_ratio": 0.0},
        )

    face_visible = 0
    on_camera = 0
    expr_counts: dict[str, int] = {}
    expr_changes = 0
    prev_expr: str | None = None
    eye_window_label: str | None = None
    eye_window_t0: float | None = None
    eye_window_last_t: float | None = None

    gesture_events = 0
    prev_wrist_px: tuple[float, float] | None = None
    last_gesture_time: float = -1e9

    native_fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    target_fps = float(max(0.1, target_fps))
    step = max(1, int(round(native_fps / target_fps)))

    total_sampled = 0
    total_seen = 0
    bin_size = 60.0
    bins: dict[int, dict[str, Any]] = {}
    metric_events: list[dict[str, Any]] = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        total_seen += 1
        if total_seen % step != 0:
            continue
        if max_frames is not None and total_sampled >= max_frames:
            break
        total_sampled += 1
        t_sec = float(cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0) / 1000.0
        bidx = int(t_sec // bin_size)
        b = bins.get(bidx)
        if b is None:
            b = {
                "t0": bidx * bin_size,
                "t1": (bidx + 1) * bin_size,
                "sampled": 0,
                "face_visible": 0,
                "on_camera": 0,
                "gesture_events": 0,
                "expr_changes": 0,
            }
            bins[bidx] = b
        b["sampled"] += 1

        h, w = img.shape[:2]
        if w > width:
            new_h = int(round(h * (width / w)))
            img = cv2.resize(img, (width, new_h))
            h, w = img.shape[:2]

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        fm = face_mesh.process(rgb)
        if fm.multi_face_landmarks:
            face_visible += 1
            b["face_visible"] += 1
            lm = fm.multi_face_landmarks[0].landmark
            pts = np.array([[l.x, l.y, l.z] for l in lm], dtype=np.float32)
            yaw, pitch = _head_pose_yaw_pitch(pts)
            # on-camera threshold: near center orientation
            if abs(yaw) < 0.12 and abs(pitch) < 0.18:
                on_camera += 1
                b["on_camera"] += 1
                eye_label = "good"
            else:
                eye_label = "low"

            if eye_window_label is None:
                eye_window_label = eye_label
                eye_window_t0 = t_sec
            elif eye_window_label != eye_label:
                metric_events.append(
                    {
                        "metric": "eye_contact",
                        "label": eye_window_label,
                        "t0": float(eye_window_t0 or t_sec),
                        "t1": float(eye_window_last_t or t_sec),
                        "value": 1.0 if eye_window_label == "good" else 0.0,
                        "note": f"Eye contact {eye_window_label}",
                        "type": "eye_contact",
                        "message": f"Eye contact {eye_window_label}",
                    }
                )
                eye_window_label = eye_label
                eye_window_t0 = t_sec
            eye_window_last_t = t_sec

            expr = _expression_label(pts)
            expr_counts[expr] = expr_counts.get(expr, 0) + 1
            if prev_expr is not None and expr != prev_expr:
                expr_changes += 1
                b["expr_changes"] += 1
                metric_events.append(
                    {
                        "metric": "expression_change",
                        "label": f"{prev_expr}->{expr}",
                        "t0": float(t_sec),
                        "t1": float(t_sec + 0.25),
                        "note": f"Expression change {prev_expr} to {expr}",
                        "type": "expression_change",
                        "message": f"Expression change {prev_expr} to {expr}",
                    }
                )
            prev_expr = expr

        ps = pose.process(rgb)
        if ps.pose_landmarks:
            # Use wrist motion with cooldown as a gesture proxy (avoid per-frame inflation).
            lw = ps.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_WRIST]
            rw = ps.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_WRIST]
            wrist_px = ((lw.x + rw.x) * 0.5 * w, (lw.y + rw.y) * 0.5 * h)
            if prev_wrist_px is not None:
                dx = wrist_px[0] - prev_wrist_px[0]
                dy = wrist_px[1] - prev_wrist_px[1]
                dist_px = float((dx * dx + dy * dy) ** 0.5)
                # Threshold + cooldown (tuned to avoid inflated counts)
                if dist_px >= 60.0 and (t_sec - last_gesture_time) >= 2.5:
                    gesture_events += 1
                    b["gesture_events"] += 1
                    last_gesture_time = t_sec
                    metric_events.append(
                        {
                            "metric": "gestures",
                            "label": "beat/hand_motion",
                            "t0": float(t_sec),
                            "t1": float(t_sec + 0.4),
                            "value": float(dist_px),
                            "note": "Gesture detected",
                            "type": "gestures",
                            "message": "Gesture detected",
                        }
                    )
            prev_wrist_px = wrist_px

    cap.release()

    total = total_sampled
    face_visible_ratio = face_visible / total if total else 0.0
    if eye_window_label is not None and eye_window_t0 is not None and eye_window_last_t is not None:
        metric_events.append(
            {
                "metric": "eye_contact",
                "label": eye_window_label,
                "t0": float(eye_window_t0),
                "t1": float(eye_window_last_t),
                "value": 1.0 if eye_window_label == "good" else 0.0,
                "note": f"Eye contact {eye_window_label}",
                "type": "eye_contact",
                "message": f"Eye contact {eye_window_label}",
            }
        )

    eye_contact = (
        {
            "not_measurable": True,
            "reason": "face rarely visible",
            "face_visible_ratio": face_visible_ratio,
        }
        if face_visible_ratio < 0.05
        else {
            "on_camera_ratio": (on_camera / face_visible) if face_visible else 0.0,
            "face_visible_ratio": face_visible_ratio,
        }
    )

    expressions = (
        {"not_measurable": True, "reason": "face rarely visible", "by_type": {}}
        if face_visible_ratio < 0.05
        else {
            "by_type": expr_counts,
            "change_count": expr_changes,
        }
    )

    gestures = {
        "event_count": gesture_events,
        "types": {"beat/hand_motion": gesture_events},
    }

    return VisionMetrics(
        eye_contact=eye_contact,
        expressions=expressions,
        gestures=gestures,
        quality={"face_visible_ratio": face_visible_ratio, "sampled_frames": total},
        timeline_bins=[bins[k] for k in sorted(bins.keys())],
        metric_events=_merge_nearby_events(metric_events, gap_sec=1.0)[:1000],
    )

