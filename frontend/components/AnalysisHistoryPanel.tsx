"use client";

import { useMemo, useState } from "react";
import { JobHistoryItem } from "../lib/api";
import { Card, PremiumChip, premiumSurfaceClass } from "./ui";

function formatDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export function AnalysisHistoryPanel(props: {
  jobs: JobHistoryItem[];
  activeJobId: string | null;
  onSelectJob: (jobId: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "completed" | "processing" | "failed">("all");
  const visibleJobs = useMemo(() => {
    if (filter === "all") return props.jobs;
    if (filter === "processing") return props.jobs.filter((j) => j.status === "processing" || j.status === "queued");
    return props.jobs.filter((j) => j.status === filter);
  }, [props.jobs, filter]);

  return (
    <Card className={`col-span-12 lg:col-span-3 lg:row-span-2 p-4 h-full lg:ml-2 ${premiumSurfaceClass}`}>
      <div className="text-sm font-semibold">Analysis History</div>
      <div className="text-xs text-slate-300 mt-1">All analyses with status. Reopen any completed result.</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <PremiumChip active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </PremiumChip>
        <PremiumChip active={filter === "completed"} onClick={() => setFilter("completed")}>
          Completed
        </PremiumChip>
        <PremiumChip active={filter === "processing"} onClick={() => setFilter("processing")}>
          Processing
        </PremiumChip>
        <PremiumChip active={filter === "failed"} onClick={() => setFilter("failed")}>
          Failed
        </PremiumChip>
      </div>
      <div className="mt-3 space-y-2 max-h-[620px] overflow-auto pr-1">
        {visibleJobs.length ? (
          visibleJobs.map((j) => {
            const isActive = props.activeJobId === j.id;
            const statusColor =
              j.status === "completed"
                ? "text-emerald-300"
                : j.status === "failed"
                ? "text-red-300"
                : j.status === "processing"
                ? "text-cyan-300"
                : "text-amber-300";
            return (
              <button
                key={j.id}
                type="button"
                className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                  isActive
                    ? "border-cyan-300/50 bg-cyan-500/15"
                    : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
                onClick={() => props.onSelectJob(j.id)}
              >
                <div className="text-xs font-semibold truncate">{j.original_filename || j.id}</div>
                <div className={`text-[11px] mt-1 ${statusColor}`}>
                  {j.status} {j.stage ? `· ${j.stage}` : ""}
                </div>
                <div className="text-[11px] text-slate-300 mt-1">
                  {Math.round((j.progress || 0) * 100)}% · {j.duration_sec || 0}s
                </div>
                <div className="text-[11px] text-slate-400 mt-1">{formatDate(j.created_at)}</div>
                <div className="text-[11px] mt-1 text-slate-300">
                  {j.has_result ? "Result available" : "Result not ready"}
                </div>
              </button>
            );
          })
        ) : (
          <div className="text-xs text-slate-300">No analyses found for this filter.</div>
        )}
      </div>
    </Card>
  );
}

