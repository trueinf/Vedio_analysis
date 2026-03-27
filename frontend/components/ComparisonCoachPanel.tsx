"use client";

import { useState } from "react";
import { Button, Card, PremiumField, PremiumChip, premiumSurfaceClass } from "./ui";

type ComparisonReport = {
  summary?: {
    coach_text?: string;
    strengths?: string[];
    weaknesses?: string[];
    benchmark_label?: string;
    benchmark_sample_size?: number;
  };
  benchmark_table?: {
    metric: string;
    label: string;
    you: number | string;
    benchmark: number | string;
    delta: number | string;
    status: "above" | "at" | "below";
  }[];
  fix_first_plan?: { rank: number; metric: string; action: string; expected_gain: number }[];
  gap_explanations?: { metric: string; evidence: { start: number; end: number; description: string; impact: string }[] }[];
  score_simulation?: { current_score: number; projected_score: number; improvements: { metric: string; gain: number }[] };
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ComparisonCoachPanel(props: {
  jobId: string | null;
  onSeek: (start: number, end?: number) => void;
  onGenerate: (input: {
    job_id: string;
    source_type: "upload" | "youtube_url";
    compare_mode: "niche_benchmark" | "specific_channel";
    niche: string;
    competitor_channel?: string;
    goal: "retention" | "clarity" | "conversion" | "confidence";
    platform: "youtube_long" | "youtube_shorts";
    language?: string;
    format?: "talking_head" | "tutorial" | "vlog" | "interview";
    audience_level?: "beginner" | "intermediate" | "advanced";
  }) => Promise<any>;
}) {
  const [compareMode, setCompareMode] = useState<"niche_benchmark" | "specific_channel">("niche_benchmark");
  const [niche, setNiche] = useState("education");
  const [competitor, setCompetitor] = useState("");
  const [goal, setGoal] = useState<"retention" | "clarity" | "conversion" | "confidence">("retention");
  const [platform, setPlatform] = useState<"youtube_long" | "youtube_shorts">("youtube_long");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ComparisonReport | null>(null);

  async function run() {
    if (!props.jobId) return;
    setBusy(true);
    setError("");
    try {
      const res = await props.onGenerate({
        job_id: props.jobId,
        source_type: "upload",
        compare_mode: compareMode,
        niche,
        competitor_channel: competitor,
        goal,
        platform,
        language: "en",
        format: "talking_head",
        audience_level: "beginner",
      });
      setReport((res?.report ?? null) as ComparisonReport);
    } catch (e: any) {
      setError(e?.message ?? "Comparison failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={`col-span-12 p-4 rounded-xl ${premiumSurfaceClass}`}>
      <div className="text-sm font-semibold">You vs Top Creators</div>
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-6 gap-2">
        <div className="lg:col-span-2">
          <div className="text-xs text-slate-300 mb-1">Compare mode</div>
          <div className="flex gap-2">
            <PremiumChip active={compareMode === "niche_benchmark"} onClick={() => setCompareMode("niche_benchmark")}>
              Top creators in niche
            </PremiumChip>
            <PremiumChip active={compareMode === "specific_channel"} onClick={() => setCompareMode("specific_channel")}>
              Specific channel
            </PremiumChip>
          </div>
        </div>
        <PremiumField className="lg:col-span-1" value={niche} onChange={setNiche} placeholder="Niche" />
        <PremiumField
          className="lg:col-span-1"
          value={competitor}
          onChange={setCompetitor}
          placeholder="@competitor channel"
        />
        <PremiumField className="lg:col-span-1" value={goal} onChange={(v) => setGoal(v as any)} placeholder="Goal" />
        <PremiumField
          className="lg:col-span-1"
          value={platform}
          onChange={(v) => setPlatform(v as any)}
          placeholder="Platform"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="premium" onClick={run} disabled={!props.jobId || busy}>
          {busy ? "Generating..." : "Generate Comparison Report"}
        </Button>
        {error ? <div className="text-xs text-red-300">{error}</div> : null}
      </div>

      {report ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
            Comparing against{" "}
            <span className="font-semibold">
              {report.summary?.benchmark_label || "selected benchmark"}
            </span>
            {" · "}sample size:{" "}
            <span className="font-semibold">{Number(report.summary?.benchmark_sample_size ?? 0)}</span>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-sm text-slate-100">{report.summary?.coach_text}</div>
          </div>

          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-white/5 text-slate-300">
                <tr>
                  <th className="text-left px-2 py-2">Metric</th>
                  <th className="text-left px-2 py-2">You</th>
                  <th className="text-left px-2 py-2">Top Creators</th>
                  <th className="text-left px-2 py-2">Delta</th>
                </tr>
              </thead>
              <tbody>
                {(report.benchmark_table || []).map((r) => (
                  <tr key={r.metric} className="border-t border-white/10">
                    <td className="px-2 py-2">{r.label}</td>
                    <td className="px-2 py-2">{r.you}</td>
                    <td className="px-2 py-2">{r.benchmark}</td>
                    <td className={`px-2 py-2 ${Number(r.delta) < 0 ? "text-red-300" : "text-emerald-300"}`}>{r.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-xs font-semibold mb-2">What to Fix First</div>
              <ul className="text-xs text-slate-200 space-y-2">
                {(report.fix_first_plan || []).map((x) => (
                  <li key={x.metric}>
                    {x.rank}. {x.action} <span className="text-emerald-300">(+{x.expected_gain})</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-xs font-semibold mb-2">Score Simulation</div>
              <div className="text-xs text-slate-200">
                {report.score_simulation?.current_score ?? 0} →{" "}
                <span className="text-cyan-200 font-semibold">{report.score_simulation?.projected_score ?? 0}</span>
              </div>
              <ul className="mt-2 text-xs text-slate-300 space-y-1">
                {(report.score_simulation?.improvements || []).map((i) => (
                  <li key={i.metric}>
                    {i.metric}: +{i.gain}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-xs font-semibold mb-2">Evidence from your video</div>
            <div className="space-y-2">
              {(report.gap_explanations || []).slice(0, 3).flatMap((g) =>
                (g.evidence || []).slice(0, 2).map((e, i) => (
                  <button
                    key={`${g.metric}-${i}-${e.start}`}
                    type="button"
                    className="w-full text-left rounded border border-white/10 px-3 py-2 hover:bg-white/10"
                    onClick={() => props.onSeek(Number(e.start || 0), Number(e.end || e.start || 0))}
                  >
                    <div className="text-xs text-cyan-200">
                      {formatTime(Number(e.start || 0))} - {formatTime(Number(e.end || e.start || 0))}
                    </div>
                    <div className="text-xs text-slate-100 mt-1">{e.description}</div>
                    <div className="text-[11px] text-slate-300 mt-1">{e.impact}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

