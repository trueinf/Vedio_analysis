"use client";

import { useEffect, useMemo, useState } from "react";
import type { AnalysisSummary } from "../../lib/supabase";
import { AnalysisCard } from "../../components/AnalysisCard";
import { AnalysisDrawer } from "../../components/AnalysisDrawer";
import { StatsBar } from "../../components/StatsBar";
import { TrendCharts } from "../../components/TrendCharts";

type StatusFilter = "all" | "completed" | "processing" | "failed";

export default function DashboardPage() {
  const [highlight, setHighlight] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [stats, setStats] = useState<{ total: number; avgScore: number; avgWpm: number; avgEye: number } | null>(null);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    // Avoid Next.js build-time CSR bailout requirements for useSearchParams by reading from window.
    if (typeof window === "undefined") return;
    const h = new URLSearchParams(window.location.search).get("highlight") || "";
    setHighlight(h);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
        const [listRes, statsRes] = await Promise.all([
          fetch(`${base}/api/supabase/analyses?limit=500&offset=0`, { cache: "no-store" }),
          fetch(`${base}/api/supabase/stats`, { cache: "no-store" }),
        ]);
        if (!listRes.ok) throw new Error(`Failed to load analyses (${listRes.status})`);
        const listJson = (await listRes.json()) as { analyses: AnalysisSummary[] };
        setAnalyses(listJson.analyses || []);

        if (statsRes.ok) {
          const s = await statsRes.json();
          setStats({
            total: Number(s.total_analyses || 0),
            avgScore: Number(s.avg_overall_score || 0),
            avgWpm: Number(s.avg_wpm || 0),
            avgEye: Number(s.avg_eye_contact || 0),
          });
        } else {
          setStats({ total: listJson.analyses?.length || 0, avgScore: 0, avgWpm: 0, avgEye: 0 });
        }
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load dashboard");
        setAnalyses([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!highlight) return;
    setOpenJobId(highlight);
    setDrawerOpen(true);
  }, [highlight]);

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
          total={stats?.total ?? analyses.length}
          avgScore={stats?.avgScore ?? 0}
          avgWpm={stats?.avgWpm ?? 0}
          avgEyeContact={stats?.avgEye ?? 0}
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
        <div className="flex items-center gap-2">
          {(["all", "completed", "processing", "failed"] as const).map((s) => (
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

      <div className="mt-6">
        <TrendCharts analyses={analyses} />
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
              <AnalysisCard
                key={a.job_id}
                analysis={a}
                onOpen={(jobId) => {
                  setOpenJobId(jobId);
                  setDrawerOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <AnalysisDrawer
        open={drawerOpen}
        jobId={openJobId}
        onClose={() => {
          setDrawerOpen(false);
          setOpenJobId(null);
        }}
        highlightJobId={highlight}
      />
    </div>
  );
}

