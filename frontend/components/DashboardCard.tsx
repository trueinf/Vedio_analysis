"use client";

import Link from "next/link";
import { clsx } from "clsx";
import type { AnalysisRow } from "@/lib/api";

function statusStyles(status: AnalysisRow["status"]) {
  if (status === "completed") return "text-emerald-300 bg-emerald-400/10 border-emerald-400/20";
  if (status === "failed") return "text-red-300 bg-red-400/10 border-red-400/20";
  if (status === "processing") return "text-cyan-300 bg-cyan-400/10 border-cyan-400/20";
  return "text-slate-300 bg-white/5 border-white/10";
}

function truncateId(id: string) {
  const s = String(id || "");
  return s.length > 8 ? `${s.slice(0, 8)}...` : s;
}

function safeNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function DashboardCard(props: { analysis: AnalysisRow }) {
  const a = props.analysis;
  const created = a.created_at ? new Date(a.created_at).toLocaleString() : "";
  const rj: any = a.result_json || null;
  const confidence =
    safeNum(a.confidence_score) ??
    safeNum(rj?.confidence_score) ??
    null;
  const energy =
    safeNum(a.energy_score) ??
    safeNum(rj?.energy_score) ??
    null;

  const title = String(a.original_filename || a.title || "").trim() || truncateId(String(a.job_id || a.id || ""));

  return (
    <Link
      href={`/video/${encodeURIComponent(String(a.job_id || a.id || ""))}`}
      className="block text-left bg-white/5 border border-white/10 backdrop-blur rounded-2xl overflow-hidden hover:bg-white/7 transition-all"
    >
      <div className="h-28 bg-gradient-to-br from-white/10 to-white/0 border-b border-white/10 flex items-center justify-center text-slate-400 text-xs">
        Thumbnail
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate" title={title}>
              {title}
            </div>
            <div className="mt-1 text-xs text-slate-400 truncate">{a.channel_name || "—"}</div>
          </div>
          <div className={clsx("text-[11px] px-2 py-1 rounded-lg border shrink-0", statusStyles(a.status))}>{a.status}</div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="text-[11px] text-slate-400">Confidence</div>
            <div className="text-sm font-semibold">{confidence == null ? "—" : `${Math.round(confidence)}`}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="text-[11px] text-slate-400">Energy</div>
            <div className="text-sm font-semibold">{energy == null ? "—" : `${Math.round(energy)}`}</div>
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

