"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, PremiumField, PremiumChip, premiumSurfaceClass } from "./ui";
import { createYouTubeChannelIngest, getYouTubeIngestStatus, YouTubeIngestStatus } from "@/lib/api";

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
  jobStatus?: string;
  jobOptions?: { id: string; label: string; status: string }[];
  selectedJobId?: string | null;
  onSelectJobId?: (jobId: string) => void;
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
  const [ingestId, setIngestId] = useState<string>("");
  const [ingest, setIngest] = useState<YouTubeIngestStatus | null>(null);
  const [ingesting, setIngesting] = useState(false);

  const normalizedCompetitor = useMemo(() => competitor.trim(), [competitor]);
  const effectiveJobId = (props.selectedJobId || props.jobId || "").trim();
  const effectiveJobStatus: string | undefined =
    props.jobOptions?.find((j) => j.id === effectiveJobId)?.status || props.jobStatus || undefined;

  async function run() {
    if (!effectiveJobId) return;
    if (effectiveJobStatus && effectiveJobStatus !== "completed") {
      setError("Wait for analysis to complete, then generate comparison.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await props.onGenerate({
        job_id: effectiveJobId,
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

  async function buildBenchmark() {
    if (!normalizedCompetitor) return;
    setError("");
    setIngesting(true);
    try {
      const res = await createYouTubeChannelIngest({ channel: normalizedCompetitor, video_count: 10 });
      setIngestId(res.ingest_id);
    } catch (e: any) {
      setError(e?.message ?? "YouTube ingest failed");
      setIngesting(false);
    }
  }

  useEffect(() => {
    if (!ingestId) return;
    let alive = true;
    let t: any = null;
    async function tick() {
      try {
        const s = await getYouTubeIngestStatus(ingestId);
        if (!alive) return;
        setIngest(s);
        if (s.benchmark_ready || s.status === "failed") {
          setIngesting(false);
          return;
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to poll ingest");
      }
      t = setTimeout(tick, 2500);
    }
    tick();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [ingestId]);

  return (
    <Card className={`col-span-12 p-4 rounded-xl ${premiumSurfaceClass}`}>
      <div className="text-sm font-semibold">You vs Top Creators</div>
      {props.jobOptions?.length ? (
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-6 gap-2">
          <div className="lg:col-span-2">
            <div className="text-xs text-slate-300 mb-1">Compare this job</div>
            <select
              value={effectiveJobId}
              onChange={(e) => props.onSelectJobId?.(e.target.value)}
              className="w-full text-sm border border-white/15 bg-white/5 rounded-md px-2 py-1 text-white"
            >
              {props.jobOptions.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label} · {j.status}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-4 text-xs text-slate-300 flex items-end">
            {effectiveJobStatus && effectiveJobStatus !== "completed"
              ? "Select a completed job to generate comparison."
              : ""}
          </div>
        </div>
      ) : null}
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
        <Button
          variant="premium"
          onClick={run}
          disabled={!effectiveJobId || busy || (!!effectiveJobStatus && effectiveJobStatus !== "completed")}
        >
          {busy ? "Generating..." : "Generate Comparison Report"}
        </Button>
        {compareMode === "specific_channel" ? (
          <Button
            variant="premium-ghost"
            onClick={buildBenchmark}
            disabled={!normalizedCompetitor || ingesting}
            title="Fetch recent videos from this channel and build a real benchmark"
          >
            {ingestId ? (ingesting ? "Building benchmark..." : "Benchmark status") : "Build real benchmark"}
          </Button>
        ) : null}
        {error ? <div className="text-xs text-red-300">{error}</div> : null}
      </div>

      {compareMode === "specific_channel" && ingest ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-slate-200">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <div>
              <span className="text-slate-400">Channel</span> {ingest.channel_handle}
            </div>
            <div>
              <span className="text-slate-400">Status</span> {ingest.status}
            </div>
            <div>
              <span className="text-slate-400">Videos</span> {ingest.completed_videos}/{ingest.total_videos} completed
              {ingest.processing_videos ? ` · ${ingest.processing_videos} processing` : ""}
              {ingest.failed_videos ? ` · ${ingest.failed_videos} failed` : ""}
            </div>
            <div>
              <span className="text-slate-400">Benchmark</span>{" "}
              {ingest.benchmark_ready ? `ready (n=${ingest.benchmark_sample_size})` : "not ready"}
            </div>
          </div>
          {ingest.message ? <div className="mt-2 text-slate-300">{ingest.message}</div> : null}
        </div>
      ) : null}

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

