"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { MetricEvent, MetricKey } from "./video-analysis-types";
import { Button } from "./ui";

// Dynamically import heavy UI blocks.
const MetricsGrid = dynamic(() => import("./MetricsGrid").then((m) => m.MetricsGrid));
const MultiMetricTimeline = dynamic(() => import("./MultiMetricTimeline").then((m) => m.MultiMetricTimeline));
const CoachSummary = dynamic(() => import("./CoachSummary").then((m) => m.CoachSummary));
const ScoreBreakdown = dynamic(() => import("./ScoreBreakdown").then((m) => m.ScoreBreakdown));
const PriorityList = dynamic(() => import("./PriorityList").then((m) => m.PriorityList));
const MetricStoryCard = dynamic(() => import("./MetricStoryCard").then((m) => m.MetricStoryCard));
const BestMomentsPanel = dynamic(() => import("./BestMomentsPanel").then((m) => m.BestMomentsPanel));
const WorstMomentsPanel = dynamic(() => import("./WorstMomentsPanel").then((m) => m.WorstMomentsPanel));
const CoachPanel = dynamic(() => import("./CoachPanel").then((m) => m.CoachPanel));
const InsightsPanel = dynamic(() => import("./InsightsPanel").then((m) => m.InsightsPanel));
const AgentTracePanel = dynamic(() => import("./AgentTracePanel").then((m) => m.AgentTracePanel));
const ClipPlayer = dynamic(() => import("./ClipPlayer").then((m) => m.ClipPlayer));
const ClipsPanel = dynamic(() => import("./ClipsPanel").then((m) => m.ClipsPanel));
const CoachingPlan = dynamic(() => import("./CoachingPlan").then((m) => m.CoachingPlan));
const ScoreSimulator = dynamic(() => import("./ScoreSimulator").then((m) => m.ScoreSimulator));

export function AnalysisDrawer(props: {
  open: boolean;
  jobId: string | null;
  onClose: () => void;
  highlightJobId?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | "">("");
  const [activeEvent, setActiveEvent] = useState<MetricEvent | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [clipPreviewUrl, setClipPreviewUrl] = useState<string>("");

  useEffect(() => {
    if (!props.open || !props.jobId) return;
    setLoading(true);
    setErr("");
    setResult(null);
    setAnalysis(null);
    setSelectedMetric("");
    setActiveEvent(null);
    setCurrentTime(0);
    setClipPreviewUrl("");
    (async () => {
      try {
        const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
        const id = props.jobId;
        if (!id) return;
        const res = await fetch(`${base}/api/supabase/analyses/${encodeURIComponent(id)}/full`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load analysis (${res.status})`);
        const data = await res.json();
        setAnalysis(data.analysis ?? null);
        setResult(data.result ?? null);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load analysis");
      } finally {
        setLoading(false);
      }
    })();
  }, [props.open, props.jobId]);

  const cards = useMemo(() => {
    const s = result?.summary ?? {};
    const c = result?.cards ?? {};
    const durationSec = Number(s.duration_sec ?? result?.summary?.duration_sec ?? result?.duration_sec ?? 0);

    const tv = c.tonal_variation ?? {};
    const tonalScore =
      typeof tv.score === "number"
        ? tv.score
        : typeof (tv.pitch_hz as { std?: number })?.std === "number"
          ? (tv.pitch_hz as { std: number }).std
          : null;
    const tonalLabel = typeof tv.label === "string" ? String(tv.label).toLowerCase() : null;

    const exprByType = (c.expressions?.by_type ?? {}) as Record<string, number>;
    const exprTop = Object.entries(exprByType).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
    const exprChanges = Number(c.expressions?.change_count ?? 0);
    const exprChangesPerMin = durationSec > 0 ? exprChanges / (durationSec / 60) : 0;
    const exprBadge = exprChangesPerMin < 20 ? "low" : exprChangesPerMin <= 60 ? "normal" : "high";

    return {
      score: Number(s.overall_score ?? 0),
      wpm: c.speech_rate?.wpm ?? "-",
      fillers: c.filler_words?.per_minute ?? "-",
      eye: c.eye_contact?.on_camera_ratio ?? "-",
      gestures: c.gestures?.per_minute ?? "-",
      tonalScore,
      tonalLabel,
      exprTop,
      exprChangesPerMin,
      exprBadge,
      durationSec,
      events: (result?.events ?? []) as MetricEvent[],
      engagementDrops: (result?.engagement_drops ?? []) as MetricEvent[],
      bestMoments: (result?.best_moments ?? []) as { t0: number; t1: number; note?: string }[],
      worstMoments: (result?.worst_moments ?? []) as { t0: number; t1: number; reason: string }[],
      coachComments: (result?.coach_comments ?? []) as { t0: number; comment: string }[],
      clips: (result?.clips ?? []) as { t0: number; t1: number; url: string }[],
      storyClips: (result?.clips ?? []) as { t0: number; t1: number; url: string; label?: string; reason?: string; impact?: string }[],
      coachSummary: (result?.coach_summary ?? null) as any,
      scoreBreakdown: (result?.score_breakdown ?? []) as any[],
      priorities: (result?.priorities ?? []) as any[],
      metricStories: (result?.metric_stories ?? []) as any[],
      insights: (result?.insights ?? result?.feedback?.strengths ?? []) as string[],
      confidenceScore: Number(result?.confidence_score ?? 0),
      energyScore: Number(result?.energy_score ?? 0),
      trace: (result?.agent_trace ?? result?.trace ?? []) as any[],
    };
  }, [result]);

  if (!props.open) return null;

  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
  const onSeek = (t0: number, _t1?: number) => {
    setCurrentTime(Number(t0 || 0));
  };

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/60" onClick={props.onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[920px] bg-slate-950/90 border-l border-white/10 backdrop-blur overflow-hidden">
        <div className="h-14 px-4 flex items-center justify-between border-b border-white/10">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">Analysis</div>
            <div className="text-xs text-slate-400 truncate">{props.jobId}</div>
          </div>
          <Button variant="premium-ghost" onClick={props.onClose}>
            Close ✕
          </Button>
        </div>

        <div className="h-[calc(100%-3.5rem)] overflow-auto p-4">
          {loading ? <div className="text-sm text-slate-300">Loading…</div> : null}
          {err ? <div className="text-sm text-red-400">{err}</div> : null}

          {result ? (
            <div className="space-y-4">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="text-xs text-slate-400">Summary</div>
                <div className="mt-1 text-sm text-slate-200">{analysis?.original_filename ?? ""}</div>
              </div>

              <MetricsGrid
                show={true}
                currentStepId=""
                demoMetricValue={0}
                selectedMetric={selectedMetric}
                onSelectMetric={(m) => setSelectedMetric(m)}
                cards={{
                  wpm: cards.wpm,
                  fillers: cards.fillers,
                  eye: cards.eye,
                  gestures: cards.gestures,
                  tonalScore: cards.tonalScore,
                  tonalLabel: cards.tonalLabel,
                  exprTop: cards.exprTop,
                  exprChangesPerMin: cards.exprChangesPerMin,
                  exprBadge: cards.exprBadge,
                }}
              />

              <MultiMetricTimeline
                events={cards.events}
                engagementDrops={cards.engagementDrops}
                selectedMetric={String(selectedMetric || "")}
                durationSec={cards.durationSec}
                currentTime={currentTime}
                activeEvent={activeEvent}
                onSeek={(t0, t1) => onSeek(t0, t1)}
                onActiveEventChange={setActiveEvent}
              />

              <CoachSummary summary={cards.coachSummary} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ScoreBreakdown score={Number(cards.score || 0)} parts={cards.scoreBreakdown} />
                <PriorityList items={cards.priorities} />
              </div>

              {cards.metricStories?.length ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MetricStoryCard story={cards.metricStories[0]} onSeek={onSeek} />
                  <MetricStoryCard story={cards.metricStories[1] ?? cards.metricStories[0]} onSeek={onSeek} />
                </div>
              ) : null}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <BestMomentsPanel moments={cards.bestMoments} onClickMoment={(t0, t1) => onSeek(t0, t1)} />
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <WorstMomentsPanel
                    moments={cards.worstMoments}
                    onClose={() => setSelectedMetric("")}
                    onClickMoment={(t0, t1) => onSeek(t0, t1)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <CoachPanel comments={cards.coachComments} onClickComment={(t0) => onSeek(t0)} />
                </div>
                <InsightsPanel
                  insights={cards.insights}
                  engagementDrops={cards.engagementDrops as any}
                  confidenceScore={cards.confidenceScore}
                  energyScore={cards.energyScore}
                  duration={cards.durationSec}
                  onSeek={(t) => onSeek(t)}
                />
              </div>

              <AgentTracePanel trace={cards.trace} />

              <ClipPlayer clips={cards.storyClips} apiBase={apiBase} onSeek={onSeek} />

              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <ClipsPanel
                  clips={cards.clips}
                  clipPreviewUrl={clipPreviewUrl}
                  onClickClip={(clip) => {
                    setClipPreviewUrl(clip?.url ? `${apiBase}${clip.url}` : "");
                    onSeek(clip.t0, clip.t1);
                  }}
                />
              </div>

              <CoachingPlan priorities={cards.priorities} />
              <ScoreSimulator score={Number(cards.score || 0)} parts={cards.scoreBreakdown} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

