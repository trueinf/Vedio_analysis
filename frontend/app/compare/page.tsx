"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Button, Card, premiumSurfaceClass } from "@/components/ui";
import DarkSelect from "@/components/DarkSelect";
import { VideoDropzone } from "@/components/VideoDropzone";
import type { AnalysisDetail, AnalysisRow, ChannelSummary, JobStatus } from "@/lib/api";
import {
  compareAnalyses,
  createJobFromBrowserUpload,
  fetchChannelReport,
  fetchChannelsSummary,
  getPresignedUploadUrl,
  getAnalysisDetail,
  getJobProgressUnified,
  listAnalyses,
  listAnalysesForChannel,
  uploadPutBlobWithProgress,
  uploadVideoFast,
} from "@/lib/api";
import { Bar, BarChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

type CompareMode = "video" | "channel" | "cvv";

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const s = parts[0] || "?";
  return s.slice(0, 2).toUpperCase();
}

function pickExistingFilename(a: AnalysisRow): string {
  return String(a.title || a.original_filename || a.job_id || a.id || "—");
}

type VideoResult = {
  analysisId: string;
  filename: string;
  createdAt: string;
  confidence: number | null;
  energy: number | null;
  wpm: number | null;
  eyePct: number | null;
  fillersPerMin: number | null;
  gesturesPerMin: number | null;
  tonalScore: number | null;
  coachComments: string[];
  resultJson: any | null;
};

function safeAvg(nums: Array<number | null | undefined>): number | null {
  const ok = nums
    .map((n) => (n == null ? null : Number(n)))
    .filter((n): n is number => n != null && Number.isFinite(n));
  if (!ok.length) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

function computeVideoResult(detail: AnalysisDetail | null): VideoResult | null {
  if (!detail) return null;
  const analysis: any = detail.analysis ?? {};
  const job: any = detail.job ?? {};
  const rj: any = detail.result_json ?? analysis?.result_json ?? null;
  const cards = rj?.cards ?? {};
  const filename = String(analysis?.original_filename || analysis?.title || job?.original_filename || analysis?.job_id || analysis?.id || "—");
  const analysisId = String(analysis?.job_id || analysis?.id || job?.id || "");
  const createdAt = String(analysis?.created_at || "");
  const confidence = safeNum(analysis?.confidence_score ?? rj?.confidence_score);
  const energy = safeNum(analysis?.energy_score ?? rj?.energy_score);
  const wpm = safeNum(cards?.speech_rate?.wpm ?? analysis?.wpm);
  const eyeRatio = safeNum(cards?.eye_contact?.on_camera_ratio ?? analysis?.eye_contact_ratio);
  const eyePct = eyeRatio == null ? null : Math.round(eyeRatio * 100);
  const fillersPerMin = safeNum(cards?.filler_words?.per_minute ?? analysis?.fillers_per_min);
  const gesturesPerMin = safeNum(cards?.gestures?.per_minute ?? analysis?.gestures_per_min);
  const tonalScore =
    typeof cards?.tonal_variation?.score === "number"
      ? safeNum(cards?.tonal_variation?.score)
      : safeNum(cards?.tonal_variation?.pitch_hz?.std);
  const coachComments = Array.isArray(rj?.coach_comments)
    ? (rj.coach_comments as any[])
        .map((c) => String(c?.comment || "").trim())
        .filter(Boolean)
    : [];
  return {
    analysisId,
    filename,
    createdAt,
    confidence: confidence == null ? null : Math.round(confidence),
    energy: energy == null ? null : Math.round(energy),
    wpm: wpm == null ? null : Math.round(wpm),
    eyePct: eyePct == null ? null : Math.round(eyePct),
    fillersPerMin: fillersPerMin == null ? null : Number(fillersPerMin.toFixed(1)),
    gesturesPerMin: gesturesPerMin == null ? null : Number(gesturesPerMin.toFixed(1)),
    tonalScore: tonalScore == null ? null : Number(tonalScore.toFixed(1)),
    coachComments,
    resultJson: rj,
  };
}

function winnerBadge(w: "video" | "channel" | "tie") {
  if (w === "video") return "bg-emerald-400/15 text-emerald-200 border-emerald-400/30";
  if (w === "channel") return "bg-indigo-400/15 text-indigo-200 border-indigo-400/30";
  return "bg-white/5 text-slate-300 border-white/10";
}

function deltaTone(w: "video" | "channel" | "tie") {
  if (w === "video") return "text-emerald-300";
  if (w === "channel") return "text-amber-200";
  return "text-slate-300";
}

type CvvMetricKey = "confidence" | "energy" | "wpm" | "eye" | "fillers" | "gestures" | "tonal";
type CvvMetric = {
  key: CvvMetricKey;
  name: string;
  subtitle: string;
  video: number | null;
  channel: number | null;
  format: "int" | "float1" | "pct0";
  kind: "higher" | "lower" | "wpm_opt";
};

function computeWinner(metric: CvvMetric): "video" | "channel" | "tie" {
  const v = metric.video;
  const c = metric.channel;
  if (v == null || c == null) return "tie";
  if (metric.kind === "lower") {
    if (v < c - 0.1) return "video";
    if (c < v - 0.1) return "channel";
    return "tie";
  }
  if (metric.kind === "wpm_opt") {
    const opt = 130;
    const dv = Math.abs(v - opt);
    const dc = Math.abs(c - opt);
    // Spec: no tie case — closer wins, otherwise channel.
    return dv < dc ? "video" : "channel";
  }
  if (v > c + 2) return "video";
  if (c > v + 2) return "channel";
  return "tie";
}

function fmtVal(v: number | null, f: CvvMetric["format"]): string {
  if (v == null) return "No data";
  if (f === "pct0") return `${Math.round(v)}%`;
  if (f === "float1") return v.toFixed(1);
  return String(Math.round(v));
}

function CompareChannelVsVideoPane() {
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [channelList, setChannelList] = useState<ChannelSummary[]>([]);
  const [channelId, setChannelId] = useState<string>("");
  const [channelSummary, setChannelSummary] = useState<ChannelSummary | null>(null);
  const [channelReport, setChannelReport] = useState<any>(null);
  const [err, setErr] = useState("");

  const [videoSubMode, setVideoSubMode] = useState<"upload" | "pick">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobStatus, setJobStatus] = useState<string>("idle");
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);

  const [completedOptions, setCompletedOptions] = useState<{ value: string; label: string }[]>([]);
  const [pickedAnalysisId, setPickedAnalysisId] = useState<string>("");
  const [videoDetail, setVideoDetail] = useState<AnalysisDetail | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingChannels(true);
      setErr("");
      try {
        const data = await fetchChannelsSummary();
        if (!alive) return;
        const rows = (data.channels || []).filter((c) => (c.totalVideos || 0) > 0);
        setChannelList(rows);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load channels");
        setChannelList([]);
      } finally {
        if (alive) setLoadingChannels(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const ch = channelList.find((c) => c.id === channelId) ?? null;
    setChannelSummary(ch);
  }, [channelList, channelId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!channelSummary?.name) {
        setChannelReport(null);
        return;
      }
      try {
        const rep = await fetchChannelReport(channelSummary.name);
        if (!alive) return;
        setChannelReport(rep);
      } catch {
        if (!alive) return;
        setChannelReport(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [channelSummary?.name]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await listAnalyses(200);
        if (!alive) return;
        const completed = (data.analyses || []).filter((a) => a.status === "completed");
        completed.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setCompletedOptions(
          completed.slice(0, 50).map((a) => {
            const fn = pickExistingFilename(a).slice(0, 58);
            const ch = String(a.channel_name || "—").trim();
            const d = new Date(a.created_at).toLocaleDateString();
            return { value: String(a.job_id || a.id), label: `${fn} · ${ch} · ${d}` };
          })
        );
      } catch {
        setCompletedOptions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!uploadJobId) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const j = await getJobProgressUnified(uploadJobId);
        if (!alive) return;
        setJobStatus(j.status);
        if (j.status === "completed") {
          const d = await getAnalysisDetail(uploadJobId);
          if (!alive) return;
          setVideoDetail(d);
          clearInterval(t);
        }
        if (j.status === "failed") clearInterval(t);
      } catch {
        // ignore
      }
    }, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [uploadJobId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pickedAnalysisId) return;
      setErr("");
      try {
        const d = await getAnalysisDetail(pickedAnalysisId);
        if (!alive) return;
        setVideoDetail(d);
        setUploadJobId(null);
        setJobStatus("completed");
        setUploadProgress(0);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load analysis");
      }
    })();
    return () => {
      alive = false;
    };
  }, [pickedAnalysisId]);

  const videoData = useMemo(() => computeVideoResult(videoDetail), [videoDetail]);

  const channelStats = useMemo(() => {
    const ch = channelSummary;
    const rep = channelReport;
    if (!ch || !rep) return null;
    const eyePct = (() => {
      const e = Number(ch.avgEyeContact);
      if (!Number.isFinite(e)) return null;
      return e <= 1 ? Math.round(e * 100) : Math.round(e);
    })();
    const fillersAvg = safeAvg((rep.individual_videos || []).map((v: any) => v?.metrics?.filler_rate));
    const gesturesAvg = safeAvg((rep.individual_videos || []).map((v: any) => v?.metrics?.gesture_rate));
    const tonalAvg = safeAvg((rep.individual_videos || []).map((v: any) => v?.metrics?.tonal_variation));
    return {
      name: ch.name,
      totalVideos: Number(ch.totalVideos || 0),
      completedCount: Number(ch.completedCount || 0),
      avgConfidence: Math.round(Number(ch.avgConfidence ?? 0) || 0),
      avgEnergy: Math.round(Number(ch.avgEnergy ?? 0) || 0),
      avgWpm: Math.round(Number(rep.avg_wpm ?? 0) || 0) || null,
      avgEyePct: eyePct,
      avgFillers: fillersAvg == null ? null : Number(fillersAvg.toFixed(1)),
      avgGestures: gesturesAvg == null ? null : Number(gesturesAvg.toFixed(1)),
      avgTonal: tonalAvg == null ? null : Number(tonalAvg.toFixed(1)),
      recentAvgConfidence: ch.recentAvgConfidence == null ? null : Number(ch.recentAvgConfidence),
      previousAvgConfidence: ch.previousAvgConfidence == null ? null : Number(ch.previousAvgConfidence),
      topCoach: (rep.top_coach_patterns || []) as { comment: string; count: number }[],
      confidenceSeries: (rep.individual_videos || [])
        .filter((v: any) => v?.confidence_score != null && v?.created_at)
        .slice()
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((v: any) => ({
          x: new Date(String(v.created_at)).toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
          confidence: Number(v.confidence_score),
        })),
      confidenceRankList: (rep.individual_videos || [])
        .filter((v: any) => v?.confidence_score != null)
        .map((v: any) => Number(v.confidence_score)),
    };
  }, [channelSummary, channelReport]);

  const metrics = useMemo((): CvvMetric[] => {
    if (!channelStats || !videoData) return [];
    return [
      { key: "confidence", name: "Confidence", subtitle: "Higher is better", video: videoData.confidence, channel: channelStats.avgConfidence, format: "int", kind: "higher" },
      { key: "energy", name: "Energy", subtitle: "Higher is better", video: videoData.energy, channel: channelStats.avgEnergy, format: "int", kind: "higher" },
      { key: "wpm", name: "Speech rate (WPM)", subtitle: "Closest to 130 wins", video: videoData.wpm, channel: channelStats.avgWpm, format: "int", kind: "wpm_opt" },
      { key: "eye", name: "Eye contact", subtitle: "Higher is better", video: videoData.eyePct, channel: channelStats.avgEyePct, format: "pct0", kind: "higher" },
      { key: "fillers", name: "Filler words", subtitle: "Lower is better", video: videoData.fillersPerMin, channel: channelStats.avgFillers, format: "float1", kind: "lower" },
      { key: "gestures", name: "Gestures", subtitle: "Higher is better (up to ~20/min)", video: videoData.gesturesPerMin, channel: channelStats.avgGestures, format: "float1", kind: "higher" },
      { key: "tonal", name: "Tonal variation", subtitle: "Higher is better", video: videoData.tonalScore, channel: channelStats.avgTonal, format: "float1", kind: "higher" },
    ];
  }, [channelStats, videoData]);

  const wins = useMemo(() => metrics.filter((m) => computeWinner(m) === "video").length, [metrics]);

  const verdict = useMemo(() => {
    if (!channelStats) return null;
    const label = wins >= 5 ? "Above channel average" : wins >= 3 ? "On par with channel" : "Below channel average";
    const tone = wins >= 5 ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : wins >= 3 ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-200";
    const trendNote = (() => {
      const ra = channelStats.recentAvgConfidence;
      const pa = channelStats.previousAvgConfidence;
      if (ra == null || pa == null) return "";
      const d = Math.round(ra - pa);
      if (d > 3) return `Channel trend: ${channelStats.name}'s confidence is improving (+${d} pts over last 5 videos) — the benchmark is rising`;
      if (d < -3) return `Channel trend: ${channelStats.name}'s confidence is declining (${d} pts) — benchmark is falling`;
      return "";
    })();
    return { label, tone, trendNote };
  }, [channelStats, wins]);

  const strongestAdvantage = useMemo(() => {
    if (!channelStats || !videoData) return null;
    const scored = metrics
      .map((m) => {
        if (m.video == null || m.channel == null) return null;
        let d = 0;
        if (m.kind === "lower") d = m.channel - m.video;
        else if (m.kind === "wpm_opt") d = Math.abs(m.channel - 130) - Math.abs(m.video - 130);
        else d = m.video - m.channel;
        return { metric: m, delta: d };
      })
      .filter(Boolean) as { metric: CvvMetric; delta: number }[];
    scored.sort((a, b) => b.delta - a.delta);
    const top = scored[0];
    if (!top || top.delta <= 0) return null;
    const d =
      top.metric.format === "pct0"
        ? `${Math.round(top.delta)}%`
        : top.metric.format === "float1"
          ? `${top.delta.toFixed(1)}`
          : `${Math.round(top.delta)}`;
    return { name: top.metric.name, deltaText: d };
  }, [channelStats, videoData, metrics]);

  const confidenceRank = useMemo(() => {
    if (!channelStats || !videoData?.confidence) return null;
    const scores = (channelStats.confidenceRankList || [])
      .slice()
      .filter((n: number) => Number.isFinite(n))
      .sort((a: number, b: number) => b - a);
    if (!scores.length) return null;
    const v = Number(videoData.confidence);
    let rank = scores.length;
    for (let i = 0; i < scores.length; i++) {
      if (v >= scores[i]) { rank = i + 1; break; }
    }
    const total = scores.length;
    const percentile = Math.round((1 - (rank - 1) / total) * 100);
    return { rank, total, percentile };
  }, [channelStats, videoData?.confidence]);

  const visualMetrics = useMemo(() => {
    // Spec: 6 metrics mini-bars grid (exclude confidence; it's already charted).
    const byKey = new Map(metrics.map((m) => [m.key, m]));
    const keys: CvvMetricKey[] = ["energy", "wpm", "eye", "fillers", "gestures", "tonal"];
    return keys.map((k) => byKey.get(k)).filter(Boolean) as CvvMetric[];
  }, [metrics]);

  const strengthsAndGaps = useMemo(() => {
    if (!channelStats || !videoData) return { strengths: [] as string[], gaps: [] as string[], ties: [] as string[] };
    const strengths: string[] = [];
    const gaps: string[] = [];
    const ties: string[] = [];
    for (const m of metrics) {
      const w = computeWinner(m);
      const v = m.video;
      const c = m.channel;
      if (v == null || c == null) continue;

      const deltaRaw = m.kind === "lower" ? c - v : v - c;
      const deltaText =
        m.format === "pct0"
          ? `${Math.round(Math.abs(deltaRaw))}%`
          : m.format === "float1"
            ? `${Math.abs(deltaRaw).toFixed(1)}`
            : `${Math.round(Math.abs(deltaRaw))}`;

      if (w === "video") {
        if (m.key === "eye") strengths.push(`Eye contact ${deltaText} better than channel avg`);
        else if (m.key === "fillers") strengths.push(`Fewer filler words (${fmtVal(v, m.format)} vs ${fmtVal(c, m.format)}/min)`);
        else if (m.key === "tonal") strengths.push(`Higher tonal variation — more expressive`);
        else strengths.push(`${m.name} ${deltaText} better than channel avg`);
      } else if (w === "channel") {
        if (m.key === "fillers") gaps.push(`More filler words (${fmtVal(v, m.format)} vs ${fmtVal(c, m.format)}/min)`);
        else if (m.key === "wpm") gaps.push(`Speech rate further from optimal 130 WPM than channel avg`);
        else gaps.push(`${m.name} behind channel avg by ${deltaText}`);
      } else {
        ties.push(`${m.name} is on par with channel avg`);
      }
    }
    return { strengths, gaps, ties };
  }, [channelStats, videoData, metrics]);

  const coachPanels = useMemo(() => {
    if (!channelStats || !videoData) return null;
    const videoCounts = new Map<string, number>();
    for (const c of videoData.coachComments) videoCounts.set(c, (videoCounts.get(c) || 0) + 1);
    const videoTags = [...videoCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    const channelTags = (channelStats.topCoach || []).slice(0, 12);
    const videoSet = new Set(videoTags.map(([t]) => t.toLowerCase()));
    const missing = channelTags.find((p) => !videoSet.has(String(p.comment || "").toLowerCase()));
    const rareInChannel = videoTags.find(([t]) => !channelTags.some((p) => String(p.comment || "").toLowerCase() === t.toLowerCase()));
    const insight = missing
      ? `This video shows fewer “${missing.comment}” notes than the channel average — a key improvement area`
      : rareInChannel
        ? `Watch out: “${rareInChannel[0]}” appears in this video but is rare across the channel`
        : "This video’s coach notes closely match the channel’s recurring patterns";
    return { videoTags, channelTags, insight };
  }, [channelStats, videoData]);

  const channelOptions = useMemo(
    () => channelList.filter((c) => (c.totalVideos || 0) > 0).map((c) => ({ value: c.id, label: `${c.name} (${c.totalVideos} videos)` })),
    [channelList]
  );

  const showResults = Boolean(channelStats && videoData);

  return (
    <div className="mt-6 space-y-6">
      {err ? <div className="text-red-300 text-sm">{err}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className={`p-5 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Channel (reference)</div>
          <div className="mt-3">
            <DarkSelect value={channelId} onChange={setChannelId} options={channelOptions} disabled={loadingChannels} emptyLabel={loadingChannels ? "Loading…" : "No channels with videos"} placeholder="Choose channel…" />
          </div>
          {channelStats ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white border border-white/15 shrink-0" style={{ backgroundColor: `hsl(${hashHue(channelStats.name)} 45% 42%)` }}>
                  {initials(channelStats.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{channelStats.name}</div>
                  <div className="text-xs text-slate-400">{channelStats.totalVideos} videos · avg over all time</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded-full text-[11px] border border-emerald-400/25 bg-emerald-400/10 text-emerald-200">Conf {channelStats.avgConfidence}</span>
                <span className="px-2 py-1 rounded-full text-[11px] border border-emerald-400/25 bg-emerald-400/10 text-emerald-200">Energy {channelStats.avgEnergy}</span>
                <span className="px-2 py-1 rounded-full text-[11px] border border-white/10 bg-white/5 text-slate-200">WPM {channelStats.avgWpm ?? "—"}</span>
                <span className="px-2 py-1 rounded-full text-[11px] border border-emerald-400/25 bg-emerald-400/10 text-emerald-200">Eye {channelStats.avgEyePct ?? "—"}%</span>
                <span className="px-2 py-1 rounded-full text-[11px] border border-white/10 bg-white/5 text-slate-200">Fillers {channelStats.avgFillers ?? "—"}/min</span>
              </div>
            </div>
          ) : null}
        </Card>

        <Card className={`p-5 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Video (being tested)</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setVideoSubMode("upload"); setPickedAnalysisId(""); setVideoDetail(null); setUploadJobId(null); setJobStatus("idle"); setUploadProgress(0); setErr(""); }} className={clsx("px-3 py-1.5 rounded-xl text-xs border transition-all", videoSubMode === "upload" ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10")}>
              Upload new video
            </button>
            <button type="button" onClick={() => { setVideoSubMode("pick"); setFile(null); setVideoDetail(null); setUploadJobId(null); setJobStatus("idle"); setUploadProgress(0); setErr(""); }} className={clsx("px-3 py-1.5 rounded-xl text-xs border transition-all", videoSubMode === "pick" ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10")}>
              Pick existing video
            </button>
          </div>

          {videoSubMode === "upload" ? (
            <div className="mt-4 space-y-3">
              <VideoDropzone
                files={file ? [file] : []}
                onFilesChange={(fs) => {
                  if (fs.length > 1) { setErr("Please select only 1 video file."); return; }
                  const f = fs[0] ?? null;
                  if (f && !/\.(mp4|mov|avi|webm)$/i.test(f.name)) { setErr("Only mp4, mov, avi, webm are supported."); return; }
                  setErr("");
                  setFile(f);
                }}
                title="Drop a video here or click to browse"
                subtitle="We’ll upload to Storage and analyze it."
              />
              <Button
                variant="premium"
                disabled={!file || jobStatus === "uploading" || jobStatus === "processing" || jobStatus === "queued"}
                onClick={async () => {
                  if (!file) return;
                  setErr("");
                  setVideoDetail(null);
                  setPickedAnalysisId("");
                  setUploadJobId(null);
                  setJobStatus("uploading");
                  setUploadProgress(0);
                  try {
                    const meta = await getPresignedUploadUrl(file.name);
                    await uploadPutBlobWithProgress(meta.upload_url, file, (pct) => setUploadProgress(pct));
                    setJobStatus("queued");
                    const job = await createJobFromBrowserUpload(meta.storage_path, file.name, { channel_id: undefined, channel_name: "" });
                    setUploadJobId(job.job_id);
                    setJobStatus(job.status);
                  } catch (e: any) {
                    setJobStatus("idle");
                    setErr(e?.message ?? "Upload failed");
                  }
                }}
              >
                {jobStatus === "uploading" ? `Uploading… ${uploadProgress}%` : "Analyze video"}
              </Button>

              {jobStatus !== "idle" ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                  {jobStatus === "uploading"
                    ? `Uploading… ${uploadProgress}%`
                    : jobStatus === "queued"
                      ? "Queued for analysis"
                      : jobStatus === "processing"
                        ? "Analysing video…"
                        : jobStatus === "completed"
                          ? "Analysis complete ✓"
                          : jobStatus === "failed"
                            ? "Analysis failed"
                            : String(jobStatus)}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4">
              <DarkSelect value={pickedAnalysisId} onChange={setPickedAnalysisId} options={completedOptions} disabled={false} emptyLabel="No completed analyses" placeholder="Choose a video…" />
            </div>
          )}

          {videoData ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-semibold truncate">{videoData.filename}</div>
              <div className="text-xs text-slate-400 mt-1">Uploaded today · Analysis complete</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded-full text-[11px] border border-emerald-400/25 bg-emerald-400/10 text-emerald-200">Conf {videoData.confidence ?? "—"}</span>
                <span className="px-2 py-1 rounded-full text-[11px] border border-emerald-400/25 bg-emerald-400/10 text-emerald-200">Energy {videoData.energy ?? "—"}</span>
                <span className="px-2 py-1 rounded-full text-[11px] border border-white/10 bg-white/5 text-slate-200">WPM {videoData.wpm ?? "—"}</span>
                <span className="px-2 py-1 rounded-full text-[11px] border border-emerald-400/25 bg-emerald-400/10 text-emerald-200">Eye {videoData.eyePct ?? "—"}%</span>
                <span className="px-2 py-1 rounded-full text-[11px] border border-white/10 bg-white/5 text-slate-200">Fillers {videoData.fillersPerMin ?? "—"}/min</span>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      {!showResults ? (
        <div className="text-slate-500 text-sm">Select a channel and complete a video analysis to see comparison results.</div>
      ) : null}

      {showResults && channelStats && videoData ? (
        <>
          {verdict ? (
            <div className={clsx("rounded-2xl border px-5 py-4", verdict.tone)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">{verdict.label}</div>
                <div className="text-sm text-slate-200">
                  This video outperforms {channelStats.name}&apos;s channel average in <span className="font-semibold">{wins}</span> of 7 metrics
                </div>
              </div>
              {strongestAdvantage ? (
                <div className="mt-2 text-xs text-slate-300">
                  Strongest advantage in {strongestAdvantage.name} ({strongestAdvantage.deltaText})
                </div>
              ) : null}
              {verdict.trendNote ? (
                <div className="mt-3 inline-flex rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-200">
                  {verdict.trendNote}
                </div>
              ) : null}
            </div>
          ) : null}

          <Card className={`p-5 rounded-2xl overflow-x-auto ${premiumSurfaceClass}`}>
            <div className="text-sm font-semibold mb-4">Metric table</div>
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-slate-400 border-b border-white/10">
                  <th className="pb-2 pr-3">Metric</th>
                  <th className="pb-2 pr-3">Video value</th>
                  <th className="pb-2 pr-3">
                    Channel avg <span className="text-slate-500">(avg {channelStats.completedCount} videos)</span>
                  </th>
                  <th className="pb-2 pr-3">Difference</th>
                  <th className="pb-2">Winner</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const w = computeWinner(m);
                  const delta =
                    m.video == null || m.channel == null
                      ? null
                      : m.kind === "lower"
                        ? m.channel - m.video
                        : m.kind === "wpm_opt"
                          ? Math.abs(m.channel - 130) - Math.abs(m.video - 130)
                          : m.video - m.channel;
                  const deltaStr =
                    delta == null
                      ? "—"
                      : m.format === "pct0"
                        ? `${delta >= 0 ? "+" : ""}${Math.round(delta)}%`
                        : m.format === "float1"
                          ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`
                          : `${delta >= 0 ? "+" : ""}${Math.round(delta)}`;
                  return (
                    <tr key={m.key} className="border-b border-white/5">
                      <td className="py-3 pr-3">
                        <div className="text-slate-200">{m.name}</div>
                        <div className="text-xs text-slate-500">{m.subtitle}</div>
                      </td>
                      <td className="py-3 pr-3 tabular-nums text-slate-100">{fmtVal(m.video, m.format)}</td>
                      <td className="py-3 pr-3 tabular-nums text-slate-100">{fmtVal(m.channel, m.format)}</td>
                      <td className={clsx("py-3 pr-3 tabular-nums font-semibold", deltaTone(w))}>{deltaStr}</td>
                      <td className="py-3">
                        <span className={clsx("inline-flex items-center px-2 py-1 rounded-full text-xs border", winnerBadge(w))}>
                          {w === "video" ? "Video" : w === "channel" ? "Channel" : "Tie"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Visual bars grid (6 metrics) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {visualMetrics.map((m) => {
              const w = computeWinner(m);
              const v = m.video;
              const c = m.channel;
              const maxVal = Math.max(Number(v ?? 0), Number(c ?? 0), 1);

              // Spec: bar heights normalized within metric; for "lower is better" (fillers),
              // invert heights so lower value appears higher.
              const scoreV = m.kind === "lower" ? (v == null ? 0 : Math.max(0, maxVal - v)) : v == null ? 0 : Math.max(0, v);
              const scoreC = m.kind === "lower" ? (c == null ? 0 : Math.max(0, maxVal - c)) : c == null ? 0 : Math.max(0, c);
              const maxScore = Math.max(scoreV, scoreC, 1);
              const vH = v == null ? 0 : Math.round((scoreV / maxScore) * 100);
              const cH = c == null ? 0 : Math.round((scoreC / maxScore) * 100);
              const vColor =
                w === "video" ? "bg-emerald-400" : w === "channel" ? "bg-amber-400" : "bg-slate-500";
              return (
                <Card key={m.key} className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
                  <div className="text-sm font-semibold">{m.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{m.subtitle}</div>
                  <div className="mt-4 grid grid-cols-2 gap-4 items-end h-28">
                    <div className="flex flex-col items-center justify-end gap-2">
                      <div className="w-8 h-24 rounded-lg bg-white/5 border border-white/10 flex items-end overflow-hidden">
                        <div className={clsx("w-full rounded-lg", vColor)} style={{ height: `${Math.max(4, vH)}%` }} />
                      </div>
                      <div className="text-xs text-slate-300">This video</div>
                      <div className="text-xs text-slate-100 tabular-nums">{fmtVal(v, m.format)}</div>
                    </div>
                    <div className="flex flex-col items-center justify-end gap-2">
                      <div className="w-8 h-24 rounded-lg bg-white/5 border border-white/10 flex items-end overflow-hidden">
                        <div className="w-full rounded-lg bg-indigo-400" style={{ height: `${Math.max(4, cH)}%` }} />
                      </div>
                      <div className="text-xs text-slate-300">{channelStats.name} avg</div>
                      <div className="text-xs text-slate-100 tabular-nums">{fmtVal(c, m.format)}</div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-emerald-400" />
              This video
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-indigo-400" />
              {channelStats.name} avg
            </div>
          </div>

          <Card className={`p-5 rounded-2xl ${premiumSurfaceClass}`}>
            <div className="text-sm font-semibold">Confidence over time</div>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={channelStats.confidenceSeries}>
                  <XAxis dataKey="x" stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "rgba(2,6,23,0.92)", border: "1px solid rgba(255,255,255,0.1)" }} />
                  <Bar dataKey="confidence" fill="rgba(99,102,241,0.75)" radius={[6, 6, 0, 0]} />
                  {typeof videoData.confidence === "number" ? (
                    <ReferenceLine y={videoData.confidence} stroke="rgba(16,185,129,0.9)" strokeDasharray="5 4" />
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {confidenceRank ? (
              <div className="mt-3 text-sm text-slate-300">
                This video would rank <span className="font-semibold">#{confidenceRank.rank}</span> of{" "}
                <span className="font-semibold">{confidenceRank.total}</span> in the channel
              </div>
            ) : null}
          </Card>

          {/* Strengths and gaps */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className={`p-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 ${premiumSurfaceClass}`}>
              <div className="text-sm font-semibold text-emerald-200">Video strengths vs channel</div>
              <div className="mt-3 space-y-2 text-sm text-slate-100">
                {strengthsAndGaps.strengths.length ? (
                  strengthsAndGaps.strengths.map((s, i) => <div key={i}>• {s}</div>)
                ) : (
                  <div className="text-slate-300">No clear wins yet.</div>
                )}
              </div>
            </Card>
            <Card className={`p-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 ${premiumSurfaceClass}`}>
              <div className="text-sm font-semibold text-amber-200">Areas to watch</div>
              <div className="mt-3 space-y-2 text-sm text-slate-100">
                {strengthsAndGaps.gaps.length ? (
                  strengthsAndGaps.gaps.map((s, i) => <div key={i}>• {s}</div>)
                ) : (
                  <div className="text-slate-300">No clear gaps yet.</div>
                )}
                {strengthsAndGaps.ties.slice(0, 4).map((s, i) => (
                  <div key={`t-${i}`} className="text-slate-300">
                    • {s}
                  </div>
                ))}
                {verdict?.trendNote ? <div className="text-slate-300">• {verdict.trendNote}</div> : null}
              </div>
            </Card>
          </div>

          {/* AI coach patterns comparison */}
          {coachPanels ? (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
                  <div className="text-sm font-semibold">This video&apos;s issues</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {coachPanels.videoTags.length ? (
                      coachPanels.videoTags.map(([t, n]) => (
                        <span key={t} className="text-xs px-2 py-1 rounded-full border border-white/10 bg-white/5 text-slate-200">
                          {t} ×{n}
                        </span>
                      ))
                    ) : (
                      <div className="text-sm text-slate-400">No coach comments found.</div>
                    )}
                  </div>
                </Card>
                <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
                  <div className="text-sm font-semibold">Channel&apos;s recurring issues ({channelStats.completedCount} vids)</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {coachPanels.channelTags.map((p, i) => {
                      const n = Number(p.count || 0);
                      const tone =
                        n > 10
                          ? "border-red-400/30 bg-red-400/10 text-red-200"
                          : n >= 5
                            ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                            : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
                      return (
                        <span key={`${p.comment}-${i}`} className={clsx("text-xs px-2 py-1 rounded-full border", tone)}>
                          {p.comment} ×{n}
                        </span>
                      );
                    })}
                  </div>
                </Card>
              </div>
              <div className="text-sm text-slate-300">{coachPanels.insight}.</div>
            </>
          ) : null}

          {confidenceRank ? (
            <Card className={`p-6 rounded-2xl text-center ${premiumSurfaceClass}`}>
              <div className="text-sm font-semibold">Video ranking within channel</div>
              <div className="mt-3 text-5xl font-bold">#{confidenceRank.rank} <span className="text-slate-400 text-2xl font-semibold">of {confidenceRank.total}</span></div>
              <div
                className={clsx(
                  "mt-2 text-sm",
                  confidenceRank.percentile >= 67
                    ? "text-emerald-200"
                    : confidenceRank.percentile >= 34
                      ? "text-amber-200"
                      : "text-red-200"
                )}
              >
                Top {confidenceRank.percentile}% of all analysed videos in this channel
              </div>
            </Card>
          ) : null}
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
  const [compareMode, setCompareMode] = useState<CompareMode>("video");
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
            : compareMode === "channel"
              ? "Compare aggregate performance between two channels"
              : "Test a video against a channel benchmark"}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setCompareMode("video");
            // Reset "video" mode state (kept in this component) when switching back.
            setSourceId("");
            setSourceDetail(null);
            setFiles([]);
            setChannelName("");
            setNewJobId("");
            setNewStatus("");
            setNewStage("");
            setNewProgress(0);
            setNewError("");
            setNewDetail(null);
            setCompareReport(null);
            setErr("");
          }}
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
          onClick={() => {
            setCompareMode("channel");
            setErr("");
          }}
          className={clsx(
            "px-4 py-2 rounded-xl text-sm border transition-all",
            compareMode === "channel"
              ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
              : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
          )}
        >
          Channel vs Channel
        </button>
        <button
          type="button"
          onClick={() => {
            setCompareMode("cvv");
            setErr("");
          }}
          className={clsx(
            "px-4 py-2 rounded-xl text-sm border transition-all",
            compareMode === "cvv"
              ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
              : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
          )}
        >
          Channel vs Video
        </button>
      </div>

      {compareMode === "channel" ? (
        <CompareChannelPane />
      ) : compareMode === "cvv" ? (
        <CompareChannelVsVideoPane />
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

