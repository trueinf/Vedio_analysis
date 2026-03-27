from __future__ import annotations

from typing import Any


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _metric_from_result(result: dict[str, Any]) -> dict[str, float]:
    cards = result.get("cards", {}) or {}
    summary = result.get("summary", {}) or {}
    duration_sec = max(1.0, _safe_float(summary.get("duration_sec"), 1.0))
    expr_changes = _safe_float((cards.get("expressions", {}) or {}).get("change_count"), 0.0)
    expr_pm = expr_changes / (duration_sec / 60.0)
    return {
        "hook_strength": max(0.0, min(100.0, _safe_float(result.get("confidence_score"), 0.0))),
        "retention_style": max(0.0, min(100.0, _safe_float(result.get("energy_score"), 0.0))),
        "speech_clarity": max(0.0, min(100.0, 100.0 - min(100.0, _safe_float((cards.get("filler_words", {}) or {}).get("per_minute"), 0.0) * 10.0))),
        "energy_level": max(0.0, min(100.0, _safe_float(result.get("energy_score"), 0.0))),
        "eye_contact": max(0.0, min(100.0, _safe_float((cards.get("eye_contact", {}) or {}).get("on_camera_ratio"), 0.0) * 100.0)),
        "filler_control": max(0.0, min(100.0, 100.0 - min(100.0, _safe_float((cards.get("filler_words", {}) or {}).get("per_minute"), 0.0) * 10.0))),
        "expression_use": max(0.0, min(100.0, min(100.0, expr_pm * 20.0))),
    }


BENCHMARKS: dict[str, dict[str, float]] = {
    "education": {
        "hook_strength": 78,
        "retention_style": 74,
        "speech_clarity": 82,
        "energy_level": 76,
        "eye_contact": 65,
        "filler_control": 80,
        "expression_use": 68,
    },
    "tech": {
        "hook_strength": 75,
        "retention_style": 72,
        "speech_clarity": 84,
        "energy_level": 73,
        "eye_contact": 62,
        "filler_control": 82,
        "expression_use": 64,
    },
    "business": {
        "hook_strength": 77,
        "retention_style": 73,
        "speech_clarity": 83,
        "energy_level": 74,
        "eye_contact": 66,
        "filler_control": 81,
        "expression_use": 66,
    },
    "default": {
        "hook_strength": 76,
        "retention_style": 73,
        "speech_clarity": 82,
        "energy_level": 74,
        "eye_contact": 64,
        "filler_control": 80,
        "expression_use": 65,
    },
}


def build_comparison_report(
    *,
    result: dict[str, Any],
    compare_mode: str,
    niche: str,
    competitor_channel: str,
    goal: str,
    platform: str,
) -> dict[str, Any]:
    you = _metric_from_result(result)
    base = BENCHMARKS.get((niche or "").lower(), BENCHMARKS["default"])
    if compare_mode == "specific_channel" and competitor_channel.strip():
        # deterministic channel-adjusted benchmark
        factor = 1.05
        bench = {k: max(0.0, min(100.0, round(v * factor, 2))) for k, v in base.items()}
        benchmark_label = competitor_channel.strip()
    else:
        bench = base
        benchmark_label = f"Top creators ({niche or 'general'})"

    metric_order = ["hook_strength", "retention_style", "speech_clarity", "energy_level"]
    labels = {
        "hook_strength": "Hook Strength",
        "retention_style": "Retention Style",
        "speech_clarity": "Speech Clarity",
        "energy_level": "Energy Level",
        "eye_contact": "Eye Contact",
        "filler_control": "Filler Control",
        "expression_use": "Expression Use",
    }

    benchmark_table = []
    for m in metric_order:
        y = round(you.get(m, 0.0), 1)
        b = round(bench.get(m, 0.0), 1)
        d = round(y - b, 1)
        benchmark_table.append(
            {
                "metric": m,
                "label": labels[m],
                "you": y,
                "benchmark": b,
                "delta": d,
                "status": "above" if d > 3 else "at" if abs(d) <= 3 else "below",
            }
        )

    gaps = sorted(
        [
            {"metric": m, "label": labels[m], "gap": round(bench.get(m, 0.0) - you.get(m, 0.0), 1)}
            for m in ["filler_control", "eye_contact", "expression_use", "hook_strength", "retention_style"]
        ],
        key=lambda x: x["gap"],
        reverse=True,
    )
    top = [g for g in gaps if g["gap"] > 0][:3]
    fix_first_plan = [
        {
            "rank": i + 1,
            "metric": g["metric"],
            "action": (
                "Reduce filler words and use short pauses."
                if g["metric"] == "filler_control"
                else "Maintain camera eye contact at sentence endings."
                if g["metric"] == "eye_contact"
                else "Use intentional expression shifts on key ideas."
                if g["metric"] == "expression_use"
                else "Use a stronger curiosity hook in first 5-10 seconds."
                if g["metric"] == "hook_strength"
                else "Tighten pacing and emphasis in transitions."
            ),
            "expected_gain": max(3, int(round(g["gap"] * 0.35))),
        }
        for i, g in enumerate(top)
    ]

    score_now = int(round(_safe_float((result.get("summary", {}) or {}).get("overall_score"), 0.0)))
    projected = min(100, score_now + sum(int(x["expected_gain"]) for x in fix_first_plan))

    events = list(result.get("events", []) or [])
    gap_explanations = []
    for g in top:
        metric_events = [e for e in events if str(e.get("metric") or e.get("type") or "") in {g["metric"], "filler_words" if g["metric"] == "filler_control" else g["metric"]}]
        metric_events = sorted(metric_events, key=lambda e: _safe_float(e.get("t0"), 0.0))[:3]
        evidence = [
            {
                "start": _safe_float(e.get("t0"), 0.0),
                "end": _safe_float(e.get("t1"), _safe_float(e.get("t0"), 0.0)),
                "description": str(e.get("note") or e.get("message") or "Observed behavior"),
                "impact": "This pattern reduces retention and perceived confidence.",
            }
            for e in metric_events
        ]
        gap_explanations.append(
            {
                "metric": g["metric"],
                "why_it_matters": f"{g['label']} strongly influences engagement and retention.",
                "why_top_creators_better": f"{benchmark_label} average {g['label']} is higher, giving clearer delivery impact.",
                "evidence": evidence,
            }
        )

    strengths = [x["label"] for x in benchmark_table if x["status"] in {"above", "at"}][:2]
    weaknesses = [x["label"] for x in benchmark_table if x["status"] == "below"][:3]
    coach_text = (
        f"You are strong in {', '.join(strengths) if strengths else 'baseline delivery'}, "
        f"but {', '.join(weaknesses) if weaknesses else 'a few delivery gaps'} are limiting performance against {benchmark_label}. "
        f"Fixing the top priorities can move your score from {score_now} to about {projected}."
    )

    return {
        "summary": {
            "coach_text": coach_text,
            "strengths": strengths,
            "weaknesses": weaknesses,
            "goal": goal,
            "platform": platform,
            "benchmark_label": benchmark_label,
        },
        "benchmark_table": benchmark_table,
        "gap_explanations": gap_explanations,
        "fix_first_plan": fix_first_plan,
        "score_breakdown": list(result.get("score_breakdown", []) or []),
        "score_simulation": {
            "current_score": score_now,
            "projected_score": projected,
            "improvements": [{"metric": x["metric"], "gain": x["expected_gain"]} for x in fix_first_plan],
        },
    }

