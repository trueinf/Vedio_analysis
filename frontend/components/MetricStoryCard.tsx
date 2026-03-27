"use client";

import { Card, premiumSurfaceClass } from "./ui";
import { EvidenceItem, EvidenceList } from "./EvidenceList";

export type MetricStory = {
  metric: string;
  score: number;
  title: string;
  insight: string;
  impact: string;
  cause: string;
  evidence: EvidenceItem[];
  actions: string[];
};

export function MetricStoryCard(props: { story: MetricStory; onSeek: (start: number, end?: number) => void }) {
  const s = props.story;
  return (
    <Card className={`p-4 rounded-xl ${premiumSurfaceClass}`}>
      <div className="text-base font-semibold">{s.title}</div>
      <div className="mt-2 text-sm">
        <span className="text-cyan-200 font-medium">Insight: </span>
        <span className="text-slate-100">{s.insight}</span>
      </div>
      <div className="mt-1 text-sm">
        <span className="text-cyan-200 font-medium">Impact: </span>
        <span className="text-slate-100">{s.impact}</span>
      </div>
      <div className="mt-1 text-sm">
        <span className="text-cyan-200 font-medium">Cause: </span>
        <span className="text-slate-100">{s.cause}</span>
      </div>
      <div className="mt-3 text-xs font-semibold text-slate-200">Evidence</div>
      <div className="mt-2">
        <EvidenceList items={s.evidence || []} onSeek={props.onSeek} />
      </div>
      <div className="mt-3 text-xs font-semibold text-slate-200">Action</div>
      <ul className="mt-1 text-xs text-slate-300 list-disc pl-4 space-y-1">
        {(s.actions || []).slice(0, 3).map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </Card>
  );
}

