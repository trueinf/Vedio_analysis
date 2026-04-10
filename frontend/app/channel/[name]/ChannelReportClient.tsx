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
              { label: "Benchmark Confidence (p50)", value: loading ? "—" : String(totals.benchConf) },
              { label: "Benchmark Energy (p50)", value: loading ? "—" : String(totals.benchEnergy) },
              { label: "Benchmark WPM (p50)", value: loading ? "—" : String(totals.benchWpm) },
              { label: "Benchmark Eye (p50)", value: loading ? "—" : `${totals.benchEye}%` },
              {
                label: "Total runtime",
                value: loading ? "—" : formatDurationChip(Number(report?.total_duration_sec ?? 0)),
              },
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
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold">All-time benchmark</h2>
        <p className="mt-1 text-sm text-slate-400">
          Median (p50) with typical range (p25–p75). Sample size (n) is per-metric across all completed videos.
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
                        n={n}
                        {missing ? <span className="text-slate-600"> · missing {missing}</span> : null}
                      </div>
                    </div>
                    <div className={`mt-2 text-2xl font-bold tabular-nums ${it.tone}`}>{fmtBench(p50, it.fmt)}</div>
                    <div className="mt-1 text-xs text-slate-400 tabular-nums">
                      {fmtBench(p25, it.fmt)} – {fmtBench(p75, it.fmt)}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500 tabular-nums">
                      p10 {fmtBench(p10, it.fmt)} · p90 {fmtBench(p90, it.fmt)}
                    </div>
                    <HistBar labels={histLabels} counts={histCounts} />
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-200">Coverage &amp; reliability</h3>
        <p className="mt-1 text-xs text-slate-500">
          Coverage is per metric across all completed videos. Stability is a heuristic: Strong (n≥20), OK (10–19), Early (&lt;10).
        </p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-left text-slate-400 border-b border-white/10">
              <tr>
                <th className="px-4 py-3">Metric</th>
                <th className="px-4 py-3">n</th>
                <th className="px-4 py-3">Missing</th>
                <th className="px-4 py-3">Coverage</th>
                <th className="px-4 py-3">Stability</th>
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
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold">Detailed metrics</h2>
        <p className="mt-1 text-sm text-slate-400">
          Click any metric for a benchmark breakdown (based on all completed videos).
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
          />
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
