"use client";

import Link from "next/link";
import type { AnalysisSummary } from "@/lib/supabase";
import { clsx } from "clsx";

function statusStyles(status: AnalysisSummary["status"]) {
  if (status === "completed") return "text-emerald-300 bg-emerald-400/10 border-emerald-400/20";
  if (status === "failed") return "text-red-300 bg-red-400/10 border-red-400/20";
  if (status === "processing") return "text-cyan-300 bg-cyan-400/10 border-cyan-400/20";
  return "text-slate-300 bg-white/5 border-white/10";
}

export default function DashboardCard(props: { analysis: AnalysisSummary }) {
  const a = props.analysis;
  const created = a.created_at ? new Date(a.created_at).toLocaleString() : "";
  const confidence = Number.isFinite(a.confidence_score) ? Math.round(a.confidence_score) : null;

  return (
    <Link
      href={`/video/${encodeURIComponent(a.job_id)}`}
      className="block text-left bg-white/5 border border-white/10 backdrop-blur rounded-2xl overflow-hidden hover:bg-white/7 transition-all"
    >
      <div className="h-28 bg-gradient-to-br from-white/10 to-white/0 border-b border-white/10 flex items-center justify-center text-slate-400 text-xs">
        Thumbnail
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate" title={a.original_filename || a.job_id}>
              {a.original_filename || a.job_id}
            </div>
            <div className="mt-1 text-xs text-slate-400 truncate">{a.channel_name || "—"}</div>
          </div>
          <div className={clsx("text-[11px] px-2 py-1 rounded-lg border shrink-0", statusStyles(a.status))}>{a.status}</div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="text-[11px] text-slate-400">Confidence</div>
            <div className="text-sm font-semibold">{confidence == null ? "—" : `${confidence}`}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="text-[11px] text-slate-400">Energy</div>
            <div className="text-sm font-semibold">{Number.isFinite(a.energy_score) ? Math.round(a.energy_score) : "—"}</div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-slate-500 truncate">{created}</div>
          <div className="text-xs text-cyan-300 hover:text-cyan-200 whitespace-nowrap">Open →</div>
        </div>
      </div>
    </Link>
  );
}

