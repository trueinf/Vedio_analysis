"use client";

import type { AnalysisSummary } from "../lib/supabase";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function toPoint(a: AnalysisSummary) {
  return {
    t: a.created_at ? new Date(a.created_at).toLocaleDateString() : "",
    score: Number(a.overall_score ?? 0),
    wpm: Number(a.wpm ?? 0),
    eye: Number(a.eye_contact_ratio ?? 0) * 100,
  };
}

export function TrendCharts(props: { analyses: AnalysisSummary[] }) {
  const completed = (props.analyses || []).filter((a) => a.status === "completed");
  const data = completed.slice().reverse().map(toPoint);

  if (!data.length) {
    return <div className="text-sm text-slate-400">No completed analyses yet.</div>;
  }

  return (
    <div className="bg-white/5 border border-white/10 backdrop-blur rounded-2xl p-4">
      <div className="text-sm font-semibold">Trends</div>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="t" stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 12 }} />
            <YAxis stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ background: "rgba(2,6,23,0.9)", border: "1px solid rgba(255,255,255,0.1)" }} />
            <Line type="monotone" dataKey="score" stroke="#22d3ee" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="wpm" stroke="#34d399" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="eye" stroke="#fbbf24" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 text-xs text-slate-400">Score (cyan), WPM (green), Eye contact % (amber)</div>
    </div>
  );
}

