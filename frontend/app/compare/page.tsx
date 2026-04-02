"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Card, premiumSurfaceClass } from "@/components/ui";
import { VideoDropzone } from "@/components/VideoDropzone";
import type { AnalysisDetail, AnalysisRow, JobStatus } from "@/lib/api";
import { compareAnalyses, getAnalysisDetail, getJob, listAnalyses, uploadVideoFast } from "@/lib/api";

type CompareMetric = {
  key: string;
  label: string;
  a: number | null;
  b: number | null;
  higherBetter: boolean;
  format: "int" | "float1" | "pct0";
};

function safeNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v: number | null, f: CompareMetric["format"]): string {
  if (v == null) return "—";
  if (f === "pct0") return `${Math.round(v)}%`;
  if (f === "float1") return v.toFixed(1);
  return String(Math.round(v));
}

function fmtDelta(delta: number | null, f: CompareMetric["format"]): string {
  if (delta == null) return "—";
  const sign = delta >= 0 ? "+" : "";
  if (f === "pct0") return `${sign}${Math.round(delta)}%`;
  if (f === "float1") return `${sign}${delta.toFixed(1)}`;
  return `${sign}${Math.round(delta)}`;
}

function coachTextFromReport(report: any): string {
  const r = report?.report ?? report;
  const t =
    (typeof r?.coach_text === "string" && r.coach_text) ||
    (typeof r?.coach === "string" && r.coach) ||
    (typeof r?.summary === "string" && r.summary) ||
    (typeof r?.summary?.coach_text === "string" && r.summary.coach_text) ||
    "";
  if (t) return t;
  // Fallback: keep it human-readable even if backend returns a minimal report.
  return "Comparison generated. Review Strengths and Needs Work below for the most meaningful deltas.";
}

function computeMetrics(source: any, fresh: any): CompareMetric[] {
  const aCards = source?.cards ?? {};
  const bCards = fresh?.cards ?? {};

  const aSummary = source?.summary ?? {};
  const bSummary = fresh?.summary ?? {};

  const aDur = Number(aSummary?.duration_sec ?? 0) || 0;
  const bDur = Number(bSummary?.duration_sec ?? 0) || 0;

  const aExpr = safeNum(aCards?.expressions?.change_count);
  const bExpr = safeNum(bCards?.expressions?.change_count);
  const aExprPerMin = aDur > 0 && aExpr != null ? aExpr / (aDur / 60) : null;
  const bExprPerMin = bDur > 0 && bExpr != null ? bExpr / (bDur / 60) : null;

  const aTonal =
    typeof aCards?.tonal_variation?.score === "number"
      ? safeNum(aCards?.tonal_variation?.score)
      : safeNum(aCards?.tonal_variation?.pitch_hz?.std);
  const bTonal =
    typeof bCards?.tonal_variation?.score === "number"
      ? safeNum(bCards?.tonal_variation?.score)
      : safeNum(bCards?.tonal_variation?.pitch_hz?.std);

  return [
    { key: "overall", label: "Overall Score", a: safeNum(aSummary?.overall_score), b: safeNum(bSummary?.overall_score), higherBetter: true, format: "int" },
    { key: "wpm", label: "Speech (WPM)", a: safeNum(aCards?.speech_rate?.wpm), b: safeNum(bCards?.speech_rate?.wpm), higherBetter: true, format: "int" },
    { key: "eye", label: "Eye Contact", a: safeNum(aCards?.eye_contact?.on_camera_ratio) == null ? null : (safeNum(aCards?.eye_contact?.on_camera_ratio) as number) * 100, b: safeNum(bCards?.eye_contact?.on_camera_ratio) == null ? null : (safeNum(bCards?.eye_contact?.on_camera_ratio) as number) * 100, higherBetter: true, format: "pct0" },
    { key: "fillers", label: "Fillers / min", a: safeNum(aCards?.filler_words?.per_minute), b: safeNum(bCards?.filler_words?.per_minute), higherBetter: false, format: "float1" },
    { key: "gestures", label: "Gestures / min", a: safeNum(aCards?.gestures?.per_minute), b: safeNum(bCards?.gestures?.per_minute), higherBetter: true, format: "float1" },
    { key: "tonal", label: "Tonal", a: aTonal, b: bTonal, higherBetter: true, format: "float1" },
    { key: "expr", label: "Expression / min", a: aExprPerMin, b: bExprPerMin, higherBetter: true, format: "float1" },
    { key: "confidence", label: "Confidence", a: safeNum(source?.confidence_score), b: safeNum(fresh?.confidence_score), higherBetter: true, format: "int" },
    { key: "energy", label: "Energy", a: safeNum(source?.energy_score), b: safeNum(fresh?.energy_score), higherBetter: true, format: "int" },
  ];
}

export default function ComparePage() {
  const [loadingList, setLoadingList] = useState(true);
  const [err, setErr] = useState("");
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);

  // LEFT: Source analysis from library
  const [sourceId, setSourceId] = useState<string>("");
  const [sourceDetail, setSourceDetail] = useState<AnalysisDetail | null>(null);

  // RIGHT: New video upload
  const [files, setFiles] = useState<File[]>([]);
  const [channelName, setChannelName] = useState("");
  const [newJobId, setNewJobId] = useState<string>("");
  const [newStatus, setNewStatus] = useState<JobStatus | "">("");
  const [newStage, setNewStage] = useState<string>("");
  const [newProgress, setNewProgress] = useState<number>(0);
  const [newError, setNewError] = useState<string>("");
  const [newDetail, setNewDetail] = useState<AnalysisDetail | null>(null);

  const [goal, setGoal] = useState<"retention" | "clarity" | "conversion" | "confidence">("retention");
  const [platform, setPlatform] = useState<"youtube_long" | "youtube_shorts">("youtube_long");

  const [busyUpload, setBusyUpload] = useState(false);
  const [busyCompare, setBusyCompare] = useState(false);
  const [compareReport, setCompareReport] = useState<any>(null);

  const completed = useMemo(() => (analyses || []).filter((a) => a.status === "completed"), [analyses]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingList(true);
      setErr("");
      try {
        const data = await listAnalyses(500);
        if (!alive) return;
        const rows = data.analyses || [];
        setAnalyses(rows);
        const firstRow = (rows || []).find((r: any) => r.status === "completed") as any;
        const first = String(firstRow?.job_id || firstRow?.id || "").trim();
        if (first) setSourceId(first);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load analyses");
      } finally {
        if (alive) setLoadingList(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Load source analysis detail when selected.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!sourceId) return;
      try {
        const d = await getAnalysisDetail(sourceId);
        if (!alive) return;
        setSourceDetail(d);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load source analysis");
      }
    })();
    return () => {
      alive = false;
    };
  }, [sourceId]);

  // Poll new job status while analyzing.
  useEffect(() => {
    if (!newJobId) return;
    if (newStatus === "completed" || newStatus === "failed") return;
    let alive = true;
    let t: any = null;
    const tick = async () => {
      try {
        const j = await getJob(newJobId);
        if (!alive) return;
        setNewStatus(j.status);
        setNewStage((j as any).stage || "");
        setNewProgress(Number((j as any).progress || 0));
        if (j.status === "failed") setNewError(j.error_message || "Analysis failed");
        if (j.status === "completed") {
          const d = await getAnalysisDetail(newJobId);
          if (!alive) return;
          setNewDetail(d);
        }
      } catch {
        // ignore transient polling blips
      }
      if (!alive) return;
      t = setTimeout(tick, 3000);
    };
    tick();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [newJobId, newStatus]);

  const sourceResult = sourceDetail?.result_json as any;
  const newResult = newDetail?.result_json as any;

  const metrics = useMemo(() => {
    if (!sourceResult || !newResult) return [];
    const src = {
      ...sourceResult,
      confidence_score: Number((sourceDetail?.analysis as any)?.confidence_score ?? sourceResult?.confidence_score ?? 0),
      energy_score: Number((sourceDetail?.analysis as any)?.energy_score ?? sourceResult?.energy_score ?? 0),
    };
    const fresh = {
      ...newResult,
      confidence_score: Number((newDetail?.analysis as any)?.confidence_score ?? newResult?.confidence_score ?? 0),
      energy_score: Number((newDetail?.analysis as any)?.energy_score ?? newResult?.energy_score ?? 0),
    };
    return computeMetrics(src, fresh);
  }, [sourceResult, newResult, sourceDetail, newDetail]);

  const strengths = useMemo(() => {
    return metrics
      .map((m) => {
        if (m.a == null || m.b == null) return null;
        const delta = m.b - m.a; // new - source
        const improved = m.higherBetter ? delta > 0 : delta < 0;
        return improved ? { metric: m, delta } : null;
      })
      .filter(Boolean)
      .slice(0, 6) as { metric: CompareMetric; delta: number }[];
  }, [metrics]);

  const needsWork = useMemo(() => {
    return metrics
      .map((m) => {
        if (m.a == null || m.b == null) return null;
        const delta = m.b - m.a;
        const worse = m.higherBetter ? delta < 0 : delta > 0;
        return worse ? { metric: m, delta } : null;
      })
      .filter(Boolean)
      .slice(0, 6) as { metric: CompareMetric; delta: number }[];
  }, [metrics]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div>
        <div className="font-semibold tracking-tight text-3xl">Compare</div>
        <div className="text-slate-300 text-sm mt-1">Compare a completed analysis against a fresh upload</div>
      </div>

      {err ? <div className="mt-4 text-red-300 text-sm">{err}</div> : null}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT — Source */}
        <Card className={`p-5 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Source</div>
              <div className="text-xs text-slate-400 mt-1">Pick a completed analysis from your dashboard</div>
            </div>
          </div>

          <div className="mt-4">
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="w-full text-sm border border-white/15 bg-white/5 rounded-xl px-3 py-2.5 text-white"
              disabled={loadingList || busyUpload || busyCompare}
            >
              {completed.map((a) => (
                <option key={String(a.job_id || a.id)} value={String(a.job_id || a.id)}>
                  {String(a.title || a.original_filename || a.job_id || a.id || "").slice(0, 60)} ·{" "}
                  {new Date(a.created_at).toLocaleDateString()} · score {Number((a as any).overall_score ?? 0) || 0}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-slate-400">Selected</div>
            <div className="mt-1 text-sm text-slate-100">
              {(sourceDetail?.analysis as any)?.title ||
                (sourceDetail?.analysis as any)?.original_filename ||
                (sourceDetail?.analysis as any)?.job_id ||
                sourceId ||
                "—"}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Overall score: {String((sourceResult?.summary?.overall_score ?? (sourceDetail?.analysis as any)?.overall_score ?? "—") as any)}
            </div>
          </div>
        </Card>

        {/* RIGHT — New Video */}
        <Card className={`p-5 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">New Video</div>
              <div className="text-xs text-slate-400 mt-1">Upload a fresh video and compare it to the source</div>
            </div>
          </div>

          <div className="mt-4">
            <VideoDropzone files={files} onFilesChange={setFiles} title="Drop a video here or click to browse" subtitle="We’ll analyze it, then compare against your selected source." />
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="Channel name (optional)"
              className="flex-1 bg-white/5 border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
              disabled={busyUpload}
            />
            <Button
              variant="premium"
              disabled={!files.length || busyUpload}
              onClick={async () => {
                if (!files.length) return;
                setBusyUpload(true);
                setErr("");
                setNewError("");
                setNewDetail(null);
                setCompareReport(null);
                try {
                  const resp = await uploadVideoFast(files[0], channelName);
                  setNewJobId(resp.analysis_id);
                  setNewStatus("queued");
                  setNewStage("queued");
                  setNewProgress(0);
                } catch (e: any) {
                  setErr(e?.message ?? "Upload failed");
                } finally {
                  setBusyUpload(false);
                }
              }}
            >
              {busyUpload ? "Uploading…" : "Analyze & Compare"}
            </Button>
          </div>

          {newJobId ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">Job</div>
                <div className="text-xs text-slate-300">{newJobId}</div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span
                  className={clsx(
                    "w-2.5 h-2.5 rounded-full",
                    newStatus === "completed"
                      ? "bg-emerald-400"
                      : newStatus === "failed"
                        ? "bg-red-400"
                        : newStatus === "processing"
                          ? "bg-cyan-400 animate-pulse"
                          : "bg-amber-400"
                  )}
                />
                <span className="text-slate-200">{newStatus || "queued"}</span>
                <span className="text-slate-500 text-xs">{newStage ? `· ${newStage}` : ""}</span>
              </div>

              {(newStatus === "processing" || newStatus === "queued") ? (
                <div className="mt-3 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(3, (newProgress || 0) * 100)}%` }}
                  />
                </div>
              ) : null}

              {newStatus === "failed" && newError ? <div className="mt-3 text-xs text-red-300">{newError.split("\n")[0]}</div> : null}
            </div>
          ) : null}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="text-xs text-slate-400">Goal</div>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value as any)}
            className="mt-2 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          >
            <option value="retention">retention</option>
            <option value="clarity">clarity</option>
            <option value="conversion">conversion</option>
            <option value="confidence">confidence</option>
          </select>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="text-xs text-slate-400">Platform</div>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as any)}
            className="mt-2 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          >
            <option value="youtube_long">youtube_long</option>
            <option value="youtube_shorts">youtube_shorts</option>
          </select>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-end">
          <Button
            variant="premium-ghost"
            disabled={!sourceId || !newJobId}
            onClick={() => {
              // convenience: jump to the fresh video detail
              window.location.href = newJobId ? `/video/${encodeURIComponent(newJobId)}` : "/dashboard";
            }}
          >
            Open new video →
          </Button>
        </div>
      </div>

      {/* RESULTS */}
      {sourceResult && newResult ? (
        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Comparison Results</div>
              <div className="text-xs text-slate-400">New video vs Source (delta = new − source)</div>
            </div>
            <Button
              variant="premium"
              disabled={busyCompare}
              onClick={async () => {
                setBusyCompare(true);
                setErr("");
                try {
                  // Backend may ignore goal/platform; we still send them as requested.
                  const payload: any = { left_analysis_id: sourceId, right_analysis_id: newJobId, goal, platform };
                  const res = await compareAnalyses(payload.left_analysis_id, payload.right_analysis_id);
                  setCompareReport(res);
                } catch (e: any) {
                  setErr(e?.message ?? "Compare failed");
                } finally {
                  setBusyCompare(false);
                }
              }}
            >
              {busyCompare ? "Comparing…" : "Generate AI Coach Summary"}
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {metrics.map((m) => {
              const delta = m.a == null || m.b == null ? null : m.b - m.a; // new - source
              const improved = delta == null ? false : m.higherBetter ? delta > 0 : delta < 0;
              const worse = delta == null ? false : m.higherBetter ? delta < 0 : delta > 0;
              return (
                <div key={m.key} className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur">
                  <div className="text-xs text-slate-400">{m.label}</div>
                  <div className="mt-2 flex items-baseline justify-between gap-3">
                    <div className="text-sm text-slate-300">
                      <span className="text-slate-500">Source</span> {fmt(m.a, m.format)}
                    </div>
                    <div className="text-sm text-slate-300">
                      <span className="text-slate-500">New</span> {fmt(m.b, m.format)}
                    </div>
                    <div
                      className={clsx(
                        "text-sm font-semibold",
                        improved ? "text-emerald-300" : worse ? "text-red-300" : "text-amber-300"
                      )}
                    >
                      {fmtDelta(delta == null ? null : delta, m.format)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
              <div className="text-sm font-semibold">Strengths</div>
              <div className="mt-3 space-y-2 text-sm">
                {strengths.length ? (
                  strengths.map((x) => (
                    <div key={x.metric.key} className="text-emerald-300/90">
                      • {x.metric.label}: {fmtDelta(x.delta, x.metric.format)}
                    </div>
                  ))
                ) : (
                  <div className="text-slate-300 text-sm">No clear improvements detected.</div>
                )}
              </div>
            </Card>

            <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
              <div className="text-sm font-semibold">Needs Work</div>
              <div className="mt-3 space-y-2 text-sm">
                {needsWork.length ? (
                  needsWork.map((x) => (
                    <div key={x.metric.key} className="text-red-300/90">
                      • {x.metric.label}: {fmtDelta(x.delta, x.metric.format)}
                    </div>
                  ))
                ) : (
                  <div className="text-slate-300 text-sm">No regressions detected.</div>
                )}
              </div>
            </Card>
          </div>

          <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
            <div className="text-sm font-semibold">AI Coach Summary</div>
            <div className="mt-2 text-sm text-slate-100 whitespace-pre-wrap">
              {compareReport ? coachTextFromReport(compareReport) : "Click “Generate AI Coach Summary” to produce recommendations."}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

