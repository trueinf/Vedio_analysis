"use client";

import clsx from "clsx";

type AnyObj = Record<string, any>;

function formatSigned(n: number, digits = 0) {
  const v = Number.isFinite(n) ? n : 0;
  const f = digits ? v.toFixed(digits) : String(Math.round(v));
  return `${v >= 0 ? "+" : ""}${f}`;
}

function signTone(n: number, higherBetter: boolean) {
  if (!Number.isFinite(n)) return "text-slate-300";
  if (Math.abs(n) < 1e-6) return "text-amber-300";
  const good = higherBetter ? n > 0 : n < 0;
  return good ? "text-emerald-300" : "text-red-300";
}

function pct(v: any) {
  const num = Number(v);
  if (!Number.isFinite(num)) return "—";
  return `${Math.round(num * 100)}%`;
}

function safeNum(v: any) {
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

export function ComparisonTable(props: {
  left: AnyObj;
  right: AnyObj;
  leftDurationSec?: number;
  rightDurationSec?: number;
}) {
  const leftCards = (props.left?.cards ?? {}) as AnyObj;
  const rightCards = (props.right?.cards ?? {}) as AnyObj;

  const leftSummary = (props.left?.summary ?? {}) as AnyObj;
  const rightSummary = (props.right?.summary ?? {}) as AnyObj;

  const leftDur = Number(props.leftDurationSec ?? leftSummary?.duration_sec ?? 0) || 0;
  const rightDur = Number(props.rightDurationSec ?? rightSummary?.duration_sec ?? 0) || 0;

  const speechA = safeNum(leftCards?.speech_rate?.wpm);
  const speechB = safeNum(rightCards?.speech_rate?.wpm);

  const fillersA = safeNum(leftCards?.filler_words?.per_minute);
  const fillersB = safeNum(rightCards?.filler_words?.per_minute);

  const eyeRatioA = safeNum(leftCards?.eye_contact?.on_camera_ratio);
  const eyeRatioB = safeNum(rightCards?.eye_contact?.on_camera_ratio);

  const gesturesA = safeNum(leftCards?.gestures?.per_minute);
  const gesturesB = safeNum(rightCards?.gestures?.per_minute);

  const tonalA =
    typeof leftCards?.tonal_variation?.score === "number"
      ? leftCards?.tonal_variation?.score
      : safeNum(leftCards?.tonal_variation?.pitch_hz?.std);
  const tonalB =
    typeof rightCards?.tonal_variation?.score === "number"
      ? rightCards?.tonal_variation?.score
      : safeNum(rightCards?.tonal_variation?.pitch_hz?.std);

  // Expression change: based on change_count per minute (like MetricsGrid).
  const exprChangesA = safeNum(leftCards?.expressions?.change_count);
  const exprChangesB = safeNum(rightCards?.expressions?.change_count);
  const exprPerMinA = leftDur > 0 && exprChangesA != null ? exprChangesA / (leftDur / 60) : null;
  const exprPerMinB = rightDur > 0 && exprChangesB != null ? exprChangesB / (rightDur / 60) : null;

  const rows = [
    { label: "Speech Rate (WPM)", a: speechA, b: speechB, higherBetter: true, digits: 0 },
    { label: "Eye Contact", a: eyeRatioA == null ? null : eyeRatioA * 100, b: eyeRatioB == null ? null : eyeRatioB * 100, higherBetter: true, digits: 0, isPct: true },
    { label: "Fillers / min", a: fillersA, b: fillersB, higherBetter: false, digits: 1 },
    { label: "Gestures / min", a: gesturesA, b: gesturesB, higherBetter: true, digits: 1 },
    { label: "Tonal Variation", a: tonalA, b: tonalB, higherBetter: true, digits: 1 },
    { label: "Expression Change / min", a: exprPerMinA, b: exprPerMinB, higherBetter: true, digits: 1 },
  ];

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur">
      <div className="text-sm font-semibold mb-3">Metric Comparison</div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 text-xs">
              <th className="text-left font-semibold py-2 pr-3">Metric</th>
              <th className="text-left font-semibold py-2 pr-3">Video A</th>
              <th className="text-left font-semibold py-2 pr-3">Video B</th>
              <th className="text-left font-semibold py-2">Change (A - B)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const a = r.a;
              const b = r.b;
              const delta = a == null || b == null ? null : (a as number) - (b as number);
              const tone = delta == null ? "text-slate-300" : signTone(delta, r.higherBetter);

              const fmtA =
                a == null ? "—" : r.isPct ? `${Math.round(a)}%` : r.digits ? (a as number).toFixed(r.digits) : String(Math.round(a));
              const fmtB =
                b == null ? "—" : r.isPct ? `${Math.round(b)}%` : r.digits ? (b as number).toFixed(r.digits) : String(Math.round(b));
              const fmtDelta = delta == null ? "—" : formatSigned(delta, r.digits ? r.digits : 0);

              return (
                <tr key={r.label} className="border-t border-white/5">
                  <td className="py-2 pr-3 text-slate-200">{r.label}</td>
                  <td className="py-2 pr-3">{fmtA}</td>
                  <td className="py-2 pr-3">{fmtB}</td>
                  <td className={clsx("py-2 font-semibold", tone)}>{fmtDelta}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

