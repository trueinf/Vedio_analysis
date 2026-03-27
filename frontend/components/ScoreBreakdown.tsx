"use client";

import { Card, premiumSurfaceClass } from "./ui";

export type ScorePart = {
  metric: string;
  label: string;
  delta: number;
  reason?: string;
};

export function ScoreBreakdown(props: { score: number; parts: ScorePart[] }) {
  return (
    <Card className={`p-4 rounded-xl ${premiumSurfaceClass}`}>
      <div className="text-sm font-semibold">Why your score is {props.score}</div>
      <div className="mt-3 space-y-2">
        {props.parts.slice(0, 6).map((p) => {
          const w = Math.min(100, Math.max(4, Math.abs(Number(p.delta || 0)) * 4));
          return (
            <div key={`${p.metric}-${p.label}`} className="rounded-lg border border-white/10 bg-white/5 p-2">
              <div className="flex items-center justify-between text-xs">
                <div className="text-slate-200">{p.label}</div>
                <div className="text-red-300">{p.delta}</div>
              </div>
              <div className="mt-1 h-1.5 rounded bg-white/10 overflow-hidden">
                <div className="h-1.5 bg-red-400" style={{ width: `${w}%` }} />
              </div>
              {p.reason ? <div className="mt-1 text-[11px] text-slate-300">{p.reason}</div> : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

