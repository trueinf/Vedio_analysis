"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { MetricsGrid } from "@/components/MetricsGrid";
import type { ChannelReport, ChannelSummary } from "@/lib/api";
import {
  fetchChannelReport,
  fetchChannelsSummary,
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

function fmtBench(
  v: number | null | undefined,
  opts?: { format?: "int" | "float1" | "pct0"; suffix?: string }
): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const fmt = opts?.format ?? "int";
  const suffix = opts?.suffix ?? "";
  if (fmt === "pct0") return `${Math.round(n)}%`;
  if (fmt === "float1") return `${n.toFixed(1)}${suffix}`;
  return `${Math.round(n)}${suffix}`;
}

function HistBar(props: { labels: string[]; counts: number[] }) {
  const labels = props.labels || [];
  const counts = props.counts || [];
  const max = counts.length ? Math.max(...counts.map((x) => Number(x) || 0)) : 0;
  if (!labels.length || !counts.length || max <= 0) return null;
  let bestIdx = 0;
  for (let i = 1; i < counts.length; i++) {
    const a = Number(counts[i] ?? 0) || 0;
    const b = Number(counts[bestIdx] ?? 0) || 0;
    if (a > b) bestIdx = i;
  }
  const bestLabel = labels[bestIdx] ?? "";
  return (
    <div className="mt-2 space-y-1">
      {labels.map((lab, i) => {
        const c = Number(counts[i] ?? 0) || 0;
        const w = Math.round((c / max) * 100);
        return (
          <div key={`${lab}-${i}`} className="flex items-center gap-2">
            <div className="w-16 text-[10px] text-slate-500 truncate" title={lab}>
              {lab}
            </div>
            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white/30" style={{ width: `${Math.max(2, w)}%` }} />
            </div>
            <div className="w-7 text-right text-[10px] text-slate-500 tabular-nums">{c}</div>
          </div>
        );
      })}
      {bestLabel ? (
        <div className="pt-1 text-[10px] text-slate-500">
          Most common: <span className="text-slate-300">{bestLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function formatDurationChip(totalSec: number): string {
  const s = Math.max(0, Math.floor(Number(totalSec || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

type Verdict = "Strong" | "Good" | "Mixed" | "Developing";

const THRESHOLDS = {
  confidence: { good: 70, strong: 85 },
  eye_contact: { good: 70, strong: 85 },
  filler_words: { good: 4, strong: 2 }, // lower is better
  energy: { good: 70, strong: 85 },
} as const;

function verdictForScore(v: number): Verdict {
  const x = Number(v);
  if (!Number.isFinite(x)) return "Developing";
  if (x >= 85) return "Strong";
  if (x >= 70) return "Good";
  if (x >= 55) return "Mixed";
  return "Developing";
}

function getVerdict(value: number, metric: "confidence" | "eye_contact" | "filler_words" | "energy"): Verdict {
  const v = Number(value);
  if (!Number.isFinite(v)) return "Developing";
  if (metric === "filler_words") {
    if (v <= THRESHOLDS.filler_words.strong) return "Strong";
    if (v <= THRESHOLDS.filler_words.good) return "Good";
    if (v <= 6) return "Mixed";
    return "Developing";
  }
  if (v >= 85) return "Strong";
  if (v >= 70) return "Good";
  if (v >= 55) return "Mixed";
  return "Developing";
}

function verdictTone(verdict: Verdict): { text: string; borderLeft: string; textTone: string } {
  if (verdict === "Strong") return { text: "text-emerald-200", borderLeft: "border-l-emerald-400", textTone: "text-emerald-300" };
  if (verdict === "Good") return { text: "text-teal-200", borderLeft: "border-l-teal-400", textTone: "text-teal-300" };
  if (verdict === "Mixed") return { text: "text-amber-200", borderLeft: "border-l-amber-400", textTone: "text-amber-300" };
  return { text: "text-red-200", borderLeft: "border-l-red-400", textTone: "text-red-300" };
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso || "").getTime();
  if (!Number.isFinite(t)) return "—";
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - t) / 1000));
  const m = Math.floor(s / 60);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 24) return `${mo}mo ago`;
  const y = Math.floor(mo / 12);
  return `${y}y ago`;
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
      try {
        const settled = await Promise.allSettled([fetchChannelsSummary(), fetchChannelReport(rawName.trim())]);
        if (!alive) return;
        const s0 = settled[0];
        const s1 = settled[1];

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
      } catch (e: unknown) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "Failed to load channel");
        setReport(null);
        setSummaryMatch(null);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [rawName]);

  useEffect(() => {
    return () => {
      if (nameErrTimerRef.current) clearTimeout(nameErrTimerRef.current);
    };
  }, []);

  const displayName = summaryMatch?.name?.trim() || report?.channel_name?.trim() || rawName.trim() || "Channel";
  const hue = hashHue(displayName);

  const totals = useMemo(() => {
    const r = report;
    const b = r?.benchmark ?? null;
    const bConf = b && b["confidence"] ? Number(b["confidence"].p50 ?? NaN) : NaN;
    const bEnergy = b && b["energy"] ? Number(b["energy"].p50 ?? NaN) : NaN;
    const bWpm = b && b["wpm"] ? Number(b["wpm"].p50 ?? NaN) : NaN;
    const bEye = b && b["eye_contact_pct"] ? Number(b["eye_contact_pct"].p50 ?? NaN) : NaN;
    return {
      totalVideos: Math.round(Number(r?.total_videos ?? 0) || 0),
      completedVideos: Math.round(Number(r?.completed_videos ?? 0) || 0),
      benchConf: Number.isFinite(bConf) ? Math.round(bConf) : Math.round(Number(r?.avg_confidence ?? 0) || 0),
      benchEnergy: Number.isFinite(bEnergy) ? Math.round(bEnergy) : Math.round(Number(r?.avg_energy ?? 0) || 0),
      benchWpm: Number.isFinite(bWpm) ? Math.round(bWpm) : Math.round(Number(r?.avg_wpm ?? 0) || 0),
      benchEye: Number.isFinite(bEye) ? Math.round(bEye) : Math.round(Number(r?.avg_eye_contact ?? 0) || 0),
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

  const best = report?.best_videos || [];
  const worst = report?.worst_videos || [];
  const coachPatterns = report?.top_coach_patterns || [];
  const maxPatternCount = coachPatterns.length ? Math.max(...coachPatterns.map((p) => p.count)) : 1;

  const thumbUrl = summaryMatch?.thumbnailUrl?.trim() || null;

  const aggregatedMetricCards = useMemo(() => {
    const vids = report?.individual_videos || [];
    const b = report?.benchmark ?? null;
    const wpm = b && b["wpm"] ? (b["wpm"].p50 ?? null) : null;
    const eyePct = b && b["eye_contact_pct"] ? (b["eye_contact_pct"].p50 ?? null) : null;
    const fillers = b && b["fillers_per_min"] ? (b["fillers_per_min"].p50 ?? null) : null;
    const gestures = b && b["gestures_per_min"] ? (b["gestures_per_min"].p50 ?? null) : null;
    const tonalScore = b && b["tonal"] ? (b["tonal"].p50 ?? null) : null;
    const expr = b && b["expression_changes_per_min"] ? (b["expression_changes_per_min"].p50 ?? null) : null;

    const eyeRatio = eyePct == null ? "-" : Number.isFinite(Number(eyePct)) ? Number(eyePct) / 100 : "-";
    const exprChangesPerMin = expr == null || !Number.isFinite(Number(expr)) ? 0 : Number(expr);
    const exprBadge = exprChangesPerMin < 20 ? "low" : exprChangesPerMin <= 60 ? "normal" : "high";

    return {
      wpm: wpm == null ? "-" : Number.isFinite(Number(wpm)) ? Number(wpm) : "-",
      fillers: fillers == null ? "-" : Number.isFinite(Number(fillers)) ? Number(Number(fillers).toFixed(1)) : "-",
      eye: eyeRatio,
      gestures: gestures == null ? "-" : Number.isFinite(Number(gestures)) ? Number(Number(gestures).toFixed(1)) : "-",
      tonalScore: tonalScore == null ? null : Number.isFinite(Number(tonalScore)) ? Number(Number(tonalScore).toFixed(1)) : null,
      tonalLabel: null,
      exprTop: "-",
      exprChangesPerMin,
      exprBadge,
    };
  }, [report]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <Link href="/dashboard" className="text-sm text-cyan-300 hover:text-cyan-200">
        ← Dashboard
      </Link>

      {err ? <div className="mt-4 text-red-400 text-sm">{err}</div> : null}

      {/* LAYER A — CAPABILITY (Hero section) */}
      <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/40 backdrop-blur p-5 sm:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 flex gap-4">
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-xl sm:text-2xl font-bold text-white border border-white/20 shrink-0"
              style={{
                backgroundColor: thumbUrl ? "rgba(15,23,42,0.9)" : `hsl(${hue} 45% 42%)`,
                backgroundImage: thumbUrl
                  ? `linear-gradient(rgba(15,23,42,0.75), rgba(15,23,42,0.9)), url(${JSON.stringify(thumbUrl)})`
                  : undefined,
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
                      className="min-w-0 flex-1 max-w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[22px] font-bold tracking-tight text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
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
                  <div className="text-[22px] font-bold tracking-tight text-white truncate max-w-full">
                    {titleCase(displayName)}
                  </div>
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

              <div className="mt-1 text-sm text-slate-300">
                {Math.max(0, totals.totalVideos)} videos analysed ·{" "}
                {loading ? "—" : `${formatDurationChip(Number(report?.total_duration_sec ?? 0))} of content reviewed`}
              </div>
              <div className="mt-0.5 text-sm text-slate-400">
                Active since {activeSince} · Last analysed{" "}
                {loading ? "—" : formatRelativeTime(String(report?.last_analyzed_at ?? ""))}
              </div>

              <p className="mt-4 text-sm text-slate-300 leading-relaxed max-w-2xl">
                We extract 7 delivery signals from every frame and second of audio — presence, clarity, pace, eye
                contact, gestures, tone, and expression.
              </p>
            </div>
          </div>

          <div className="lg:col-span-4">
            {(() => {
              const overall = Math.round(Number(report?.avg_confidence ?? 0) || 0);
              const verdict = verdictForScore(overall);
              const tone = verdictTone(verdict);
              return (
                <div className={`rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 ${tone.borderLeft} border-l-4`}>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Overall delivery score</div>
                  <div className="mt-2 text-5xl font-bold tabular-nums text-white">{loading ? "—" : overall}</div>
                  <div className={`mt-1 text-sm font-semibold ${tone.textTone}`}>{verdict}</div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* LAYER B1 — AT A GLANCE (4 hero KPIs) */}
      <section className="mt-10" aria-labelledby="at-a-glance-heading">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">At a glance</div>
        <h2 id="at-a-glance-heading" className="mt-2 text-lg font-semibold">
          At a glance
        </h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(() => {
            const avgConfidence = Math.round(Number(report?.avg_confidence ?? 0) || 0);
            const avgEnergy = Math.round(Number(report?.avg_energy ?? 0) || 0);
            const avgEye = Math.round(Number(report?.avg_eye_contact ?? 0) || 0);
            const avgFillers = Number(report?.avg_filler_rate ?? NaN);
            const fillersVal = Number.isFinite(avgFillers) ? Number(avgFillers.toFixed(1)) : NaN;

            const items = [
              {
                key: "confidence",
                name: "Confidence Score",
                value: loading ? "—" : String(avgConfidence),
                verdict: getVerdict(avgConfidence, "confidence"),
              },
              {
                key: "eye",
                name: "Eye Contact",
                value: loading ? "—" : `${avgEye}%`,
                verdict: getVerdict(avgEye, "eye_contact"),
              },
              {
                key: "fillers",
                name: "Filler Words",
                value: loading ? "—" : Number.isFinite(fillersVal) ? `${fillersVal}/min` : "—",
                verdict: getVerdict(Number.isFinite(fillersVal) ? fillersVal : 999, "filler_words"),
              },
              {
                key: "energy",
                name: "Energy Score",
                value: loading ? "—" : String(avgEnergy),
                verdict: getVerdict(avgEnergy, "energy"),
              },
            ] as const;

            return items.map((it) => {
              const tone = verdictTone(it.verdict);
              return (
                <div
                  key={it.key}
                  className={`rounded-2xl bg-white/5 border border-white/10 p-4 ${tone.borderLeft} border-l-4`}
                >
                  <div className="text-[12px] uppercase tracking-wide text-slate-400">{it.name}</div>
                  <div className="mt-2 text-3xl font-bold tabular-nums text-white">{it.value}</div>
                  <div className={`mt-2 text-sm font-semibold ${tone.textTone}`}>{it.verdict}</div>
                </div>
              );
            });
          })()}
        </div>
      </section>

      <section id="channel-benchmark" className="mt-10 scroll-mt-8" aria-labelledby="channel-benchmark-heading">
        <h2 id="channel-benchmark-heading" className="text-lg font-semibold">
          Channel benchmark
        </h2>
        <p className="mt-1 text-sm text-slate-400 max-w-3xl">
          Numbers below describe <span className="text-slate-300">this entire channel</span>: typical values, where most videos sit, and the full spread. Each metric counts how many completed videos could be scored.
        </p>
        {loading ? (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-white/5 border border-white/10 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {(() => {
              const b = report?.benchmark ?? {};
              const items = [
                { key: "confidence", label: "Confidence", fmt: { format: "int" as const }, tone: "text-cyan-200" },
                { key: "energy", label: "Energy", fmt: { format: "int" as const }, tone: "text-emerald-200" },
                { key: "wpm", label: "WPM", fmt: { format: "int" as const, suffix: " WPM" }, tone: "text-amber-200" },
                { key: "eye_contact_pct", label: "Eye contact", fmt: { format: "pct0" as const }, tone: "text-indigo-200" },
                { key: "fillers_per_min", label: "Fillers", fmt: { format: "float1" as const, suffix: "/min" }, tone: "text-rose-200" },
                { key: "gestures_per_min", label: "Gestures", fmt: { format: "float1" as const, suffix: "/min" }, tone: "text-teal-200" },
                { key: "expression_changes_per_min", label: "Expressions", fmt: { format: "float1" as const, suffix: "/min" }, tone: "text-sky-200" },
                { key: "tonal", label: "Tonal score", fmt: { format: "float1" as const }, tone: "text-fuchsia-200" },
              ] as const;
              return items.map((it) => {
                const row = (b as any)[it.key] as
                  | {
                      n?: number;
                      missing?: number;
                      p10?: number | null;
                      p25?: number | null;
                      p50?: number | null;
                      p75?: number | null;
                      p90?: number | null;
                      hist?: { labels?: string[]; counts?: number[] };
                    }
                  | undefined;
                const n = Number(row?.n ?? 0) || 0;
                const missing = Number(row?.missing ?? 0) || 0;
                const p10 = row?.p10 ?? null;
                const p25 = row?.p25 ?? null;
                const p50 = row?.p50 ?? null;
                const p75 = row?.p75 ?? null;
                const p90 = row?.p90 ?? null;
                const histLabels = (row?.hist?.labels ?? []) as string[];
                const histCounts = (row?.hist?.counts ?? []) as number[];
                return (
                  <div key={it.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold">{it.label}</div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {n} scored
                        {missing ? <span className="text-slate-600"> · {missing} not scored</span> : null}
                      </div>
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">Typical</div>
                    <div className={`mt-0.5 text-2xl font-bold tabular-nums ${it.tone}`}>{fmtBench(p50, it.fmt)}</div>
                    <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">Usual range (most videos)</div>
                    <div className="mt-0.5 text-xs text-slate-300 tabular-nums">
                      {fmtBench(p25, it.fmt)} – {fmtBench(p75, it.fmt)}
                    </div>
                    <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">Full spread (rare lows &amp; highs)</div>
                    <div className="mt-0.5 text-[10px] text-slate-500 tabular-nums">
                      {fmtBench(p10, it.fmt)} – {fmtBench(p90, it.fmt)}
                    </div>
                    <HistBar labels={histLabels} counts={histCounts} />
                  </div>
                );
              });
            })()}
          </div>
        )}
      </section>

      <section className="mt-8 scroll-mt-8" aria-labelledby="coverage-heading">
        <h3 id="coverage-heading" className="text-sm font-semibold text-slate-200">
          How complete is the data?
        </h3>
        <p className="mt-1 text-xs text-slate-500 max-w-3xl">
          Per metric: how many completed videos could be scored, and how reliable the channel-wide picture is. Strong = many videos; Early = still building the picture.
        </p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-left text-slate-400 border-b border-white/10">
              <tr>
                <th className="px-4 py-3">Metric</th>
                <th className="px-4 py-3">Videos scored</th>
                <th className="px-4 py-3">Couldn&apos;t score</th>
                <th className="px-4 py-3">Share of completed</th>
                <th className="px-4 py-3">Reliability</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const completed = Math.max(0, Number(report?.completed_videos ?? 0) || 0);
                const b = report?.benchmark ?? {};
                const rows = [
                  { key: "confidence", label: "Confidence" },
                  { key: "energy", label: "Energy" },
                  { key: "wpm", label: "WPM" },
                  { key: "eye_contact_pct", label: "Eye contact" },
                  { key: "fillers_per_min", label: "Fillers / min" },
                  { key: "gestures_per_min", label: "Gestures / min" },
                  { key: "expression_changes_per_min", label: "Expressions / min" },
                  { key: "tonal", label: "Tonal score" },
                ] as const;

                const stabilityBadge = (n: number) => {
                  if (n >= 20) return { text: "Strong", cls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" };
                  if (n >= 10) return { text: "OK", cls: "border-amber-400/30 bg-amber-400/10 text-amber-200" };
                  return { text: "Early", cls: "border-white/15 bg-white/5 text-slate-300" };
                };

                return rows.map((r) => {
                  const row = (b as any)[r.key] as { n?: number; missing?: number } | undefined;
                  const n = Math.max(0, Number(row?.n ?? 0) || 0);
                  const missing = Math.max(0, Number(row?.missing ?? Math.max(0, completed - n)) || 0);
                  const coverage = completed > 0 ? Math.round((n / completed) * 100) : 0;
                  const st = stabilityBadge(n);
                  return (
                    <tr key={r.key} className="border-b border-white/5">
                      <td className="px-4 py-3 text-slate-200">{r.label}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-200">{n}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-400">{missing}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-200">{completed ? `${coverage}%` : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs border ${st.cls}`}>{st.text}</span>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </section>

      <section id="metrics-at-a-glance" className="mt-10 scroll-mt-8" aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="text-lg font-semibold">
          At a glance
        </h2>
        <p className="mt-1 text-sm text-slate-400 max-w-3xl">
          Same channel-wide typical values in card form. Click a card for definitions and the numbers behind the benchmark—not a single video.
        </p>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <MetricsGrid
            show
            currentStepId="channel"
            demoMetricValue={Number(aggregatedMetricCards.wpm) || 0}
            selectedMetric={""}
            onSelectMetric={() => {}}
            detailMode="benchmark"
            cards={aggregatedMetricCards}
            events={[]}
            durationSec={0}
            eyeNotMeasurable={false}
            metricDetailContext={null}
            channelBenchmark={
              report?.benchmark
                ? {
                    completedVideos: Math.max(0, Number(report?.completed_videos ?? 0) || 0),
                    benchmark: report.benchmark,
                  }
                : null
            }
          />
        </div>
      </section>

      <section
        id="examples-and-videos"
        className="mt-12 scroll-mt-8 pt-8 border-t border-white/10"
        aria-labelledby="examples-heading"
      >
        <h2 id="examples-heading" className="text-lg font-semibold">
          Examples &amp; individual videos
        </h2>
        <p className="mt-1 text-sm text-slate-400 max-w-3xl">
          These are specific uploads—not the channel benchmark. Use them to spot patterns or open a full analysis for one recording.
        </p>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
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
          <h3 className="text-base font-semibold text-slate-200">Recurring notes (from video analyses)</h3>
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
        <h3 className="text-base font-semibold text-slate-200 mb-2">All videos ({totals.totalVideos})</h3>
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
      </section>
    </div>
  );
}
