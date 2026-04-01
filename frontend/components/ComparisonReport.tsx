"use client";

import { Card, premiumSurfaceClass } from "./ui";

export function ComparisonReport(props: { report: any; onSeek?: (t0: number, t1?: number) => void }) {
  const r = props.report;
  if (!r) return null;
  const coach = r.coach_text || r.coach || r.summary || "";
  const sim = r.score_simulation || {};
  const fixes = (r.fix_first_plan || r.fix_first || r.plan || []) as any[];
  const evidence = (r.evidence || r.evidence_sections || []) as any[];

  return (
    <div className="space-y-4">
      <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
        <div className="text-sm font-semibold">Coach</div>
        <div className="mt-2 text-sm text-slate-100 whitespace-pre-wrap">{String(coach || "").trim() || "—"}</div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="text-sm font-semibold">Score Simulation</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-slate-300">Current</div>
              <div className="text-3xl font-bold">{Number(sim.current_score || sim.current || 0)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-slate-300">Projected</div>
              <div className="text-3xl font-bold text-cyan-200">{Number(sim.projected_score || sim.projected || 0)}</div>
            </div>
          </div>
        </Card>

        <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="text-sm font-semibold">Fix First Plan</div>
          <div className="mt-3 space-y-2">
            {fixes.length ? (
              fixes.slice(0, 6).map((x, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-sm text-slate-100">{x.title || x.step || x.metric || `Step ${i + 1}`}</div>
                  {x.why ? <div className="text-xs text-slate-300 mt-1">{x.why}</div> : null}
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-300">—</div>
            )}
          </div>
        </Card>
      </div>

      {evidence.length ? (
        <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="text-sm font-semibold">Evidence</div>
          <div className="mt-3 space-y-2">
            {evidence.slice(0, 8).map((ev: any, i: number) => (
              <button
                key={i}
                type="button"
                className="w-full text-left rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/10"
                onClick={() => {
                  const t0 = Number(ev.t0 ?? ev.start ?? 0);
                  const t1 = ev.t1 ?? ev.end;
                  if (props.onSeek) props.onSeek(t0, typeof t1 === "number" ? t1 : undefined);
                }}
              >
                <div className="text-sm text-slate-100">{ev.title || ev.label || `Evidence ${i + 1}`}</div>
                {ev.note || ev.text ? <div className="text-xs text-slate-300 mt-1">{ev.note || ev.text}</div> : null}
              </button>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

