"use client";

import { useEffect, useMemo, useState } from "react";
import { StatsBar } from "./StatsBar";
import DashboardCard from "@/components/DashboardCard";
import type { AnalysisRow } from "@/lib/api";

type StatusFilter = "all" | "queued" | "processing" | "completed" | "failed";

export type AnalysisGridProps = {
  analyses: AnalysisRow[];
  loading: boolean;
  error?: string;
  /** Pre-fills search when landing from channel deck (?channel=) */
  defaultChannel?: string;
  /** Hide filename/channel search (e.g. on a dedicated channel page). */
  hideChannelFilter?: boolean;
  /** Hide the stats bar (e.g. when the page already shows channel-level stats). */
  hideStatsBar?: boolean;
};

export function AnalysisGrid(props: AnalysisGridProps) {
  const { analyses, loading, error = "", defaultChannel, hideChannelFilter = false, hideStatsBar = false } = props;

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    if (defaultChannel != null && String(defaultChannel).trim() !== "") {
      setQ(String(defaultChannel).trim());
    }
  }, [defaultChannel]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (analyses || [])
      .filter((a) => (filter === "all" ? true : a.status === filter))
      .filter((a) => {
        if (!needle) return true;
        return (
          String(a.original_filename || "").toLowerCase().includes(needle) ||
          String(a.channel_name || "").toLowerCase().includes(needle) ||
          String(a.job_id || "").toLowerCase().includes(needle)
        );
      });
  }, [analyses, q, filter]);

  const stats = useMemo(() => {
    if (!analyses.length) return { total: 0, avgScore: 0, avgWpm: 0, avgEye: 0 };
    const safeNum = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const readScore = (a: any) =>
      safeNum(a?.overall_score) && Number(a.overall_score) > 0
        ? Number(a.overall_score)
        : safeNum(a?.result_json?.summary?.overall_score) ?? 0;
    const readWpm = (a: any) =>
      safeNum(a?.wpm) && Number(a.wpm) > 0 ? Number(a.wpm) : safeNum(a?.result_json?.cards?.speech_rate?.wpm) ?? 0;
    const readEye = (a: any) =>
      safeNum(a?.eye_contact_ratio) && Number(a.eye_contact_ratio) > 0
        ? Number(a.eye_contact_ratio)
        : safeNum(a?.result_json?.cards?.eye_contact?.on_camera_ratio) ?? 0;

    const avg = (arr: number[]) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);
    const completed = analyses.filter((a: any) => a?.status === "completed");
    const pool = completed.length ? completed : analyses;
    const scores = pool.map(readScore).filter((n: number) => Number.isFinite(n) && n > 0);
    const wpms = pool.map(readWpm).filter((n: number) => Number.isFinite(n) && n > 0);
    const eyes = pool.map(readEye).filter((n: number) => Number.isFinite(n) && n > 0);
    return {
      total: analyses.length,
      avgScore: avg(scores),
      avgWpm: avg(wpms),
      avgEye: avg(eyes),
    };
  }, [analyses]);

  return (
    <>
      {!hideStatsBar ? (
        <div className="mt-6">
          <StatsBar
            total={stats.total}
            avgScore={stats.avgScore}
            avgWpm={stats.avgWpm}
            avgEyeContact={stats.avgEye}
            loading={loading}
            error={error}
          />
        </div>
      ) : null}

      <div className={`flex flex-col md:flex-row md:items-center gap-3 ${hideStatsBar ? "mt-0" : "mt-6"}`}>
        {!hideChannelFilter ? (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search filename, channel, job id…"
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
        />
        ) : null}
        <div className={`flex items-center gap-2 flex-wrap ${hideChannelFilter ? "w-full" : ""}`}>
          {(["all", "queued", "processing", "completed", "failed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-3 py-2 rounded-xl text-sm border transition-all ${
                filter === s ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 bg-white/5 border border-white/10 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-red-400 text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-slate-300 text-sm bg-white/5 border border-white/10 rounded-2xl p-6">
            No analyses found.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((a) => (
              <DashboardCard key={String(a.job_id || a.id)} analysis={a} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
