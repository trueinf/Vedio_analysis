"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchChannelReport, fetchChannelsSummary, type ChannelReport, type ChannelSummary } from "@/lib/api";
import { Card, PremiumField, PremiumChip, premiumSurfaceClass } from "@/components/ui";
import DarkSelect, { type DarkSelectOption } from "@/components/DarkSelect";
import { MetricDetailInline } from "@/components/MetricDetailInline";
import type { MetricDetailPayload, MetricCardsSnapshot } from "@/components/metricDetailContent";
import { buildBenchmarkMetricDetail } from "@/components/benchmarkMetricDetail";
import type { MetricKey } from "@/components/video-analysis-types";

export const dynamic = "force-dynamic";

export default function ExplainPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [channels, setChannels] = useState<ChannelSummary[]>([]);

  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string>("");
  const [mode, setMode] = useState<"all" | "completed_only">("completed_only");

  const [report, setReport] = useState<ChannelReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportErr, setReportErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const data = await fetchChannelsSummary();
        if (!alive) return;
        const rows = (data.channels || []) as ChannelSummary[];
        setChannels(rows);
        if (!selectedName && rows.length) {
          const withVideos = rows.find((c) => (c.totalVideos || 0) > 0) ?? rows[0];
          setSelectedName(withVideos?.name || "");
        }
      } catch (e: unknown) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "Failed to load channels");
        setChannels([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list =
      mode === "completed_only"
        ? channels.filter((c) => (c.completedCount || 0) > 0 || (c.completedCount as any) > 0)
        : channels;
    if (!q) return list;
    return list.filter((c) => String(c.name || "").toLowerCase().includes(q));
  }, [channels, query, mode]);

  const channelOptions: DarkSelectOption[] = useMemo(() => {
    return filtered.map((c) => ({ value: c.name, label: c.name }));
  }, [filtered]);

  const encodedName = selectedName ? encodeURIComponent(selectedName) : "";

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!selectedName) {
        setReport(null);
        return;
      }
      setLoadingReport(true);
      setReportErr("");
      try {
        const rep = await fetchChannelReport(selectedName);
        if (!alive) return;
        setReport(rep);
      } catch (e: unknown) {
        if (!alive) return;
        setReport(null);
        setReportErr(e instanceof Error ? e.message : "Failed to load channel report");
      } finally {
        if (alive) setLoadingReport(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedName]);

  const completedVideos = Math.max(0, Number(report?.completed_videos ?? 0) || 0);
  const benchmarkObj = report?.benchmark ?? null;

  const metricCards: MetricCardsSnapshot = useMemo(() => {
    const b: any = benchmarkObj || {};
    const wpm = b["wpm"]?.p50 ?? null;
    const eyePct = b["eye_contact_pct"]?.p50 ?? null;
    const fillers = b["fillers_per_min"]?.p50 ?? null;
    const gestures = b["gestures_per_min"]?.p50 ?? null;
    const tonalScore = b["tonal"]?.p50 ?? null;
    const expr = b["expression_changes_per_min"]?.p50 ?? null;

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
  }, [benchmarkObj]);

  function fmtInt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    return String(Math.round(Number(v)));
  }

  function fmtRangeInt(lo: number | null | undefined, hi: number | null | undefined): string {
    if (lo == null && hi == null) return "—";
    return `${fmtInt(lo)} – ${fmtInt(hi)}`;
  }

  function fmtEndsInt(low: number | null | undefined, high: number | null | undefined): string {
    if (low == null && high == null) return "—";
    return `Rarely below ${fmtInt(low)} · rarely above ${fmtInt(high)}`;
  }

  const inlineDetails = useMemo(() => {
    if (!benchmarkObj) return [] as MetricDetailPayload[];
    const keys: MetricKey[] = ["speech_rate", "filler_words", "eye_contact", "gestures", "expression_change", "tonal_variation"];
    const built = keys.map((k) => {
      const benchKey =
        k === "speech_rate"
          ? "wpm"
          : k === "filler_words"
            ? "fillers_per_min"
            : k === "eye_contact"
              ? "eye_contact_pct"
              : k === "gestures"
                ? "gestures_per_min"
                : k === "expression_change"
                  ? "expression_changes_per_min"
                  : "tonal";
      const row = (benchmarkObj as any)[benchKey] ?? null;
      return buildBenchmarkMetricDetail(k, metricCards, row, completedVideos);
    });
    // Add the two top-level score cards that are displayed in the benchmark grid.
    const buildScoreDetail = (title: "Confidence" | "Energy", benchKey: "confidence" | "energy"): MetricDetailPayload => {
      const row: any = (benchmarkObj as any)?.[benchKey] ?? null;
      const n = Math.max(0, Number(row?.n ?? 0) || 0);
      const missing = Math.max(0, Number(row?.missing ?? 0) || 0);
      const p50 = row?.p50 ?? null;
      const p25 = row?.p25 ?? null;
      const p75 = row?.p75 ?? null;
      const p10 = row?.p10 ?? null;
      const p90 = row?.p90 ?? null;

      const valueLine = p50 != null ? fmtInt(p50) : "—";
      const badgeText = n >= 20 ? "Strong sample" : n >= 10 ? "Moderate sample" : n > 0 ? "Early sample" : "No data";

      return {
        title,
        subtitle: "Whole-channel snapshot (all completed analyses)",
        valueLine,
        badgeText,
        interpretation:
          n <= 0
            ? `Not enough completed videos with ${title.toLowerCase()} scored to describe the channel yet.`
            : `This is the channel’s typical ${title.toLowerCase()} score—based on completed videos, not one clip. Usual range shows where most videos land; full spread captures rare lows and highs.`,
        targetRange:
          "Typical is the middle value across scored videos. Usual range is where most videos sit. Full spread captures unusually low and high ends across this channel’s uploads.",
        howMeasured:
          "These scores are computed per video during analysis. The benchmark aggregates every completed run saved under this channel name.",
        suggestions: [],
        timelineLines: ["This summarizes the whole channel. Open a single video report for moment-by-moment detail."],
        statsRows: [
          { label: "Typical (middle of the pack)", value: valueLine },
          { label: "Usual range (where most videos sit)", value: fmtRangeInt(p25, p75) },
          { label: "Full spread (rare lows and highs)", value: fmtEndsInt(p10, p90) },
          { label: "Videos scored for this metric", value: `${n}` },
          { label: "Could not score", value: missing ? String(missing) : "—" },
          { label: "Completed videos on channel", value: String(completedVideos) },
        ],
        detailSections: [],
      };
    };
    built.unshift(buildScoreDetail("Energy", "energy"));
    built.unshift(buildScoreDetail("Confidence", "confidence"));
    return built;
  }, [benchmarkObj, completedVideos, metricCards]);

  return (
    <div className="w-full max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-10 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Explanation</h1>
        <p className="text-sm text-slate-400 max-w-3xl">
          Pick a channel to see the live benchmark values and the detailed explanations for each metric. Explanations are
          always visible below.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-12 gap-4 items-start">
        <Card className={`col-span-12 lg:col-span-4 p-4 ${premiumSurfaceClass}`}>
          <div className="text-sm font-semibold">Select channel</div>
          <div className="text-xs text-slate-300 mt-1">Live values from your backend channel report</div>

          <div className="mt-3 flex flex-col gap-2">
            <PremiumField value={query} onChange={setQuery} placeholder="Search channels" />

            <div className="flex gap-2 text-xs">
              <PremiumChip active={mode === "completed_only"} onClick={() => setMode("completed_only")}>
                Completed only
              </PremiumChip>
              <PremiumChip active={mode === "all"} onClick={() => setMode("all")}>
                All
              </PremiumChip>
            </div>

            <DarkSelect
              value={selectedName}
              onChange={setSelectedName}
              options={channelOptions}
              disabled={loading || !channelOptions.length}
              placeholder="Choose a channel…"
              emptyLabel="No channels"
            />

            {err ? <div className="text-xs text-red-300 mt-1">{err}</div> : null}
            {!err && !loading && !filtered.length ? (
              <div className="text-xs text-slate-500 mt-1">No channels match your search.</div>
            ) : null}
          </div>
        </Card>

        <div className="col-span-12 lg:col-span-8">
          {!encodedName ? (
            <Card className={`p-6 ${premiumSurfaceClass}`}>
              <div className="text-sm text-slate-300">Select a channel to see the explanation.</div>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card className={`p-4 ${premiumSurfaceClass}`}>
                <div className="text-sm font-semibold">Live channel benchmark</div>
                <div className="text-xs text-slate-300 mt-1">
                  Typical values, usual range, and full spread for this channel. Explanations are shown below.
                </div>
                {loadingReport ? (
                  <div className="mt-4 text-sm text-slate-400">Loading channel report…</div>
                ) : reportErr ? (
                  <div className="mt-4 text-sm text-red-300">{reportErr}</div>
                ) : !benchmarkObj ? (
                  <div className="mt-4 text-sm text-slate-400">No benchmark data yet for this channel.</div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {(() => {
                      const b: any = benchmarkObj || {};
                      const items: { key: string; label: string; tone: string; suffix?: string }[] = [
                        { key: "confidence", label: "Confidence", tone: "text-cyan-200" },
                        { key: "energy", label: "Energy", tone: "text-emerald-200" },
                        { key: "wpm", label: "WPM", tone: "text-amber-200", suffix: " WPM" },
                        { key: "eye_contact_pct", label: "Eye contact", tone: "text-indigo-200", suffix: "%" },
                        { key: "fillers_per_min", label: "Fillers", tone: "text-rose-200", suffix: "/min" },
                        { key: "gestures_per_min", label: "Gestures", tone: "text-teal-200", suffix: "/min" },
                        { key: "expression_changes_per_min", label: "Expressions", tone: "text-sky-200", suffix: "/min" },
                        { key: "tonal", label: "Tonal score", tone: "text-fuchsia-200" },
                      ];
                      return items.map((it) => {
                        const row = b[it.key] as any;
                        const n = Number(row?.n ?? 0) || 0;
                        const p50 = row?.p50 ?? null;
                        const p25 = row?.p25 ?? null;
                        const p75 = row?.p75 ?? null;
                        const p10 = row?.p10 ?? null;
                        const p90 = row?.p90 ?? null;
                        const value =
                          it.key === "eye_contact_pct"
                            ? p50 != null && Number.isFinite(Number(p50))
                              ? `${Math.round(Number(p50))}%`
                              : "—"
                            : it.key === "fillers_per_min" || it.key === "gestures_per_min" || it.key === "expression_changes_per_min" || it.key === "tonal"
                              ? p50 != null && Number.isFinite(Number(p50))
                                ? `${Number(p50).toFixed(1)}${it.suffix ?? ""}`
                                : "—"
                              : p50 != null && Number.isFinite(Number(p50))
                                ? `${Math.round(Number(p50))}${it.suffix ?? ""}`
                                : "—";
                        const usual =
                          it.key === "eye_contact_pct"
                            ? `${fmtInt(p25)}% – ${fmtInt(p75)}%`
                            : it.key === "fillers_per_min" || it.key === "gestures_per_min" || it.key === "expression_changes_per_min" || it.key === "tonal"
                              ? `${p25 == null ? "—" : Number(p25).toFixed(1)}${it.suffix ?? ""} – ${p75 == null ? "—" : Number(p75).toFixed(1)}${it.suffix ?? ""}`
                              : `${fmtInt(p25)}${it.suffix ?? ""} – ${fmtInt(p75)}${it.suffix ?? ""}`;
                        const spread =
                          it.key === "eye_contact_pct"
                            ? `${fmtInt(p10)}% – ${fmtInt(p90)}%`
                            : it.key === "fillers_per_min" || it.key === "gestures_per_min" || it.key === "expression_changes_per_min" || it.key === "tonal"
                              ? `${p10 == null ? "—" : Number(p10).toFixed(1)}${it.suffix ?? ""} – ${p90 == null ? "—" : Number(p90).toFixed(1)}${it.suffix ?? ""}`
                              : `${fmtInt(p10)}${it.suffix ?? ""} – ${fmtInt(p90)}${it.suffix ?? ""}`;
                        return (
                          <div key={it.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="flex items-baseline justify-between gap-2">
                              <div className="text-sm font-semibold">{it.label}</div>
                              <div className="text-xs text-slate-500 tabular-nums">{n} scored</div>
                            </div>
                            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">Typical</div>
                            <div className={`mt-0.5 text-2xl font-bold tabular-nums ${it.tone}`}>{value}</div>
                            <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">Usual range (most videos)</div>
                            <div className="mt-0.5 text-xs text-slate-300 tabular-nums">{usual}</div>
                            <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">Full spread (rare lows &amp; highs)</div>
                            <div className="mt-0.5 text-[10px] text-slate-500 tabular-nums">{spread}</div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </Card>

              <Card className={`p-4 ${premiumSurfaceClass}`}>
                <div className="text-sm font-semibold">Metric explanations</div>
                <div className="text-xs text-slate-300 mt-1">Each explanation uses the live benchmark values above.</div>
                {loadingReport ? (
                  <div className="mt-4 text-sm text-slate-400">Loading…</div>
                ) : !inlineDetails.length ? (
                  <div className="mt-4 text-sm text-slate-400">No benchmark data yet.</div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-3">
                    {inlineDetails.map((d) => (
                      <MetricDetailInline key={d.title} detail={d} benchmarkMode />
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

