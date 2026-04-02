"use client";

import { useEffect, useMemo, useState } from "react";
import { StatsBar } from "../../components/StatsBar";
import type { AnalysisSummary } from "@/lib/supabase";
import DashboardCard from "@/components/DashboardCard";
import { getApiBaseUrl } from "@/lib/api";

type StatusFilter = "all" | "queued" | "processing" | "completed" | "failed";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const base = getApiBaseUrl();
        const listRes = await fetch(`${base}/api/analyses?limit=500`, { cache: "no-store" });
        if (!listRes.ok) throw new Error(`Failed to load analyses (${listRes.status})`);
        const listJson = (await listRes.json()) as { analyses: AnalysisSummary[] };
        setAnalyses(listJson.analyses || []);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load dashboard");
        setAnalyses([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
    const nums = (key: keyof AnalysisSummary) => analyses.map((a) => Number(a[key] as any)).filter((n) => Number.isFinite(n));
    const avg = (arr: number[]) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);
    return {
      total: analyses.length,
      avgScore: avg(nums("overall_score")),
      avgWpm: avg(nums("wpm")),
      avgEye: avg(nums("eye_contact_ratio")),
    };
  }, [analyses]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold tracking-tight text-3xl">Dashboard</div>
          <div className="text-slate-300 text-sm">Browse analyses, open full results, and see trends</div>
        </div>
      </div>

      <div className="mt-6">
        <StatsBar
          total={stats.total}
          avgScore={stats.avgScore}
          avgWpm={stats.avgWpm}
          avgEyeContact={stats.avgEye}
          loading={loading}
          error={err}
        />
      </div>

      <div className="mt-6 flex flex-col md:flex-row md:items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search filename, channel, job id…"
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
        />
        <div className="flex items-center gap-2 flex-wrap">
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
        ) : err ? (
          <div className="text-red-400 text-sm">{err}</div>
        ) : filtered.length === 0 ? (
          <div className="text-slate-300 text-sm bg-white/5 border border-white/10 rounded-2xl p-6">
            No analyses found.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((a) => (
              <DashboardCard key={a.job_id} analysis={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

