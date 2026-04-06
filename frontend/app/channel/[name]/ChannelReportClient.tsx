"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AnalysisGrid } from "@/components/AnalysisGrid";
import type { AnalysisRow, ChannelSummary } from "@/lib/api";
import {
  clearChannelAISummaryCache,
  fetchChannelAISummary,
  fetchChannelsSummary,
  listAnalysesForChannel,
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

function roundAvg(arr: (number | null | undefined)[]): number {
  const nums = arr.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function eyeDisplayPct(raw: number | null | undefined): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function collectCoachComments(rows: AnalysisRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.status !== "completed") continue;
    const rj = r.result_json as { coach_comments?: { comment?: string }[] } | null | undefined;
    const cc = rj?.coach_comments;
    if (!Array.isArray(cc)) continue;
    for (const c of cc) {
      const t = typeof c?.comment === "string" ? c.comment.trim() : "";
      if (t) out.push(t);
    }
  }
  return out;
}

function topPatterns(comments: string[], top = 5): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of comments) {
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

type TrendPoint = { x: string; t: number; confidence: number | null; energy: number | null; wpm: number | null };

function buildTrendPoints(rows: AnalysisRow[]): TrendPoint[] {
  const completed = rows.filter((r) => r.status === "completed");
  return completed.map((r) => {
    const t = new Date(r.created_at).getTime();
    return {
      x: new Date(r.created_at).toLocaleDateString(),
      t,
      confidence: r.confidence_score != null ? Number(r.confidence_score) : null,
      energy: r.energy_score != null ? Number(r.energy_score) : null,
      wpm: r.wpm != null ? Number(r.wpm) : null,
    };
  });
}

const chartTooltip = {
  contentStyle: { background: "rgba(2,6,23,0.92)", border: "1px solid rgba(255,255,255,0.1)" },
  labelStyle: { color: "#94a3b8" },
};

function twoBucketDelta(
  rows: AnalysisRow[],
  pick: (a: AnalysisRow) => number | null
): number | null {
  const sorted = rows
    .filter((r) => r.status === "completed")
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const withScores = sorted
    .map((r) => {
      const v = pick(r);
      return v != null && Number.isFinite(v) ? { v: Number(v) } : null;
    })
    .filter((x): x is { v: number } => x != null);
  if (withScores.length < 10) return null;
  const latest = withScores.slice(0, 5);
  const prev = withScores.slice(5, 10);
  const recent = latest.reduce((s, x) => s + x.v, 0) / 5;
  const previous = prev.reduce((s, x) => s + x.v, 0) / 5;
  return recent - previous;
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
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [summaryMatch, setSummaryMatch] = useState<ChannelSummary | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameEditErr, setNameEditErr] = useState("");
  const [renaming, setRenaming] = useState(false);
  const nameErrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [aiSummary, setAiSummary] = useState("");
  const [aiSummaryLoading, setAiSummaryLoading] = useState(true);
  const [aiSummaryError, setAiSummaryError] = useState("");

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
          listAnalysesForChannel(rawName.trim(), true),
          fetchChannelAISummary(rawName.trim()),
        ]);
        if (!alive) return;
        const s0 = settled[0];
        const s1 = settled[1];
        const s2 = settled[2];

        if (s0.status === "fulfilled" && s1.status === "fulfilled") {
          const sumJson = s0.value;
          const chJson = s1.value;
          const key = rawName.trim().toLowerCase();
          const ch =
            (sumJson.channels || []).find((c) => c.name.trim().toLowerCase() === key) ?? null;
          setSummaryMatch(ch);
          const rows = (chJson.analyses || []).slice().sort((a, b) => {
            const ta = new Date(a.created_at).getTime();
            const tb = new Date(b.created_at).getTime();
            return ta - tb;
          });
          setAnalyses(rows);
          setErr("");
        } else {
          const msg =
            s0.status === "rejected"
              ? String(s0.reason instanceof Error ? s0.reason.message : s0.reason)
              : s1.status === "rejected"
                ? String(s1.reason instanceof Error ? s1.reason.message : s1.reason)
                : "Failed to load channel";
          setErr(msg);
          setAnalyses([]);
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
        setAnalyses([]);
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
    return () => {
      if (nameErrTimerRef.current) clearTimeout(nameErrTimerRef.current);
    };
  }, []);

  const displayName = summaryMatch?.name?.trim() || rawName.trim() || "Channel";
  const hue = hashHue(displayName);

  const completedForStats = useMemo(
    () => analyses.filter((a) => a.status === "completed"),
    [analyses]
  );

  const avgConf = roundAvg(completedForStats.map((a) => a.confidence_score));
  const avgEnergy = roundAvg(completedForStats.map((a) => a.energy_score));
  const avgWpm = roundAvg(completedForStats.map((a) => a.wpm));
  const eyeVals = completedForStats.map((a) => eyeDisplayPct(a.eye_contact_ratio)).filter((n): n is number => n != null);
  const avgEye = eyeVals.length ? Math.round(eyeVals.reduce((a, b) => a + b, 0) / eyeVals.length) : 0;

  const earliest = useMemo(() => {
    if (!analyses.length) return null;
    let min = Infinity;
    for (const a of analyses) {
      const t = new Date(a.created_at).getTime();
      if (Number.isFinite(t) && t < min) min = t;
    }
    return Number.isFinite(min) ? new Date(min) : null;
  }, [analyses]);

  const activeSince =
    earliest != null
      ? earliest.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : "—";

  const trendPoints = useMemo(() => buildTrendPoints(analyses), [analyses]);
  const avgConfLine = trendPoints.filter((p) => p.confidence != null).length
    ? Math.round(
        trendPoints.reduce((s, p) => s + (p.confidence ?? 0), 0) /
          trendPoints.filter((p) => p.confidence != null).length
      )
    : avgConf;
  const avgEnergyLine = trendPoints.filter((p) => p.energy != null).length
    ? Math.round(
        trendPoints.reduce((s, p) => s + (p.energy ?? 0), 0) /
          trendPoints.filter((p) => p.energy != null).length
      )
    : avgEnergy;
  const avgWpmLine = trendPoints.filter((p) => p.wpm != null).length
    ? Math.round(
        trendPoints.reduce((s, p) => s + (p.wpm ?? 0), 0) / trendPoints.filter((p) => p.wpm != null).length
      )
    : avgWpm;

  const ranked = useMemo(() => {
    const withScore = completedForStats
      .map((a) => ({
        a,
        s: a.confidence_score != null ? Number(a.confidence_score) : null,
      }))
      .filter((x) => x.s != null && Number.isFinite(x.s)) as { a: AnalysisRow; s: number }[];
    const top = withScore.slice().sort((x, y) => y.s - x.s).slice(0, 3);
    const bottom = withScore.slice().sort((x, y) => x.s - y.s).slice(0, 3);
    return { top, bottom };
  }, [completedForStats]);

  const coachPatterns = useMemo(() => {
    const comments = collectCoachComments(analyses);
    return topPatterns(comments, 5);
  }, [analyses]);

  const maxPatternCount = coachPatterns.length ? Math.max(...coachPatterns.map((p) => p.count)) : 1;

  const thumbUrl = summaryMatch?.thumbnailUrl?.trim() || null;

  const completedCount = useMemo(() => analyses.filter((a) => a.status === "completed").length, [analyses]);

  const confDelta = useMemo(
    () =>
      twoBucketDelta(analyses, (a) =>
        a.confidence_score != null && Number.isFinite(Number(a.confidence_score))
          ? Number(a.confidence_score)
          : null
      ),
    [analyses]
  );
  const energyDelta = useMemo(
    () =>
      twoBucketDelta(analyses, (a) =>
        a.energy_score != null && Number.isFinite(Number(a.energy_score)) ? Number(a.energy_score) : null
      ),
    [analyses]
  );
  const wpmDelta = useMemo(
    () => twoBucketDelta(analyses, (a) => (a.wpm != null && Number.isFinite(Number(a.wpm)) ? Number(a.wpm) : null)),
    [analyses]
  );

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
            {analyses.length} video{analyses.length === 1 ? "" : "s"} · Active since {activeSince}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { label: "Avg Confidence", value: loading ? "—" : String(avgConf) },
              { label: "Avg Energy", value: loading ? "—" : String(avgEnergy) },
              { label: "Avg WPM", value: loading ? "—" : String(avgWpm) },
              { label: "Avg Eye Contact", value: loading ? "—" : `${avgEye}%` },
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

          {completedCount < 6 ? (
            <p className="mt-4 text-sm text-slate-500">Need 6+ videos for trend data.</p>
          ) : (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Trend</div>
              <TrendMetricLine label="Confidence" delta={confDelta} unit="pts" />
              <TrendMetricLine label="Energy" delta={energyDelta} unit="pts" />
              <TrendMetricLine label="WPM" delta={wpmDelta} unit="wpm" />
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
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendPoints}>
                    <XAxis dataKey="x" stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                    <Tooltip {...chartTooltip} />
                    <ReferenceLine y={avgConfLine} stroke="rgba(148,163,184,0.5)" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="confidence" stroke="#22d3ee" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs text-slate-400 mb-2">Energy</div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendPoints}>
                    <XAxis dataKey="x" stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                    <Tooltip {...chartTooltip} />
                    <ReferenceLine y={avgEnergyLine} stroke="rgba(148,163,184,0.5)" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="energy" stroke="#34d399" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-xs text-slate-400 mb-2">WPM</div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendPoints}>
                    <XAxis dataKey="x" stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 200]} stroke="rgba(148,163,184,0.6)" tick={{ fontSize: 10 }} />
                    <Tooltip {...chartTooltip} />
                    <ReferenceLine y={avgWpmLine} stroke="rgba(148,163,184,0.5)" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="wpm" stroke="#fbbf24" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="text-sm font-semibold text-emerald-300/90">Top 3 videos</div>
          <div className="mt-3 space-y-2">
            {ranked.top.length === 0 ? (
              <div className="text-sm text-slate-500">No scored videos yet.</div>
            ) : (
              ranked.top.map(({ a, s }) => (
                <div
                  key={String(a.job_id || a.id)}
                  className="flex items-center gap-3 bg-white/5 border border-emerald-500/20 rounded-xl p-2"
                >
                  <div className="w-14 h-10 rounded-lg bg-white/10 overflow-hidden shrink-0 border border-white/10">
                    {a.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{a.original_filename || a.title || a.job_id}</div>
                    <div className="text-xs text-emerald-200/90">{Math.round(s)}</div>
                  </div>
                  <Link
                    href={`/video/${encodeURIComponent(String(a.job_id || a.id))}`}
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
            {ranked.bottom.length === 0 ? (
              <div className="text-sm text-slate-500">No scored videos yet.</div>
            ) : (
              ranked.bottom.map(({ a, s }) => (
                <div
                  key={String(a.job_id || a.id)}
                  className="flex items-center gap-3 bg-white/5 border border-amber-500/20 rounded-xl p-2"
                >
                  <div className="w-14 h-10 rounded-lg bg-white/10 overflow-hidden shrink-0 border border-white/10">
                    {a.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{a.original_filename || a.title || a.job_id}</div>
                    <div className="text-xs text-amber-200/90">{Math.round(s)}</div>
                  </div>
                  <Link
                    href={`/video/${encodeURIComponent(String(a.job_id || a.id))}`}
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
              <div key={p.text} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-400 tabular-nums">[{p.count}]</span>
                  <span className="text-slate-100 flex-1 min-w-0">&quot;{p.text}&quot;</span>
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
        <h2 className="text-lg font-semibold mb-2">All videos ({analyses.length})</h2>
        <AnalysisGrid
          analyses={analyses}
          loading={loading}
          error={err}
          defaultChannel={rawName.trim()}
          hideChannelFilter
          hideStatsBar
        />
      </div>
    </div>
  );
}
