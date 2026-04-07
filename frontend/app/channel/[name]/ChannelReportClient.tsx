"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { MetricsGrid } from "@/components/MetricsGrid";
import type { MetricEvent, MetricKey } from "@/components/video-analysis-types";
import type { ChannelReport, ChannelSummary } from "@/lib/api";
import {
  clearChannelAISummaryCache,
  fetchChannelAISummary,
  fetchChannelReport,
  fetchChannelsSummary,
  getAnalysisDetail,
  updateChannelName,
} from "@/lib/api";

function PencilIcon(props: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

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

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ")
    .trim();
}

const chartTooltip = {
  contentStyle: { background: "rgba(2,6,23,0.92)", border: "1px solid rgba(255,255,255,0.1)" },
  labelStyle: { color: "#94a3b8" },
};

function eventToMetricEvent(e: any): MetricEvent {
  if (!e) return { t0: 0, metric: "", label: "" };
  return {
    metric: e.metric ?? e.type,
    type: e.type,
    label: e.label ?? e.message ?? e.note ?? e.reason ?? "",
    t0: Number(e.t0 ?? 0),
    t1: e.t1 == null ? undefined : Number(e.t1),
    value: e.value == null ? undefined : Number(e.value),
    note: e.note,
    message: e.message,
  };
}

function mean(nums: number[]): number | null {
  const ok = (nums || []).filter((n) => Number.isFinite(n));
  if (!ok.length) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

function TrendMetricLine(props: {
  label: string;
  delta: number | null;
  unit: "pts" | "wpm";
}) {
  const { label, delta, unit } = props;
  if (delta == null) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        <span className="w-24 shrink-0 text-slate-300">{label}</span>
        <span>→ stable</span>
        <span className="text-slate-500">(last 5 vs prev 5 videos)</span>
      </div>
    );
  }
  const rounded = Math.round(delta);
  if (rounded === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        <span className="w-24 shrink-0 text-slate-300">{label}</span>
        <span>→ stable</span>
        <span className="text-slate-500">(last 5 vs prev 5 videos)</span>
      </div>
    );
  }
  const up = rounded > 0;
  const down = rounded < 0;
  const arrow = up ? "↑" : "↓";
  const color = up ? "text-emerald-300" : down ? "text-red-300" : "text-slate-400";
  const sign = rounded > 0 ? "+" : "";
  const suffix = unit === "pts" ? " pts" : " WPM";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-slate-300">{label}</span>
      <span className={color}>
        {arrow} {sign}
        {rounded}
        {suffix}
      </span>
      <span className="text-slate-500">(last 5 vs prev 5 videos)</span>
    </div>
  );
}

function RefreshIcon(props: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={props.className}
      aria-hidden
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

export default function ChannelReportClient(props: { encodedName: string }) {
  const rawName = useMemo(() => {
    try {
      return decodeURIComponent(props.encodedName || "");
    } catch {
      return props.encodedName || "";
    }
  }, [props.encodedName]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [report, setReport] = useState<ChannelReport | null>(null);
  const [summaryMatch, setSummaryMatch] = useState<ChannelSummary | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameEditErr, setNameEditErr] = useState("");
  const [renaming, setRenaming] = useState(false);
  const nameErrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [aiSummary, setAiSummary] = useState("");
  const [aiSummaryLoading, setAiSummaryLoading] = useState(true);
  const [aiSummaryError, setAiSummaryError] = useState("");

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [selectedMetric, setSelectedMetric] = useState<MetricKey | "">("");
  const [latestResult, setLatestResult] = useState<any>(null);
  const [latestDurationSec, setLatestDurationSec] = useState<number>(0);
  const [latestEvents, setLatestEvents] = useState<MetricEvent[]>([]);
  const [eyeNotMeasurable, setEyeNotMeasurable] = useState(false);

  function showNameErr(msg: string) {
    if (nameErrTimerRef.current) clearTimeout(nameErrTimerRef.current);
    setNameEditErr(msg);
    nameErrTimerRef.current = setTimeout(() => {
      setNameEditErr("");
      nameErrTimerRef.current = null;
    }, 3000);
  }

  async function commitHeaderRename() {
    if (!summaryMatch?.id) return;
    const next = nameDraft.trim();
    if (next === summaryMatch.name) {
      setEditingName(false);
      setNameEditErr("");
      return;
    }
    if (!next) {
      showNameErr("Name can't be empty");
      return;
    }
    const prevName = summaryMatch.name;
    setRenaming(true);
    setSummaryMatch({ ...summaryMatch, name: next });
    setEditingName(false);
    setNameEditErr("");
    try {
      const out = await updateChannelName(summaryMatch.id, next);
      setSummaryMatch((s) => (s ? { ...s, name: out.channel.name } : s));
    } catch (e: unknown) {
      setSummaryMatch((s) => (s ? { ...s, name: prevName } : s));
      setEditingName(true);
      setNameDraft(next);
      showNameErr(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setRenaming(false);
    }
  }

  function cancelHeaderRename() {
    setEditingName(false);
    setNameEditErr("");
    if (nameErrTimerRef.current) {
      clearTimeout(nameErrTimerRef.current);
      nameErrTimerRef.current = null;
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      setAiSummaryLoading(true);
      setAiSummaryError("");
      try {
        const settled = await Promise.allSettled([
          fetchChannelsSummary(),
          fetchChannelReport(rawName.trim()),
          fetchChannelAISummary(rawName.trim()),
        ]);
        if (!alive) return;
        const s0 = settled[0];
        const s1 = settled[1];
        const s2 = settled[2];

        if (s0.status === "fulfilled" && s1.status === "fulfilled") {
          const sumJson = s0.value;
          const rep = s1.value;
          const key = rawName.trim().toLowerCase();
          const ch =
            (sumJson.channels || []).find((c) => c.name.trim().toLowerCase() === key) ?? null;
          setSummaryMatch(ch);
          setReport(rep);
          setErr("");
        } else {
          const msg =
            s0.status === "rejected"
              ? String(s0.reason instanceof Error ? s0.reason.message : s0.reason)
              : s1.status === "rejected"
                ? String(s1.reason instanceof Error ? s1.reason.message : s1.reason)
                : "Failed to load channel";
          setErr(msg);
          setReport(null);
          setSummaryMatch(null);
        }

        if (s2.status === "fulfilled") {
          setAiSummary(s2.value.summary);
          setAiSummaryError("");
        } else {
          setAiSummary("");
          setAiSummaryError(
            s2.reason instanceof Error ? s2.reason.message : "Could not generate summary"
          );
        }
      } catch (e: unknown) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "Failed to load channel");
        setReport(null);
        setSummaryMatch(null);
        setAiSummaryError("Could not generate summary");
      } finally {
        if (alive) {
          setLoading(false);
          setAiSummaryLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [rawName]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const latestId = (report?.individual_videos || [])[0]?.analysis_id;
      if (!latestId) {
        setLatestResult(null);
        setLatestDurationSec(0);
        setLatestEvents([]);
        setEyeNotMeasurable(false);
        return;
      }
      try {
        const d = await getAnalysisDetail(String(latestId));
        if (!alive) return;
        const rj: any = (d as any)?.result_json ?? null;
        setLatestResult(rj);
        const dur = Number(rj?.summary?.duration_sec ?? (d as any)?.job?.duration_sec ?? 0);
        setLatestDurationSec(Number.isFinite(dur) ? dur : 0);
        const ev = (rj?.events || []) as any[];
        const drops = (rj?.engagement_drops || []) as any[];
        const pauses = (rj?.pauses || []) as any[];
        const best = (rj?.best_moments || []) as any[];
        const worst = (rj?.worst_moments || []) as any[];
        const mapped: MetricEvent[] = [];
        for (const e of ev) mapped.push(eventToMetricEvent(e));
        for (const e of drops)
          mapped.push({ ...eventToMetricEvent(e), metric: e.metric ?? e.type ?? "engagement_drop", type: e.type ?? e.metric ?? "engagement_drop" });
        for (const e of pauses)
          mapped.push({ ...eventToMetricEvent(e), metric: "pause", type: "pause", label: e.reason ?? e.label ?? e.note ?? "Pause" });
        for (const e of best)
          mapped.push({ ...eventToMetricEvent(e), metric: "best_moment", type: "best_moment", label: e.note ?? e.label ?? "Best moment" });
        for (const e of worst)
          mapped.push({ ...eventToMetricEvent(e), metric: "worst_moment", type: "worst_moment", label: e.reason ?? e.label ?? "Worst moment" });
        setLatestEvents(mapped.sort((a, b) => Number(a.t0 || 0) - Number(b.t0 || 0)));

        const faceVisible = Number(rj?.cards?.eye_contact?.face_visible_ratio ?? NaN);
        setEyeNotMeasurable(Number.isFinite(faceVisible) ? faceVisible < 0.1 : false);
      } catch {
        if (!alive) return;
        setLatestResult(null);
        setLatestDurationSec(0);
        setLatestEvents([]);
        setEyeNotMeasurable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [report]);

  useEffect(() => {
    return () => {
      if (nameErrTimerRef.current) clearTimeout(nameErrTimerRef.current);
    };
  }, []);

  const displayName = summaryMatch?.name?.trim() || report?.channel_name?.trim() || rawName.trim() || "Channel";
  const hue = hashHue(displayName);

  const totals = useMemo(() => {
    const r = report;
    return {
      totalVideos: Math.round(Number(r?.total_videos ?? 0) || 0),
      completedVideos: Math.round(Number(r?.completed_videos ?? 0) || 0),
      avgConf: Math.round(Number(r?.avg_confidence ?? 0) || 0),
      avgEnergy: Math.round(Number(r?.avg_energy ?? 0) || 0),
      avgWpm: Math.round(Number(r?.avg_wpm ?? 0) || 0),
      avgEye: Math.round(Number(r?.avg_eye_contact ?? 0) || 0),
    };
  }, [report]);

  const earliest = useMemo(() => {
    const vids = report?.individual_videos || [];
    if (!vids.length) return null;
    let min = Infinity;
    for (const a of vids) {
      const t = new Date(a.created_at || "").getTime();
      if (Number.isFinite(t) && t < min) min = t;
    }
    return Number.isFinite(min) ? new Date(min) : null;
  }, [report]);

  const activeSince =
    earliest != null
      ? earliest.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : "—";

  const confTrend = useMemo(() => {
    return (report?.confidence_over_time || [])
      .map((p) => {
        const t = new Date(p.date).getTime();
        return { x: p.date, t, v: p.value == null ? null : Number(p.value) };
      })
      .filter((p) => Number.isFinite(p.t));
  }, [report]);

  const seriesByDay = useMemo(() => {
    const vids = report?.individual_videos || [];
    const byDay: Record<string, { conf: number[]; energy: number[]; wpm: number[] }> = {};
    for (const v of vids) {
      const day = String(v.created_at || "").slice(0, 10);
      if (!day) continue;
      if (!byDay[day]) byDay[day] = { conf: [], energy: [], wpm: [] };
      if (v.confidence_score != null) byDay[day].conf.push(Number(v.confidence_score));
      if (v.energy_score != null) byDay[day].energy.push(Number(v.energy_score));
      const w = v.metrics?.speech_rate_wpm;
      if (w != null) byDay[day].wpm.push(Number(w));
    }
    const days = Object.keys(byDay).sort();
    const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return days.map((d) => ({
      x: d,
      confidence: mean(byDay[d].conf),
      energy: mean(byDay[d].energy),
      wpm: mean(byDay[d].wpm),
    }));
  }, [report]);

  const trendPoints = seriesByDay;

  const avgConfLine = totals.avgConf;
  const avgEnergyLine = totals.avgEnergy;
  const avgWpmLine = totals.avgWpm;

  const best = report?.best_videos || [];
  const worst = report?.worst_videos || [];
  const coachPatterns = report?.top_coach_patterns || [];
  const maxPatternCount = coachPatterns.length ? Math.max(...coachPatterns.map((p) => p.count)) : 1;

  const thumbUrl = summaryMatch?.thumbnailUrl?.trim() || null;

  const confDelta = useMemo(() => {
    const r = report;
    if (r?.recent_avg_confidence == null || r?.previous_avg_confidence == null) return null;
    return Number(r.recent_avg_confidence) - Number(r.previous_avg_confidence);
  }, [report]);

  const aggregatedMetricCards = useMemo(() => {
    const vids = report?.individual_videos || [];
    const wpm = totals.avgWpm;
    const eyeRatio = totals.avgEye > 0 ? totals.avgEye / 100 : 0;

    const fillers = mean(
      vids
        .map((v) => Number(v.metrics?.filler_rate))
        .filter((n) => Number.isFinite(n))
    );
    const gestures = mean(
      vids
        .map((v) => Number(v.metrics?.gesture_rate))
        .filter((n) => Number.isFinite(n))
    );
    const tonalScore = mean(
      vids
        .map((v) => Number(v.metrics?.tonal_variation))
        .filter((n) => Number.isFinite(n))
    );
    const expr = mean(
      vids
        .map((v) => Number(v.metrics?.expression_change))
        .filter((n) => Number.isFinite(n))
    );

    const tonalLabel = String(latestResult?.cards?.tonal_variation?.label ?? "").toLowerCase() || null;
    const exprByType = (latestResult?.cards?.expressions?.by_type ?? {}) as Record<string, number>;
    const exprTop = Object.entries(exprByType).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ?? "-";
    const exprChangesPerMin = Number.isFinite(expr ?? NaN) ? Number(expr) : 0;
    const exprBadge = exprChangesPerMin < 20 ? "low" : exprChangesPerMin <= 60 ? "normal" : "high";

    return {
      wpm,
      fillers: fillers == null ? "-" : Number(fillers.toFixed(1)),
      eye: Number.isFinite(eyeRatio) ? eyeRatio : "-",
      gestures: gestures == null ? "-" : Number(gestures.toFixed(1)),
      tonalScore: tonalScore == null ? null : Number(tonalScore.toFixed(1)),
      tonalLabel,
      exprTop,
      exprChangesPerMin,
      exprBadge,
    };
  }, [report, totals.avgWpm, totals.avgEye, latestResult]);

  async function regenerateAiSummary() {
    clearChannelAISummaryCache(rawName.trim());
    setAiSummaryLoading(true);
    setAiSummaryError("");
    try {
      const r = await fetchChannelAISummary(rawName.trim(), { force: true });
      setAiSummary(r.summary);
    } catch (e: unknown) {
      setAiSummary("");
      setAiSummaryError(e instanceof Error ? e.message : "Could not generate summary");
    } finally {
      setAiSummaryLoading(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <Link href="/dashboard" className="text-sm text-cyan-300 hover:text-cyan-200">
        ← Dashboard
      </Link>

      {err ? <div className="mt-4 text-red-400 text-sm">{err}</div> : null}

      <div className="mt-6 flex flex-col sm:flex-row gap-6 sm:items-start">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white border border-white/20 shrink-0"
          style={{
            backgroundColor: thumbUrl ? "rgba(15,23,42,0.9)" : `hsl(${hue} 45% 42%)`,
            backgroundImage: thumbUrl ? `linear-gradient(rgba(15,23,42,0.75), rgba(15,23,42,0.9)), url(${JSON.stringify(thumbUrl)})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {!thumbUrl ? initials(displayName) : null}
        </div>
        <div className="min-w-0 flex-1">
          {editingName && summaryMatch ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  disabled={renaming}
                  className="min-w-0 flex-1 max-w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-2xl font-semibold tracking-tight text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none sm:text-3xl"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitHeaderRename();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelHeaderRename();
                    }
                  }}
                />
                <button
                  type="button"
                  title="Save"
                  className="shrink-0 rounded-lg px-3 py-2 text-lg text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-40"
                  disabled={renaming}
                  onClick={() => void commitHeaderRename()}
                >
                  ✓
                </button>
                <button
                  type="button"
                  title="Cancel"
                  className="shrink-0 rounded-lg px-3 py-2 text-lg text-slate-400 hover:bg-white/10 disabled:opacity-40"
                  disabled={renaming}
                  onClick={cancelHeaderRename}
                >
                  ✗
                </button>
              </div>
              {nameEditErr ? <div className="text-sm text-red-400">{nameEditErr}</div> : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-3xl font-semibold tracking-tight">{titleCase(displayName)}</h1>
              {summaryMatch?.id ? (
                <button
                  type="button"
                  title="Rename channel"
                  aria-label="Rename channel"
                  className="rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-white/10 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  onClick={() => {
                    setEditingName(true);
                    setNameDraft(summaryMatch.name);
                    setNameEditErr("");
                  }}
                >
                  <PencilIcon className="w-5 h-5" />
                </button>
              ) : null}
            </div>
          )}
          <p className="text-slate-400 text-sm mt-1">
            {totals.totalVideos} video{totals.totalVideos === 1 ? "" : "s"} · Active since {activeSince}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { label: "Avg Confidence", value: loading ? "—" : String(totals.avgConf) },
              { label: "Avg Energy", value: loading ? "—" : String(totals.avgEnergy) },
              { label: "Avg WPM", value: loading ? "—" : String(totals.avgWpm) },
              { label: "Eye Contact", value: loading ? "—" : `${totals.avgEye}%` },
            ].map((p) => (
              <div
                key={p.label}
                className="px-3 py-1.5 rounded-full text-xs border border-white/10 bg-white/5 text-slate-200"
              >
                <span className="text-slate-500">{p.label}</span>{" "}
                <span className="font-semibold text-white">{p.value}</span>
              </div>
            ))}
          </div>

          {report?.recent_avg_confidence == null || report?.previous_avg_confidence == null ? (
            <p className="mt-4 text-sm text-slate-500">Need 6+ videos for trend data.</p>
          ) : (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Trend</div>
              <TrendMetricLine label="Confidence" delta={confDelta} unit="pts" />
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <span>AI Summary</span>
                <span className="text-cyan-300/90" aria-hidden>
                  ✦
                </span>
              </div>
              <button
                type="button"
                title="Regenerate summary"
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-cyan-200 hover:bg-white/10 disabled:opacity-40"
                disabled={aiSummaryLoading}
                onClick={() => void regenerateAiSummary()}
              >
                <RefreshIcon className="w-3.5 h-3.5" />
                Regenerate
              </button>
            </div>
            {aiSummaryLoading ? (
              <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <div className="h-3 w-full max-w-[95%] rounded bg-white/10 animate-pulse" />
                <div className="h-3 w-full max-w-[88%] rounded bg-white/10 animate-pulse" />
                <div className="h-3 w-full max-w-[72%] rounded bg-white/10 animate-pulse" />
              </div>
            ) : aiSummaryError ? (
              <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200/90 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <span>Could not generate summary</span>
                <button
                  type="button"
                  className="text-cyan-300 hover:underline text-sm"
                  onClick={() => void regenerateAiSummary()}
                >
                  Retry
                </button>
              </div>
            ) : (
              <div
                className="mt-3 rounded-xl border border-white/10 bg-white/[0.06] pl-4 pr-4 py-3 text-sm text-slate-200 leading-relaxed"
                style={{ borderLeftWidth: 4, borderLeftColor: `hsl(${hue} 45% 42%)` }}
              >
                {aiSummary || "—"}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold">Performance over time</h2>
        {loading ? (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-56 bg-white/5 border border-white/10 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : trendPoints.length === 0 ? (
          <div className="mt-4 text-sm text-slate-400">No completed videos with scores yet.</div>
        ) : (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs text-slate-400 mb-2">Confidence</div>
              <div style={{ width: "100%", minHeight: 200 }}>
                {mounted ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={trendPoints}>
                      <XAxis dataKey="x" stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                      <Tooltip {...chartTooltip} />
                      <ReferenceLine y={avgConfLine} stroke="rgba(148,163,184,0.5)" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="confidence" stroke="#22d3ee" strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs text-slate-400 mb-2">Energy</div>
              <div style={{ width: "100%", minHeight: 200 }}>
                {mounted ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={trendPoints}>
                      <XAxis dataKey="x" stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                      <Tooltip {...chartTooltip} />
                      <ReferenceLine y={avgEnergyLine} stroke="rgba(148,163,184,0.5)" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="energy" stroke="#34d399" strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs text-slate-400 mb-2">WPM</div>
              <div style={{ width: "100%", minHeight: 200 }}>
                {mounted ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={trendPoints}>
                      <XAxis dataKey="x" stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 200]} stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                      <Tooltip {...chartTooltip} />
                      <ReferenceLine y={avgWpmLine} stroke="rgba(148,163,184,0.5)" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="wpm" stroke="#fbbf24" strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold">Detailed metrics</h2>
        <p className="mt-1 text-sm text-slate-400">
          Click any metric for the full breakdown (modal uses your most recent completed video).
        </p>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="grid grid-cols-12 gap-0">
            <MetricsGrid
              show
              currentStepId="channel"
              demoMetricValue={Number(aggregatedMetricCards.wpm) || 0}
              selectedMetric={selectedMetric}
              onSelectMetric={(m) => setSelectedMetric(m)}
              cards={aggregatedMetricCards}
              events={latestEvents}
              durationSec={latestDurationSec || 0}
              eyeNotMeasurable={eyeNotMeasurable}
              metricDetailContext={
                latestResult
                  ? {
                      durationSec: latestDurationSec || 0,
                      binSizeSec: 10,
                      timelineBins: (latestResult?.timeline_bins ?? latestResult?.timelineBins ?? []) as any[],
                      rawCards: (latestResult?.cards ?? null) as any,
                      transcriptPreview: String(latestResult?.transcript_preview ?? latestResult?.transcriptPreview ?? "") || null,
                      summary: (latestResult?.summary ?? null) as any,
                      quality: (latestResult?.quality ?? null) as any,
                      speakers: (latestResult?.speakers ?? null) as any,
                    }
                  : null
              }
            />
          </div>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="text-sm font-semibold text-emerald-300/90">Top 3 videos</div>
          <div className="mt-3 space-y-2">
            {best.length === 0 ? (
              <div className="text-sm text-slate-500">No scored videos yet.</div>
            ) : (
              best.map((v) => (
                <div
                  key={v.analysis_id}
                  className="flex items-center gap-3 bg-white/5 border border-emerald-500/20 rounded-xl p-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{v.filename}</div>
                    <div className="text-xs text-emerald-200/90">{v.confidence != null ? Math.round(v.confidence) : "—"}</div>
                  </div>
                  <Link
                    href={`/video/${encodeURIComponent(String(v.analysis_id))}`}
                    className="text-xs text-cyan-300 shrink-0"
                  >
                    Open →
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold text-amber-300/90">Needs work</div>
          <div className="mt-3 space-y-2">
            {worst.length === 0 ? (
              <div className="text-sm text-slate-500">No scored videos yet.</div>
            ) : (
              worst.map((v) => (
                <div
                  key={v.analysis_id}
                  className="flex items-center gap-3 bg-white/5 border border-amber-500/20 rounded-xl p-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{v.filename}</div>
                    <div className="text-xs text-amber-200/90">{v.confidence != null ? Math.round(v.confidence) : "—"}</div>
                  </div>
                  <Link
                    href={`/video/${encodeURIComponent(String(v.analysis_id))}`}
                    className="text-xs text-cyan-300 shrink-0"
                  >
                    Open →
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {coachPatterns.length > 0 ? (
        <div className="mt-10">
          <h2 className="text-lg font-semibold">Common coaching notes</h2>
          <div className="mt-4 space-y-3">
            {coachPatterns.map((p) => (
              <div key={p.comment} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-400 tabular-nums">[{p.count}]</span>
                  <span className="text-slate-100 flex-1 min-w-0">&quot;{p.comment}&quot;</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-cyan-500/70 rounded-full"
                    style={{ width: `${Math.round((p.count / maxPatternCount) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-2">All videos ({totals.totalVideos})</h2>
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-left text-slate-400 border-b border-white/10">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Filename</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Energy</th>
                <th className="px-4 py-3">WPM</th>
                <th className="px-4 py-3">Open</th>
              </tr>
            </thead>
            <tbody>
              {(report?.individual_videos || []).map((v) => (
                <tr key={v.analysis_id} className="border-b border-white/5">
                  <td className="px-4 py-3 text-slate-400">
                    {v.created_at ? new Date(v.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-200 truncate max-w-[420px]" title={v.filename}>
                    {v.filename}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{v.confidence_score ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{v.energy_score ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{v.metrics?.speech_rate_wpm ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Link href={`/video/${encodeURIComponent(v.analysis_id)}`} className="text-cyan-300 text-xs">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && (!report || (report.individual_videos || []).length === 0) ? (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={6}>
                    No completed videos yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
