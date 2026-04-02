import { redirect } from "next/navigation";

export default function ComparisonRedirectPage() {
  redirect("/compare");
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, PremiumField, premiumSurfaceClass } from "../../components/ui";
import type { AnalysisSummary } from "../../lib/supabase";
import { AnalysisPickerModal } from "../../components/AnalysisPickerModal";
import { ComparisonReport } from "../../components/ComparisonReport";

type Mode = "library" | "channel" | "niche";

export default function ComparisonPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSide, setPickerSide] = useState<"source" | "target">("source");

  const [source, setSource] = useState<AnalysisSummary | null>(null);
  const [target, setTarget] = useState<AnalysisSummary | null>(null);

  const [mode, setMode] = useState<Mode>("library");
  const [competitorChannel, setCompetitorChannel] = useState("");
  const [niche, setNiche] = useState("education");
  const [goal, setGoal] = useState<"retention" | "clarity" | "conversion" | "confidence">("retention");
  const [platform, setPlatform] = useState<"youtube_long" | "youtube_shorts">("youtube_long");

  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);

  const completed = useMemo(() => analyses.filter((a) => a.status === "completed"), [analyses]);

  useEffect(() => {
    // read ?source=job_id from URL (no useSearchParams to keep build happy)
    if (typeof window === "undefined") return;
    const src = new URLSearchParams(window.location.search).get("source") || "";
    if (!src) return;
    // We'll set it after analyses load.
    (window as any).__preselectSource = src;
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
        const res = await fetch(`${base}/api/supabase/analyses?limit=500&offset=0`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load analyses (${res.status})`);
        const data = (await res.json()) as { analyses: AnalysisSummary[] };
        setAnalyses(data.analyses || []);

        const pre = typeof window !== "undefined" ? (window as any).__preselectSource : "";
        if (pre) {
          const hit = (data.analyses || []).find((a) => a.job_id === pre) || null;
          if (hit) setSource(hit);
        }

        // sensible defaults
        const first = (data.analyses || []).find((a) => a.status === "completed") || null;
        const second =
          (data.analyses || []).find((a) => a.status === "completed" && a.job_id !== first?.job_id) || null;
        if (!source && first) setSource(first);
        if (!target && second) setTarget(second);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load analyses");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    if (!source) return;
    setBusy(true);
    setErr("");
    setReport(null);
    setComparisonId(null);
    try {
      const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
      const payload = {
        job_id: source.job_id,
        source_type: "upload",
        compare_mode: mode === "library" ? "specific_channel" : mode === "channel" ? "specific_channel" : "niche_benchmark",
        niche,
        competitor_channel: mode === "library" ? "" : competitorChannel,
        goal,
        platform,
      };
      const res = await fetch(`${base}/api/supabase/comparisons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Comparison failed (${res.status})`);
      const data = await res.json();
      setReport(data.report);
      setComparisonId(data.comparison_id || null);
    } catch (e: any) {
      setErr(e?.message ?? "Comparison failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div>
        <div className="font-semibold tracking-tight text-3xl">Compare</div>
        <div className="text-slate-300 text-sm">Compare an analysis against a benchmark or competitor</div>
      </div>

      {err ? <div className="mt-4 text-sm text-red-400">{err}</div> : null}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Source</div>
            <Button
              variant="premium-ghost"
              onClick={() => {
                setPickerSide("source");
                setPickerOpen(true);
              }}
            >
              Change
            </Button>
          </div>
          <div className="mt-3 text-sm text-slate-100">{source?.original_filename || "Pick a source analysis"}</div>
          <div className="mt-1 text-xs text-slate-400">{source?.job_id || ""}</div>
        </Card>

        <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Target</div>
            {mode === "library" ? (
              <Button
                variant="premium-ghost"
                onClick={() => {
                  setPickerSide("target");
                  setPickerOpen(true);
                }}
              >
                Pick
              </Button>
            ) : null}
          </div>

          <div className="mt-3 flex items-center gap-2">
            {(["library", "channel", "niche"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-2 rounded-xl text-sm border transition-all ${
                  mode === m ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {m === "library" ? "From Library" : m === "channel" ? "By Channel" : "Niche Benchmark"}
              </button>
            ))}
          </div>

          {mode === "library" ? (
            <div className="mt-3 text-sm text-slate-100">{target?.original_filename || "Pick a target analysis"}</div>
          ) : mode === "channel" ? (
            <div className="mt-3">
              <PremiumField value={competitorChannel} onChange={setCompetitorChannel} placeholder="Competitor channel name" />
            </div>
          ) : (
            <div className="mt-3">
              <PremiumField value={niche} onChange={setNiche} placeholder="Niche (e.g. education)" />
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="text-xs text-slate-400">Goal</div>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value as any)}
            className="mt-2 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          >
            <option value="retention">retention</option>
            <option value="clarity">clarity</option>
            <option value="conversion">conversion</option>
            <option value="confidence">confidence</option>
          </select>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="text-xs text-slate-400">Platform</div>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as any)}
            className="mt-2 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          >
            <option value="youtube_long">youtube_long</option>
            <option value="youtube_shorts">youtube_shorts</option>
          </select>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-end">
          <button
            onClick={generate}
            disabled={!source || busy || loading}
            className="w-full px-6 py-2.5 bg-cyan-400 text-slate-950 font-semibold rounded-xl hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {busy ? "Generating…" : "Generate Comparison Report"}
          </button>
        </div>
      </div>

      <div className="mt-8">
        {loading ? <div className="text-sm text-slate-300">Loading library…</div> : null}
        {comparisonId ? <div className="text-xs text-slate-400 mb-2">comparison_id: {comparisonId}</div> : null}
        <ComparisonReport report={report} />
      </div>

      <AnalysisPickerModal
        open={pickerOpen}
        analyses={completed}
        excludeJobId={pickerSide === "target" ? source?.job_id : undefined}
        onClose={() => setPickerOpen(false)}
        onSelect={(a) => {
          if (pickerSide === "source") setSource(a);
          else setTarget(a);
        }}
      />
    </div>
  );
}

