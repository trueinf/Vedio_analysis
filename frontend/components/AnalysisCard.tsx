"use client";

import Link from "next/link";
import { clsx } from "clsx";
import type { AnalysisSummary } from "../lib/supabase";

function statusColor(status: AnalysisSummary["status"]): string {
  if (status === "completed") return "text-emerald-300 bg-emerald-400/10 border-emerald-400/20";
  if (status === "failed") return "text-red-300 bg-red-400/10 border-red-400/20";
  if (status === "processing") return "text-cyan-300 bg-cyan-400/10 border-cyan-400/20";
  return "text-amber-300 bg-amber-400/10 border-amber-400/20";
}

export function AnalysisCard(props: {
  analysis: AnalysisSummary;
  onOpen: (jobId: string) => void;
}) {
  const a = props.analysis;
  return (
    <button
      type="button"
      onClick={() => props.onOpen(a.job_id)}
      className="text-left bg-white/5 border border-white/10 backdrop-blur rounded-2xl overflow-hidden hover:bg-white/7 transition-all"
    >
      <div className="h-28 bg-gradient-to-br from-white/10 to-white/0 border-b border-white/10 flex items-center justify-center text-slate-400 text-xs">
        Thumbnail
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" title={a.original_filename}>
              {a.original_filename || a.job_id}
            </div>
            <div className="mt-1 text-xs text-slate-400 truncate">{a.channel_name || "—"}</div>
          </div>
          <div className={clsx("text-[11px] px-2 py-1 rounded-lg border", statusColor(a.status))}>{a.status}</div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="text-slate-400">Score</div>
            <div className="font-semibold">{a.overall_score ?? 0}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="text-slate-400">WPM</div>
            <div className="font-semibold">{Math.round(a.wpm ?? 0)}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="text-slate-400">Eye</div>
            <div className="font-semibold">{Math.round((a.eye_contact_ratio ?? 0) * 100)}%</div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {a.created_at ? new Date(a.created_at).toLocaleString() : ""}
          </div>
          <Link
            href={`/compare?source=${encodeURIComponent(a.job_id)}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-cyan-300 hover:text-cyan-200"
          >
            Compare →
          </Link>
        </div>
      </div>
    </button>
  );
}

