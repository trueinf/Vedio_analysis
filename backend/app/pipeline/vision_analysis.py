from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import cv2
import mediapipe as mp
import numpy as np

# ---------------------------------------------------------------------------
# Optional heavy deps — graceful fallback if not installed yet
# ---------------------------------------------------------------------------
try:
    import insightface
    from insightface.app import FaceAnalysis
    _INSIGHTFACE_OK = True
except Exception:
    _INSIGHTFACE_OK = False

try:
    from scenedetect import open_video, SceneManager
    from scenedetect.detectors import ContentDetector
    _SCENEDETECT_OK = True
except Exception:
    _SCENEDETECT_OK = False


# ---------------------------------------------------------------------------
# MediaPipe solutions
# ---------------------------------------------------------------------------
_mp_face_mesh = mp.solutions.face_mesh
_mp_hands = mp.solutions.hands

# Iris landmark indices (MediaPipe refine_landmarks=True)
_LEFT_IRIS  = [474, 475, 476, 477]
_RIGHT_IRIS = [469, 470, 471, 472]
_LEFT_EYE_CORNERS  = [33, 133]   # inner, outer
_RIGHT_EYE_CORNERS = [362, 263]

# Blendshape indices we care about (mediapipe >= 0.10 FaceMesh gives these
# via the Tasks API; here we derive them from raw landmarks as ratios)
# We keep a landmark-ratio approach that works with the existing FaceMesh
# solution (no extra .task file download needed).

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class SpeakerTrack:
    speaker_id: int
    face_visible: int = 0
    on_camera: int = 0
    expr_counts: dict[str, int] = field(default_factory=dict)
    expr_changes: int = 0
    prev_expr: str | None = None
    gesture_events: int = 0
    last_gesture_time: float = -1e9
    prev_wrist_px: tuple[float, float] | None = None
    # rolling window for smoothing (last 5 labels)
    eye_window: deque = field(default_factory=lambda: deque(maxlen=5))
    expr_window: deque = field(default_factory=lambda: deque(maxlen=5))
    # event windows
    eye_window_label: str | None = None
    eye_window_t0: float | None = None
    eye_window_last_t: float | None = None


@dataclass
class VisionMetrics:
    eye_contact: dict[str, Any]
    expressions: dict[str, Any]
    gestures: dict[str, Any]
    quality: dict[str, Any]
    speakers: list[dict[str, Any]] = field(default_factory=list)
    timeline_bins: list[dict[str, Any]] | None = None
    metric_events: list[dict[str, Any]] | None = None


# ---------------------------------------------------------------------------
# Scene / cut detection
# ---------------------------------------------------------------------------

def _detect_scene_cuts(video_path: str) -> list[float]:
    """Return list of timestamps (seconds) where a scene cut occurs."""
    if not _SCENEDETECT_OK:
        return []
    try:
        video = open_video(video_path)
        sm = SceneManager()
        sm.add_detector(ContentDetector(threshold=27.0))
        sm.detect_scenes(video, show_progress=False)
        scenes = sm.get_scene_list()
        # Each scene is (start_timecode, end_timecode); cut = start of scene > 0
        cuts = [s[0].get_seconds() for s in scenes[1:]]
        return cuts
    except Exception:
        return []


# ---------------------------------------------------------------------------
# InsightFace multi-face tracker
# ---------------------------------------------------------------------------

class _InsightFaceTracker:
    """Wraps InsightFace FaceAnalysis for multi-face detection + re-ID."""

    def __init__(self, gpu: bool = True) -> None:
        ctx = 0 if gpu else -1
        self._app = FaceAnalysis(
            name="buffalo_s",          # ~150 MB, fast on GPU
            allowed_modules=["detection", "recognition"],
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"] if gpu else ["CPUExecutionProvider"],
        )
        self._app.prepare(ctx_id=ctx, det_size=(320, 320))
        self._tracks: dict[int, np.ndarray] = {}   # id -> embedding
        self._next_id = 0
        self._sim_thresh = 0.35   # cosine similarity threshold for re-ID

    def reset(self) -> None:
        """Call on scene cut to clear stale tracks."""
        self._tracks.clear()

    def get_faces(self, bgr_frame: np.ndarray) -> list[dict[str, Any]]:
        """
        Returns list of dicts:
          bbox: [x1,y1,x2,y2]
          speaker_id: int (persistent across frames via re-ID)
          kps: 5-point keypoints (eyes, nose, mouth corners)
          embedding: np.ndarray
        """
        faces = self._app.get(bgr_frame)
        out = []
        for f in faces:
            emb = getattr(f, "embedding", None)
            sid = self._match_or_create(emb)
            out.append({
                "bbox": f.bbox.tolist() if f.bbox is not None else [],
                "speaker_id": sid,
                "kps": f.kps.tolist() if f.kps is not None else [],
                "embedding": emb,
            })
        return out

    def _match_or_create(self, emb: np.ndarray | None) -> int:
        if emb is None or len(self._tracks) == 0:
            sid = self._next_id
            self._next_id += 1
            if emb is not None:
                self._tracks[sid] = emb
            return sid
        # cosine similarity against known tracks
        best_sid, best_sim = -1, -1.0
        norm_emb = emb / (np.linalg.norm(emb) + 1e-6)
        for sid, t_emb in self._tracks.items():
            norm_t = t_emb / (np.linalg.norm(t_emb) + 1e-6)
            sim = float(np.dot(norm_emb, norm_t))
            if sim > best_sim:
                best_sim, best_sid = sim, sid
        if best_sim >= self._sim_thresh:
            # update embedding with running average
            self._tracks[best_sid] = 0.9 * self._tracks[best_sid] + 0.1 * emb
            return best_sid
        # new speaker
        sid = self._next_id
        self._next_id += 1
        self._tracks[sid] = emb
        return sid


# ---------------------------------------------------------------------------
# Iris-based gaze estimation
# ---------------------------------------------------------------------------

def _iris_gaze_on_camera(landmarks: np.ndarray) -> bool:
    """
    Use iris center relative to eye corners to estimate gaze direction.
    Returns True if the person appears to be looking toward the camera.
    landmarks: (478, 3) array from MediaPipe FaceMesh with refine_landmarks=True
    """
    def _iris_ratio(iris_idxs: list[int], corner_idxs: list[int]) -> float:
        iris_center = landmarks[iris_idxs].mean(axis=0)
        inner = landmarks[corner_idxs[0]]
        outer = landmarks[corner_idxs[1]]
        eye_w = float(np.linalg.norm(outer - inner) + 1e-6)
        offset = float(iris_center[0] - inner[0])
        return offset / eye_w  # 0=far inner, 1=far outer, ~0.5=center

    left_ratio  = _iris_ratio(_LEFT_IRIS,  _LEFT_EYE_CORNERS)
    right_ratio = _iris_ratio(_RIGHT_IRIS, _RIGHT_EYE_CORNERS)
    avg_ratio = (left_ratio + right_ratio) / 2.0
    # centered gaze: ratio near 0.5 means looking straight ahead
    return abs(avg_ratio - 0.5) < 0.22


# ---------------------------------------------------------------------------
# Blendshape-style expression from landmarks
# ---------------------------------------------------------------------------

def _blendshape_expression(landmarks: np.ndarray) -> str:
    """
    Derive expression from multiple landmark ratios (blendshape proxies).
    Much richer than the old 3-ratio approach.
    """
    # mouth
    left_mouth  = landmarks[61]
    right_mouth = landmarks[291]
    upper_lip   = landmarks[13]
    lower_lip   = landmarks[14]
    mouth_w     = float(np.linalg.norm(right_mouth - left_mouth) + 1e-6)
    mouth_open  = float(np.linalg.norm(lower_lip - upper_lip))
    open_ratio  = mouth_open / mouth_w

    # eye openness (both eyes)
    l_eye_top    = landmarks[159]; l_eye_bot = landmarks[145]
    r_eye_top    = landmarks[386]; r_eye_bot = landmarks[374]
    l_eye_open   = float(np.linalg.norm(l_eye_bot - l_eye_top))
    r_eye_open   = float(np.linalg.norm(r_eye_bot - r_eye_top))
    eye_open_avg = (l_eye_open + r_eye_open) / 2.0
    eye_ratio    = eye_open_avg / mouth_w

    # brow raise proxy: distance from brow to eye top
    l_brow = landmarks[70];  r_brow = landmarks[300]
    brow_raise = float(
        (np.linalg.norm(l_brow - l_eye_top) + np.linalg.norm(r_brow - r_eye_top)) / 2.0
    ) / mouth_w

    # cheek / smile: mouth corner height relative to lip center
    lip_center_y = float((upper_lip[1] + lower_lip[1]) / 2.0)
    corner_avg_y = float((left_mouth[1] + right_mouth[1]) / 2.0)
    smile_cue    = lip_center_y - corner_avg_y   # positive = corners pulled up

    # classify
    if open_ratio > 0.45 and eye_ratio > 0.15 and brow_raise > 0.55:
        return "surprised"
    if open_ratio > 0.35:
        return "speaking/open"
    if smile_cue > 0.01 * mouth_w and open_ratio < 0.20:
        return "smile"
    if eye_ratio < 0.08:
        return "squinting"
    return "neutral"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _majority(window: deque) -> str | None:
    if not window:
        return None
    counts: dict[str, int] = {}
    for v in window:
        counts[v] = counts.get(v, 0) + 1
    return max(counts, key=counts.__getitem__)


def _merge_nearby_events(
    events: list[dict[str, Any]], gap_sec: float = 1.0
) -> list[dict[str, Any]]:
    if not events:
        return []
    events = sorted(
        events,
        key=lambda e: (str(e.get("metric", "")), str(e.get("label", "")), float(e.get("t0", 0.0))),
    )
    out: list[dict[str, Any]] = []
    cur = dict(events[0])
    for e in events[1:]:
        same = cur.get("metric") == e.get("metric") and cur.get("label") == e.get("label")
        if same and float(e.get("t0", 0.0)) - float(cur.get("t1", 0.0)) <= gap_sec:
            cur["t1"] = max(float(cur.get("t1", 0.0)), float(e.get("t1", 0.0)))
            continue
        out.append(cur)
        cur = dict(e)
    out.append(cur)
    return out


def _face_bbox_center(bbox: list) -> tuple[float, float] | None:
    if len(bbox) < 4:
        return None
    return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)


def _hand_near_face(
    hand_cx: float, hand_cy: float, face_bbox: list, margin: float = 1.5
) -> bool:
    """Check if a hand center is within margin * face_bbox area of a face."""
    if len(face_bbox) < 4:
        return False
    fx1, fy1, fx2, fy2 = face_bbox
    fw = (fx2 - fx1) * margin
    fh = (fy2 - fy1) * margin
    cx = (fx1 + fx2) / 2.0
    cy = (fy1 + fy2) / 2.0
    return abs(hand_cx - cx) < fw and abs(hand_cy - cy) < fh


# ---------------------------------------------------------------------------
# Main analysis function
# ---------------------------------------------------------------------------

def analyze_video(
    video_path: str,
    target_fps: float,
    width: int = 640,
    max_frames: int | None = None,
    use_gpu: bool = True,
) -> VisionMetrics:

    # --- scene cut detection (runs fast, separate pass) ---
    cut_times: set[int] = set()  # set of integer seconds
    raw_cuts = _detect_scene_cuts(video_path)
    for c in raw_cuts:
        cut_times.add(int(c))

    # --- InsightFace tracker ---
    tracker: _InsightFaceTracker | None = None
    if _INSIGHTFACE_OK:
        try:
            tracker = _InsightFaceTracker(gpu=use_gpu)
        except Exception:
            tracker = None

    # --- MediaPipe FaceMesh (iris + blendshapes) ---
    face_mesh = _mp_face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=4,
        refine_landmarks=True,   # enables iris landmarks 468-477
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    # --- MediaPipe Hands ---
    hands_detector = _mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=4,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        _fail = {"not_measurable": True, "reason": "video decode failed"}
        return VisionMetrics(
            eye_contact=_fail, expressions=_fail,
            gestures=_fail, quality={"face_visible_ratio": 0.0},
        )

    native_fps  = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    target_fps  = float(max(0.5, target_fps))   # minimum 0.5 FPS always
    step        = max(1, int(round(native_fps / target_fps)))

    # per-speaker state
    speakers: dict[int, SpeakerTrack] = {}
    metric_events: list[dict[str, Any]] = []

    total_seen    = 0
    total_sampled = 0
    bin_size      = 10.0
    bins: dict[int, dict[str, Any]] = {}

    prev_cut_sec = -999.0

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

        # --- scene cut: reset tracker state ---
        cut_happened = any(abs(t_sec - c) < (1.0 / target_fps + 0.5) for c in raw_cuts
                           if abs(t_sec - prev_cut_sec) > 1.0)
        if cut_happened and tracker is not None:
            tracker.reset()
            prev_cut_sec = t_sec

        # --- resize ---
        h, w = img.shape[:2]
        if w > width:
            new_h = int(round(h * (width / w)))
            img   = cv2.resize(img, (width, new_h))
            h, w  = img.shape[:2]

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # --- bin bookkeeping ---
        bidx = int(t_sec // bin_size)
        if bidx not in bins:
            bins[bidx] = {
                "t0": bidx * bin_size, "t1": (bidx + 1) * bin_size,
                "sampled": 0, "face_visible": 0, "on_camera": 0,
                "gesture_events": 0, "expr_changes": 0,
            }
        b = bins[bidx]
        b["sampled"] += 1

        # ----------------------------------------------------------------
        # Face detection: InsightFace (multi-face + re-ID) or FaceMesh fallback
        # ----------------------------------------------------------------
        detected_faces: list[dict[str, Any]] = []

        if tracker is not None:
            detected_faces = tracker.get_faces(img)   # BGR input for insightface
        # Always run FaceMesh for iris + blendshapes (works on RGB)
        fm_result = face_mesh.process(rgb)

        # Build a mapping: for each InsightFace bbox, find the closest FaceMesh result
        fm_landmarks_list: list[np.ndarray] = []
        if fm_result.multi_face_landmarks:
            for fl in fm_result.multi_face_landmarks:
                pts = np.array([[l.x * w, l.y * h, l.z] for l in fl.landmark], dtype=np.float32)
                fm_landmarks_list.append(pts)

        # If InsightFace not available, synthesise detected_faces from FaceMesh
        if not detected_faces and fm_landmarks_list:
            for i, pts in enumerate(fm_landmarks_list):
                detected_faces.append({
                    "bbox": [],
                    "speaker_id": i,
                    "kps": [],
                    "embedding": None,
                })

        # ----------------------------------------------------------------
        # Hands detection
        # ----------------------------------------------------------------
        hands_result = hands_detector.process(rgb)
        hand_centers: list[tuple[float, float]] = []
        if hands_result.multi_hand_landmarks:
            for hl in hands_result.multi_hand_landmarks:
                # wrist landmark = 0
                wx = hl.landmark[0].x * w
                wy = hl.landmark[0].y * h
                hand_centers.append((wx, wy))

        # ----------------------------------------------------------------
        # Per-face processing
        # ----------------------------------------------------------------
        b["face_visible"] += min(1, len(detected_faces))

        for fi, face in enumerate(detected_faces):
            sid = int(face["speaker_id"])
            if sid not in speakers:
                speakers[sid] = SpeakerTrack(speaker_id=sid)
            sp = speakers[sid]
            sp.face_visible += 1

            # Get matching FaceMesh landmarks (closest by bbox center or index)
            lm: np.ndarray | None = None
            if fi < len(fm_landmarks_list):
                lm = fm_landmarks_list[fi]
            elif fm_landmarks_list:
                lm = fm_landmarks_list[0]

            # --- Eye contact via iris gaze ---
            if lm is not None and lm.shape[0] >= 478:
                # normalize landmarks to 0-1 for iris function
                lm_norm = lm.copy()
                lm_norm[:, 0] /= (w + 1e-6)
                lm_norm[:, 1] /= (h + 1e-6)
                on_cam = _iris_gaze_on_camera(lm_norm)
            else:
                on_cam = False

            sp.eye_window.append("good" if on_cam else "low")
            smoothed_eye = _majority(sp.eye_window) or ("good" if on_cam else "low")

            if smoothed_eye == "good":
                sp.on_camera += 1
                b["on_camera"] += 1

            # emit eye contact event on label change
            if sp.eye_window_label is None:
                sp.eye_window_label = smoothed_eye
                sp.eye_window_t0    = t_sec
            elif sp.eye_window_label != smoothed_eye:
                metric_events.append({
                    "metric": "eye_contact",
                    "label": sp.eye_window_label,
                    "speaker_id": sid,
                    "t0": float(sp.eye_window_t0 or t_sec),
                    "t1": float(sp.eye_window_last_t or t_sec),
                    "value": 1.0 if sp.eye_window_label == "good" else 0.0,
                    "note": f"Eye contact {sp.eye_window_label} (speaker {sid})",
                    "type": "eye_contact",
                    "message": f"Eye contact {sp.eye_window_label}",
                })
                sp.eye_window_label = smoothed_eye
                sp.eye_window_t0    = t_sec
            sp.eye_window_last_t = t_sec

            # --- Expression via blendshape proxies ---
            if lm is not None:
                raw_expr = _blendshape_expression(lm)
                sp.expr_window.append(raw_expr)
                expr = _majority(sp.expr_window) or raw_expr
                sp.expr_counts[expr] = sp.expr_counts.get(expr, 0) + 1
                if sp.prev_expr is not None and expr != sp.prev_expr:
                    sp.expr_changes += 1
                    b["expr_changes"] += 1
                    metric_events.append({
                        "metric": "expression_change",
                        "label": f"{sp.prev_expr}->{expr}",
                        "speaker_id": sid,
                        "t0": float(t_sec),
                        "t1": float(t_sec + 0.25),
                        "note": f"Expression {sp.prev_expr} → {expr} (speaker {sid})",
                        "type": "expression_change",
                        "message": f"Expression change {sp.prev_expr} to {expr}",
                    })
                sp.prev_expr = expr

            # --- Gesture via MediaPipe Hands (per-speaker) ---
            bbox = face.get("bbox", [])
            for hc in hand_centers:
                hx, hy = hc
                # associate hand to this face if bbox available, else use first face
                if bbox and not _hand_near_face(hx, hy, bbox, margin=2.0):
                    continue
                dist_px = 0.0
                if sp.prev_wrist_px is not None:
                    dx = hx - sp.prev_wrist_px[0]
                    dy = hy - sp.prev_wrist_px[1]
                    dist_px = float((dx * dx + dy * dy) ** 0.5)
                # normalize threshold by frame height (5% of height)
                thresh = max(20.0, h * 0.05)
                if dist_px >= thresh and (t_sec - sp.last_gesture_time) >= 1.5:
                    sp.gesture_events += 1
                    b["gesture_events"] += 1
                    sp.last_gesture_time = t_sec
                    metric_events.append({
                        "metric": "gestures",
                        "label": "beat/hand_motion",
                        "speaker_id": sid,
                        "t0": float(t_sec),
                        "t1": float(t_sec + 0.4),
                        "value": float(dist_px),
                        "note": f"Gesture detected (speaker {sid})",
                        "type": "gestures",
                        "message": "Gesture detected",
                    })
                sp.prev_wrist_px = (hx, hy)
                break  # one hand per face per frame

    cap.release()
    face_mesh.close()
    hands_detector.close()

    # --- flush final eye contact windows ---
    for sid, sp in speakers.items():
        if sp.eye_window_label and sp.eye_window_t0 is not None and sp.eye_window_last_t is not None:
            metric_events.append({
                "metric": "eye_contact",
                "label": sp.eye_window_label,
                "speaker_id": sid,
                "t0": float(sp.eye_window_t0),
                "t1": float(sp.eye_window_last_t),
                "value": 1.0 if sp.eye_window_label == "good" else 0.0,
                "note": f"Eye contact {sp.eye_window_label} (speaker {sid})",
                "type": "eye_contact",
                "message": f"Eye contact {sp.eye_window_label}",
            })

    # --- aggregate across all speakers (primary = most visible) ---
    total = total_sampled
    face_visible_total = sum(sp.face_visible for sp in speakers.values())
    face_visible_ratio = face_visible_total / total if total else 0.0

    # primary speaker = most face-visible
    primary: SpeakerTrack | None = (
        max(speakers.values(), key=lambda s: s.face_visible) if speakers else None
    )

    if primary is None or face_visible_ratio < 0.05:
        eye_contact  = {"not_measurable": True, "reason": "face rarely visible", "face_visible_ratio": face_visible_ratio}
        expressions  = {"not_measurable": True, "reason": "face rarely visible", "by_type": {}}
        gestures_out = {"event_count": 0, "types": {}}
    else:
        eye_contact = {
            "on_camera_ratio": (primary.on_camera / primary.face_visible) if primary.face_visible else 0.0,
            "face_visible_ratio": face_visible_ratio,
        }
        expressions = {
            "by_type": primary.expr_counts,
            "change_count": primary.expr_changes,
        }
        total_gestures = sum(sp.gesture_events for sp in speakers.values())
        gesture_types: dict[str, int] = {}
        for sp in speakers.values():
            gesture_types["beat/hand_motion"] = gesture_types.get("beat/hand_motion", 0) + sp.gesture_events
        gestures_out = {"event_count": total_gestures, "types": gesture_types}

    # per-speaker summary for multi-person videos
    speakers_summary = [
        {
            "speaker_id": sp.speaker_id,
            "face_visible": sp.face_visible,
            "on_camera_ratio": (sp.on_camera / sp.face_visible) if sp.face_visible else 0.0,
            "expr_counts": sp.expr_counts,
            "expr_changes": sp.expr_changes,
            "gesture_events": sp.gesture_events,
        }
        for sp in sorted(speakers.values(), key=lambda s: s.face_visible, reverse=True)
    ]

    return VisionMetrics(
        eye_contact=eye_contact,
        expressions=expressions,
        gestures=gestures_out,
        quality={
            "face_visible_ratio": face_visible_ratio,
            "sampled_frames": total,
            "speakers_detected": len(speakers),
            "scene_cuts_detected": len(raw_cuts),
            "insightface_active": tracker is not None,
        },
        speakers=speakers_summary,
        timeline_bins=[bins[k] for k in sorted(bins.keys())],
        metric_events=_merge_nearby_events(metric_events, gap_sec=1.0)[:1000],
    )
