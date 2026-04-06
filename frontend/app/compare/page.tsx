"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Card, premiumSurfaceClass } from "@/components/ui";
import DarkSelect from "@/components/DarkSelect";
import { VideoDropzone } from "@/components/VideoDropzone";
import type { AnalysisDetail, AnalysisRow, ChannelSummary, JobStatus } from "@/lib/api";
import {
  compareAnalyses,
  fetchChannelsSummary,
  getAnalysisDetail,
  getJobProgressUnified,
  listAnalyses,
  listAnalysesForChannel,
  uploadVideoFast,
} from "@/lib/api";
import { Line, LineChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

async function fetchDetailWithRetry(jobId: string): Promise<AnalysisDetail> {
  await new Promise((r) => setTimeout(r, 2000));
  let detail = await getAnalysisDetail(jobId);
  const rj = detail?.result_json ?? (detail?.analysis as Record<string, unknown> | null)?.result_json;
  if (rj == null) {
    await new Promise((r) => setTimeout(r, 3000));
    detail = await getAnalysisDetail(jobId);
  }
  return detail;
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

function avgWpmFromRows(rows: AnalysisRow[]): number {
  const completed = rows.filter((r) => r.status === "completed");
  const wpms = completed.map((r) => Number(r.wpm)).filter((n) => Number.isFinite(n) && n > 0);
  if (!wpms.length) return 0;
  return Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length);
}

function eyePctFromSummary(ch: ChannelSummary): number {
  const e = Number(ch.avgEyeContact);
  if (!Number.isFinite(e)) return 0;
  return e <= 1 ? Math.round(e * 100) : Math.round(e);
}

function pickWinner(a: number, b: number, higherBetter: boolean): "A" | "B" | "tie" {
  if (a === b) return "tie";
  if (higherBetter) return a > b ? "A" : "B";
  return a < b ? "A" : "B";
}

function mergeConfidencePoints(rowsA: AnalysisRow[], rowsB: AnalysisRow[]) {
  const map = new Map<number, { a?: number; b?: number }>();
  for (const r of rowsA) {
    if (r.status !== "completed" || r.confidence_score == null) continue;
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const cur = map.get(t) ?? {};
    cur.a = Number(r.confidence_score);
    map.set(t, cur);
  }
  for (const r of rowsB) {
    if (r.status !== "completed" || r.confidence_score == null) continue;
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const cur = map.get(t) ?? {};
    cur.b = Number(r.confidence_score);
    map.set(t, cur);
  }
  const keys = [...map.keys()].sort((x, y) => x - y);
  return keys.map((t) => ({
    x: new Date(t).toLocaleDateString(),
    t,
    confA: map.get(t)?.a,
    confB: map.get(t)?.b,
  }));
}

function CompareChannelPane() {
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channelA, setChannelA] = useState("");
  const [channelB, setChannelB] = useState("");
  const [rowsA, setRowsA] = useState<AnalysisRow[]>([]);
  const [rowsB, setRowsB] = useState<AnalysisRow[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);
  const [localErr, setLocalErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLocalErr("");
      try {
        const data = await fetchChannelsSummary();
        if (!alive) return;
        setChannels(data.channels || []);
      } catch (e: unknown) {
        if (!alive) return;
        setLocalErr(e instanceof Error ? e.message : "Failed to load channels");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!channelA || !channelB || channelA === channelB) {
      setRowsA([]);
      setRowsB([]);
      return;
    }
    let alive = true;
    (async () => {
      setLoadingAnalyses(true);
      setLocalErr("");
      try {
        const [a, b] = await Promise.all([
          listAnalysesForChannel(channelA, false),
          listAnalysesForChannel(channelB, false),
        ]);
        if (!alive) return;
        setRowsA(a.analyses || []);
        setRowsB(b.analyses || []);
      } catch (e: unknown) {
        if (!alive) return;
        setLocalErr(e instanceof Error ? e.message : "Failed to load channel analyses");
      } finally {
        if (alive) setLoadingAnalyses(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [channelA, channelB]);

  const channelOptions = useMemo(
    () =>
      channels
        .filter((c) => (c.totalVideos || 0) > 0)
        .map((c) => ({ value: c.name, label: c.name })),
    [channels]
  );

  const sa = useMemo(() => channels.find((c) => c.name === channelA), [channels, channelA]);
  const sb = useMemo(() => channels.find((c) => c.name === channelB), [channels, channelB]);

  const metricsTable = useMemo(() => {
    if (!sa || !sb || channelA === channelB) return null;
    const wpmA = avgWpmFromRows(rowsA);
    const wpmB = avgWpmFromRows(rowsB);
    const confA = Math.round(sa.avgConfidence);
    const confB = Math.round(sb.avgConfidence);
    const enA = Math.round(sa.avgEnergy);
    const enB = Math.round(sb.avgEnergy);
    const eyeA = eyePctFromSummary(sa);
    const eyeB = eyePctFromSummary(sb);
    const tvA = sa.totalVideos;
    const tvB = sb.totalVideos;
    const rows = [
      { key: "conf", label: "Avg Confidence", a: confA, b: confB, higherBetter: true, fmt: "int" as const },
      { key: "en", label: "Avg Energy", a: enA, b: enB, higherBetter: true, fmt: "int" as const },
      { key: "wpm", label: "Avg WPM", a: wpmA, b: wpmB, higherBetter: true, fmt: "int" as const },
      { key: "tv", label: "Total Videos", a: tvA, b: tvB, higherBetter: true, fmt: "int" as const },
      { key: "eye", label: "Eye Contact", a: eyeA, b: eyeB, higherBetter: true, fmt: "pct" as const },
    ];
    return rows.map((r) => ({
      ...r,
      winner: pickWinner(r.a, r.b, r.higherBetter),
    }));
  }, [sa, sb, rowsA, rowsB, channelA, channelB]);

  const overall = useMemo(() => {
    if (!metricsTable) return null;
    let aW = 0;
    let bW = 0;
    for (const m of metricsTable) {
      if (m.winner === "A") aW += 1;
      else if (m.winner === "B") bW += 1;
    }
    if (aW === bW) return { kind: "tie" as const, aW, bW };
    return { kind: aW > bW ? ("A" as const) : ("B" as const), aW, bW };
  }, [metricsTable]);

  const chartData = useMemo(() => mergeConfidencePoints(rowsA, rowsB), [rowsA, rowsB]);

  const nameA = sa?.name ?? "Channel A";
  const nameB = sb?.name ?? "Channel B";

  return (
    <div className="mt-6 space-y-6">
      {localErr ? <div className="text-red-300 text-sm">{localErr}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className={`p-5 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="text-sm font-semibold">Channel A</div>
          <div className="mt-3">
            <DarkSelect
              value={channelA}
              onChange={setChannelA}
              options={channelOptions}
              disabled={loading}
              emptyLabel={loading ? "Loading…" : "No channels with videos"}
              placeholder="Choose channel…"
            />
          </div>
        </Card>
        <Card className={`p-5 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="text-sm font-semibold">Channel B</div>
          <div className="mt-3">
            <DarkSelect
              value={channelB}
              onChange={setChannelB}
              options={channelOptions}
              disabled={loading}
              emptyLabel={loading ? "Loading…" : "No channels with videos"}
              placeholder="Choose channel…"
            />
          </div>
        </Card>
      </div>

      {channelA && channelB && channelA === channelB ? (
        <div className="text-amber-200/90 text-sm">Pick two different channels to compare.</div>
      ) : null}

      {loadingAnalyses && channelA && channelB && channelA !== channelB ? (
        <div className="text-slate-400 text-sm">Loading channel data…</div>
      ) : null}

      {metricsTable && sa && sb ? (
        <>
          <Card className={`p-5 rounded-2xl overflow-x-auto ${premiumSurfaceClass}`}>
            <div className="text-sm font-semibold mb-4">Comparison</div>
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left text-slate-400 border-b border-white/10">
                  <th className="pb-2 pr-3">Metric</th>
                  <th className="pb-2 pr-3">{nameA}</th>
                  <th className="pb-2 pr-3">{nameB}</th>
                  <th className="pb-2">Winner</th>
                </tr>
              </thead>
              <tbody>
                {metricsTable.map((m) => (
                  <tr key={m.key} className="border-b border-white/5">
                    <td className="py-2 pr-3 text-slate-300">{m.label}</td>
                    <td
                      className={clsx(
                        "py-2 pr-3 tabular-nums",
                        m.winner === "A" ? "text-emerald-300 font-medium" : m.winner === "B" ? "text-amber-200/90" : "text-slate-200"
                      )}
                    >
                      {m.fmt === "pct" ? `${m.a}%` : m.a}
                    </td>
                    <td
                      className={clsx(
                        "py-2 pr-3 tabular-nums",
                        m.winner === "B" ? "text-emerald-300 font-medium" : m.winner === "A" ? "text-amber-200/90" : "text-slate-200"
                      )}
                    >
                      {m.fmt === "pct" ? `${m.b}%` : m.b}
                    </td>
                    <td className="py-2 text-slate-200">
                      {m.winner === "tie" ? "—" : m.winner === "A" ? "← A" : "← B"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {overall ? (
            <div
              className={clsx(
                "rounded-2xl border px-4 py-3 text-sm font-medium",
                overall.kind === "tie"
                  ? "border-white/15 bg-white/5 text-slate-200"
                  : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              )}
            >
              {overall.kind === "tie"
                ? `Overall: tied (${overall.aW} metrics each)`
                : `Overall: ${overall.kind === "A" ? nameA : nameB} leads (${overall.kind === "A" ? overall.aW : overall.bW} vs ${overall.kind === "A" ? overall.bW : overall.aW} metrics)`}
            </div>
          ) : null}

          {chartData.length > 0 ? (
            <Card className={`p-5 rounded-2xl ${premiumSurfaceClass}`}>
              <div className="text-sm font-semibold">Confidence over time</div>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <XAxis dataKey="x" stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: "rgba(2,6,23,0.92)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="confA" name={nameA} stroke="#22d3ee" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="confB" name={nameB} stroke="#f472b6" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : (
            <div className="text-slate-500 text-sm">No confidence scores yet to plot trends.</div>
          )}
        </>
      ) : null}
    </div>
  );
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
  const [compareMode, setCompareMode] = useState<"video" | "channel">("video");
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
  const jobPollStartedRef = useRef<number>(0);
  const [, bumpUi] = useState(0);
  useEffect(() => {
    if (!newJobId || (newStatus !== "queued" && newStatus !== "processing")) return;
    const i = setInterval(() => bumpUi((x) => x + 1), 5000);
    return () => clearInterval(i);
  }, [newJobId, newStatus]);

  useEffect(() => {
    if (newStatus !== "completed" || !newJobId) return;
    const rj = newDetail?.result_json ?? (newDetail?.analysis as Record<string, unknown> | null)?.result_json;
    if (rj != null) return;
    const id = setTimeout(() => window.location.reload(), 5000);
    return () => clearTimeout(id);
  }, [newStatus, newJobId, newDetail]);

  const completed = useMemo(() => (analyses || []).filter((a) => a.status === "completed"), [analyses]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingList(true);
      setErr("");
      try {
        const data = await listAnalyses(200);
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

  // Poll new job until completed/failed; on completed, wait and retry detail fetch so result_json is present.
  useEffect(() => {
    if (!newJobId) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const j = await getJobProgressUnified(newJobId);
        if (!alive) return;
        setNewStatus(j.status);
        setNewStage(j.stage || "");
        setNewProgress(Number(j.progress ?? 0));
        if (j.status === "failed") {
          setNewError(j.error_message || "Analysis failed");
          return;
        }
        setNewError("");
        if (j.status === "completed") {
          const d = await fetchDetailWithRetry(newJobId);
          if (!alive) return;
          setNewDetail(d);
          return;
        }
      } catch {
        try {
          const d = await getAnalysisDetail(newJobId);
          if (!alive) return;
          const st = String((d.job as any)?.status ?? (d.analysis as any)?.status ?? "");
          if (st === "completed" || st === "processing" || st === "queued" || st === "failed") {
            setNewStatus(st as JobStatus);
            setNewStage(String((d.job as any)?.stage ?? ""));
            setNewProgress(Number((d.job as any)?.progress ?? 0));
            if (st === "completed") {
              const d2 = await fetchDetailWithRetry(newJobId);
              if (!alive) return;
              setNewDetail(d2);
              return;
            }
            if (st === "failed") setNewError(String((d.job as any)?.error_message || "Analysis failed"));
          }
        } catch {
          // ignore
        }
      }
      if (!alive) return;
      const elapsed = Date.now() - (jobPollStartedRef.current || Date.now());
      const delay = elapsed < 120_000 ? 1500 : 3000;
      t = setTimeout(tick, delay);
    };
    tick();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [newJobId]);

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

  const sourceOptions = useMemo(() => {
    return completed.map((a) => {
      const top = Number((a as any).overall_score ?? 0) || 0;
      const fb = Number((a as any)?.result_json?.summary?.overall_score ?? 0) || 0;
      const s = top > 0 ? top : fb;
      const scorePart = s > 0 ? ` · score ${s}` : "";
      const base = String(a.title || a.original_filename || a.job_id || a.id || "").slice(0, 60);
      return {
        value: String(a.job_id || a.id),
        label: `${base} · ${new Date(a.created_at).toLocaleDateString()}${scorePart}`,
      };
    });
  }, [completed]);

  const goalOptions = useMemo(
    () =>
      (["retention", "clarity", "conversion", "confidence"] as const).map((v) => ({
        value: v,
        label: v,
      })),
    []
  );

  const platformOptions = useMemo(
    () =>
      (["youtube_long", "youtube_shorts"] as const).map((v) => ({
        value: v,
        label: v,
      })),
    []
  );

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div>
        <div className="font-semibold tracking-tight text-3xl">Compare</div>
        <div className="text-slate-300 text-sm mt-1">
          {compareMode === "video"
            ? "Compare a completed analysis against a fresh upload"
            : "Compare aggregate performance between two channels"}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCompareMode("video")}
          className={clsx(
            "px-4 py-2 rounded-xl text-sm border transition-all",
            compareMode === "video"
              ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
              : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
          )}
        >
          Video vs Video
        </button>
        <button
          type="button"
          onClick={() => setCompareMode("channel")}
          className={clsx(
            "px-4 py-2 rounded-xl text-sm border transition-all",
            compareMode === "channel"
              ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
              : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
          )}
        >
          Channel vs Channel
        </button>
      </div>

      {compareMode === "channel" ? (
        <CompareChannelPane />
      ) : (
        <>
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
            <DarkSelect
              value={sourceId}
              onChange={setSourceId}
              options={sourceOptions}
              disabled={loadingList || busyUpload || busyCompare}
              emptyLabel="No completed analyses yet"
              placeholder="Choose a video…"
            />
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
                  jobPollStartedRef.current = Date.now();
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

              {newStatus === "queued" &&
              jobPollStartedRef.current &&
              Date.now() - jobPollStartedRef.current > 120_000 ? (
                <div className="mt-3 text-xs text-amber-200/90 leading-relaxed">
                  Still queued after 2+ minutes? On Railway, set{" "}
                  <code className="text-slate-300">USE_RQ_QUEUE=false</code> unless you run a separate worker (
                  <code className="text-slate-300">python -m app.worker</code>). Open{" "}
                  <code className="text-slate-300">GET /health</code> — <code className="text-slate-300">worker_mode</code> should be{" "}
                  <code className="text-slate-300">inline</code>.
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="text-xs text-slate-400">Goal</div>
          <DarkSelect
            className="mt-2"
            value={goal}
            onChange={(v) => setGoal(v as "retention" | "clarity" | "conversion" | "confidence")}
            options={goalOptions}
          />
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="text-xs text-slate-400">Platform</div>
          <DarkSelect
            className="mt-2"
            value={platform}
            onChange={(v) => setPlatform(v as "youtube_long" | "youtube_shorts")}
            options={platformOptions}
          />
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
      ) : sourceId && newJobId && !(sourceResult && newResult) ? (
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 px-6 py-8 text-center text-slate-400 text-sm">
          {newStatus === "completed"
            ? "Results are processing, refreshing in a moment..."
            : "Waiting for analysis to complete..."}
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}

