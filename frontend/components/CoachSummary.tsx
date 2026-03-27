"use client";

import { Card, premiumSurfaceClass } from "./ui";

type TopPriority = {
  rank: number;
  metric: string;
  title: string;
  reason?: string;
};

export type CoachSummaryData = {
  overall: string;
  top_priorities: TopPriority[];
  confidence_explanation: string;
};

export function CoachSummary(props: { summary: CoachSummaryData | null }) {
  if (!props.summary) return null;
  const s = props.summary;
  return (
    <Card className={`col-span-12 p-5 rounded-2xl ${premiumSurfaceClass}`}>
      <div className="text-lg font-semibold">AI Coach Summary</div>
      <div className="mt-2 text-sm text-slate-100">{s.overall}</div>
      <div className="mt-4 text-xs font-semibold text-slate-200">Top 3 priorities</div>
      <div className="mt-2 space-y-2">
        {(s.top_priorities || []).slice(0, 3).map((p, i) => (
          <div key={`${p.metric}-${i}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-sm text-slate-100">
              {i + 1}. {p.title}
            </div>
            {p.reason ? <div className="text-[11px] text-slate-300 mt-1">{p.reason}</div> : null}
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs text-slate-300">
        <span className="font-semibold text-slate-200">Confidence explanation:</span> {s.confidence_explanation}
      </div>
    </Card>
  );
}

