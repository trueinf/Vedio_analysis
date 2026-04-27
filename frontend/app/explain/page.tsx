"use client";

import { useEffect, useMemo, useState } from "react";

import ChannelReportClient from "../channel/[name]/ChannelReportClient";
import { fetchChannelsSummary, type ChannelSummary } from "@/lib/api";
import { Card, PremiumField, PremiumChip, premiumSurfaceClass } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function ExplainPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [channels, setChannels] = useState<ChannelSummary[]>([]);

  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string>("");
  const [mode, setMode] = useState<"all" | "completed_only">("completed_only");

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

  const encodedName = selectedName ? encodeURIComponent(selectedName) : "";

  return (
    <div className="w-full max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-10 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Explanation</h1>
        <p className="text-sm text-slate-400 max-w-3xl">
          Pick a channel to see the live benchmark values (Typical, Usual range, Full spread) and click metric cards for
          definitions. This page uses the same data and logic as the Channel Benchmark view.
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

            <select
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none"
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
              disabled={loading || !filtered.length}
            >
              {filtered.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>

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
            <div className="rounded-2xl border border-white/10 bg-white/5">
              <ChannelReportClient encodedName={encodedName} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

