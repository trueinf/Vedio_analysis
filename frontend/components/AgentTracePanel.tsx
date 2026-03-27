"use client";

import { Card, premiumSurfaceClass } from "./ui";

type AgentTraceItem = {
  agent?: string;
  step?: string;
  plan?: Record<string, unknown>;
  reason?: string;
  model?: string | null;
  words?: number;
  face_visible_ratio?: number;
  engagement_score?: number;
  confidence_score?: number;
  overall_score?: number;
  strengths?: number;
  suggestions?: number;
};

function labelCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function compactValue(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
}

export function AgentTracePanel(props: { trace: AgentTraceItem[] }) {
  if (!props.trace.length) return null;
  return (
    <Card className={`col-span-12 p-4 rounded-xl ${premiumSurfaceClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Agent Trace</div>
          <div className="text-xs text-slate-300">Planner decisions, retries, and execution steps</div>
        </div>
        <div className="text-xs text-slate-300">{props.trace.length} steps</div>
      </div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {props.trace.map((t, i) => {
          const planEntries = Object.entries(t.plan ?? {});
          return (
            <div key={`${i}-${t.agent || "agent"}-${t.step || "step"}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-xs font-semibold text-cyan-200">
                {labelCase(String(t.agent || "agent"))} - {labelCase(String(t.step || "step").replaceAll("_", " "))}
              </div>
              {t.reason ? <div className="mt-1 text-[11px] text-amber-200">Reason: {t.reason}</div> : null}
              {t.model ? <div className="mt-1 text-[11px] text-slate-200">Model: {t.model}</div> : null}
              {typeof t.words === "number" ? <div className="mt-1 text-[11px] text-slate-200">Words: {t.words}</div> : null}
              {typeof t.face_visible_ratio === "number" ? (
                <div className="mt-1 text-[11px] text-slate-200">Face visible: {(t.face_visible_ratio * 100).toFixed(1)}%</div>
              ) : null}
              {typeof t.engagement_score === "number" ? (
                <div className="mt-1 text-[11px] text-slate-200">Engagement: {t.engagement_score}</div>
              ) : null}
              {typeof t.confidence_score === "number" ? (
                <div className="mt-1 text-[11px] text-slate-200">Confidence: {t.confidence_score}</div>
              ) : null}
              {typeof t.overall_score === "number" ? (
                <div className="mt-1 text-[11px] text-slate-200">Overall score: {t.overall_score}</div>
              ) : null}
              {typeof t.strengths === "number" || typeof t.suggestions === "number" ? (
                <div className="mt-1 text-[11px] text-slate-200">
                  Feedback: {t.strengths ?? 0} strengths, {t.suggestions ?? 0} suggestions
                </div>
              ) : null}
              {planEntries.length ? (
                <div className="mt-2 text-[11px] text-slate-300 space-y-1">
                  {planEntries.map(([k, v]) => (
                    <div key={k}>
                      {k}: <span className="text-slate-100">{compactValue(v)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

