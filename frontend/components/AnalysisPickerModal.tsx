"use client";

import { useMemo, useState } from "react";
import type { AnalysisSummary } from "../lib/supabase";
import { AnalysisCard } from "./AnalysisCard";
import { Button } from "./ui";

export function AnalysisPickerModal(props: {
  open: boolean;
  analyses: AnalysisSummary[];
  excludeJobId?: string;
  onClose: () => void;
  onSelect: (analysis: AnalysisSummary) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (props.analyses || [])
      .filter((a) => a.status === "completed")
      .filter((a) => (props.excludeJobId ? a.job_id !== props.excludeJobId : true))
      .filter((a) => {
        if (!needle) return true;
        return (
          String(a.original_filename || "").toLowerCase().includes(needle) ||
          String(a.channel_name || "").toLowerCase().includes(needle) ||
          String(a.job_id || "").toLowerCase().includes(needle)
        );
      });
  }, [props.analyses, props.excludeJobId, q]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-black/70" onClick={props.onClose} />
      <div className="absolute inset-x-0 top-10 mx-auto max-w-5xl bg-slate-950/90 border border-white/10 backdrop-blur rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="text-sm font-semibold">Select an analysis</div>
          <Button variant="premium-ghost" onClick={props.onClose}>
            Close ✕
          </Button>
        </div>
        <div className="p-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
          />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[70vh] overflow-auto pr-1">
            {filtered.map((a) => (
              <AnalysisCard
                key={a.job_id}
                analysis={a}
                onOpen={() => {
                  props.onSelect(a);
                  props.onClose();
                }}
              />
            ))}
          </div>
          {!filtered.length ? <div className="mt-4 text-sm text-slate-300">No completed analyses found.</div> : null}
        </div>
      </div>
    </div>
  );
}

