"use client";

import { Card, premiumSurfaceClass } from "./ui";

type ScorePart = {
  metric: string;
  label: string;
  delta: number;
  reason?: string;
};

export function ScoreSimulator(props: { score: number; parts: ScorePart[] }) {
  const candidates = props.parts.filter((p) => Number(p.delta || 0) < 0).slice(0, 2);
  const improvements = candidates.map((c) => ({
    ...c,
    gain: Math.max(1, Math.round(Math.abs(Number(c.delta || 0)) * 0.8)),
  }));
  const improved = Math.min(100, Number(props.score || 0) + improvements.reduce((a, b) => a + b.gain, 0));
  return (
    <Card className={`p-4 rounded-xl ${premiumSurfaceClass}`}>
      <div className="text-sm font-semibold">Score Improvement Simulation</div>
      <div className="mt-2 text-xs text-slate-300">
        If you fix the highest-impact issues, your score can improve significantly.
      </div>
      <div className="mt-3 space-y-2">
        {improvements.length ? (
          improvements.map((x) => (
            <div key={x.metric} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100">
              {x.label} <span className="text-emerald-300">+{x.gain}</span>
            </div>
          ))
        ) : (
          <div className="text-xs text-slate-300">No major improvement levers detected.</div>
        )}
      </div>
      <div className="mt-3 rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm">
        Score improves from <span className="font-semibold">{props.score}</span> to{" "}
        <span className="font-semibold text-cyan-200">{improved}</span>
      </div>
    </Card>
  );
}

