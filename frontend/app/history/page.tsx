"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnalysisGrid } from "@/components/AnalysisGrid";
import { listAnalyses } from "@/lib/api";
import type { AnalysisRow } from "@/lib/api";

function HistoryContent() {
  const searchParams = useSearchParams();
  const channel = searchParams.get("channel")?.trim() || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const listJson = await listAnalyses(120);
        setAnalyses(listJson.analyses || []);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load history");
        setAnalyses([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold tracking-tight text-3xl">History</div>
          <div className="text-slate-300 text-sm">Browse analyses, open full results, and see trends</div>
        </div>
      </div>

      <AnalysisGrid
        analyses={analyses}
        loading={loading}
        error={err}
        defaultChannel={channel || undefined}
      />
    </div>
  );
}

function HistoryFallback() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="font-semibold tracking-tight text-3xl">History</div>
      <div className="mt-6 h-32 rounded-2xl bg-white/5 border border-white/10 animate-pulse" />
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryFallback />}>
      <HistoryContent />
    </Suspense>
  );
}
