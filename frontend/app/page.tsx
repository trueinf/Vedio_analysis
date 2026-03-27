"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChannelCollection,
  ChannelItem,
  deleteChannel,
  getChannelCollections,
  getComparisonReport,
  getCollectionSummary,
  getJob,
  getResult,
  JobHistoryItem,
  listJobs,
  listChannels,
  renameChannel,
  uploadVideo,
  uploadVideos,
} from "../lib/api";
import {
  Button,
  Card,
} from "../components/ui";
import { DemoOverlay } from "../components/DemoOverlay";
import { AnalysisHistoryPanel } from "../components/AnalysisHistoryPanel";
import { VideoUploadPanel } from "../components/VideoUploadPanel";
import { InsightsSummaryPanel } from "../components/InsightsSummaryPanel";
import { MetricsGrid } from "../components/MetricsGrid";
import { InsightsPanel } from "../components/InsightsPanel";
import { AgentTracePanel } from "../components/AgentTracePanel";
import { CoachSummary } from "../components/CoachSummary";
import { ComparisonCoachPanel } from "../components/ComparisonCoachPanel";
import { ScoreBreakdown } from "../components/ScoreBreakdown";
import { PriorityList } from "../components/PriorityList";
import { MetricStoryCard } from "../components/MetricStoryCard";
import { ScoreSimulator } from "../components/ScoreSimulator";
import { ClipPlayer } from "../components/ClipPlayer";
import { CoachingPlan } from "../components/CoachingPlan";
import { MetricEvent, MetricKey } from "../components/video-analysis-types";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
const MultiMetricTimeline = dynamic(() => import("../components/MultiMetricTimeline").then((m) => m.MultiMetricTimeline));
const WorstMomentsPanel = dynamic(() => import("../components/WorstMomentsPanel").then((m) => m.WorstMomentsPanel));
const ClipsPanel = dynamic(() => import("../components/ClipsPanel").then((m) => m.ClipsPanel));
const CoachPanel = dynamic(() => import("../components/CoachPanel").then((m) => m.CoachPanel));
const BestMomentsPanel = dynamic(() => import("../components/BestMomentsPanel").then((m) => m.BestMomentsPanel));

type UploadJobRow = {
  id: string;
  name: string;
  status: string;
  stage: string;
  progress: number;
};

type CollectionSummary = {
  collection_id: string;
  total_videos: number;
  completed_videos: number;
  failed_videos: number;
  processing_videos: number;
  summary: {
    common_patterns: Record<string, { most_common: string; count: number; share: number; distribution: Record<string, number> }>;
    consistency: Record<string, { mean: number | null; min: number | null; max: number | null; std: number | null }>;
    recurring_strengths: { pattern: string; count: number }[];
    recurring_issues: { pattern: string; count: number }[];
    best_video: string | null;
    worst_video: string | null;
    per_video?: { job_id: string; score: number; key_issue: string; key_strength: string }[];
    failed_job_ids?: string[];
  };
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function labelCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedJobs, setUploadedJobs] = useState<UploadJobRow[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [jobError, setJobError] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [loadedResultJobId, setLoadedResultJobId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string>("");
  const [collectionSummary, setCollectionSummary] = useState<CollectionSummary | null>(null);
  const [channelName, setChannelName] = useState<string>("");
  const [channelSearch, setChannelSearch] = useState<string>("");
  const [channelViewMode, setChannelViewMode] = useState<"latest" | "all">("latest");
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [channelCollections, setChannelCollections] = useState<Record<string, ChannelCollection[]>>({});
  const [busy, setBusy] = useState(false);
  const [historyJobs, setHistoryJobs] = useState<JobHistoryItem[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | "">("");
  const [activeEvent, setActiveEvent] = useState<MetricEvent | null>(null);
  const [isMomentPanelOpen, setIsMomentPanelOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [clipPreviewUrl, setClipPreviewUrl] = useState<string>("");
  const [demoMode, setDemoMode] = useState(false);
  const [demoStarted, setDemoStarted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [demoSpotlight, setDemoSpotlight] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [demoMetricValue, setDemoMetricValue] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineVideoRef = useRef<HTMLVideoElement | null>(null);

  const demoSteps = useMemo(
    () => [
      {
        id: "problem",
        title: "Problem",
        description: "Most creators do not know where they lose viewer engagement.",
        focusId: "demo-problem",
      },
      {
        id: "solution",
        title: "Solution",
        description: "AI analysis transforms raw video into measurable delivery insights.",
        focusId: "demo-solution",
      },
      {
        id: "metrics",
        title: "Metrics",
        description: "Speech, eye contact, fillers, tone, expressions, and gestures are scored in one dashboard.",
        focusId: "demo-metrics",
      },
      {
        id: "timeline",
        title: "Timeline Insights",
        description: "Interactive timeline pinpoints exactly when delivery quality shifts.",
        focusId: "demo-timeline",
      },
      {
        id: "moments",
        title: "Moments",
        description: "Clickable moments jump straight to critical timestamps in the video.",
        focusId: "demo-moments",
      },
      {
        id: "worst",
        title: "Worst Moments",
        description: "Top negative segments are auto-detected to prioritize coaching effort.",
        focusId: "demo-worst",
      },
      {
        id: "coach",
        title: "AI Coaching",
        description: "Actionable comments are generated for each timestamped issue.",
        focusId: "demo-coach",
      },
      {
        id: "clips",
        title: "Clips",
        description: "Auto-generated clips package moments for review and team feedback.",
        focusId: "demo-clips",
      },
      {
        id: "value",
        title: "Final Value",
        description: "A repeatable coaching loop that improves performance video over video.",
        focusId: "demo-value",
      },
    ],
    []
  );

  async function startUpload() {
    const batch = files.length ? files : file ? [file] : [];
    if (!batch.length) return;
    setBusy(true);
    setJobError("");
    setResult(null);
    try {
      const newRows: UploadJobRow[] = [];
      if (batch.length > 1) {
        const resp = await uploadVideos(batch, channelName);
        if (resp.collection_id) setCollectionId(resp.collection_id);
        if (resp.channel_name && !channelName.trim()) setChannelName(resp.channel_name);
        setCollectionSummary(null);
        resp.jobs.forEach((u, idx) => {
          const f = batch[idx];
          if (!f) return;
          newRows.push({
            id: u.job_id,
            name: f.name,
            status: u.status,
            stage: "queued",
            progress: 0,
          });
        });
      } else {
        const u = await uploadVideo(batch[0], channelName);
        if (u.collection_id) setCollectionId(u.collection_id);
        if (u.channel_name && !channelName.trim()) setChannelName(u.channel_name);
        setCollectionSummary(null);
        newRows.push({
          id: u.job_id,
          name: batch[0].name,
          status: u.status,
          stage: "queued",
          progress: 0,
        });
      }
      setUploadedJobs((prev) => [...newRows, ...prev]);
      if (newRows[0]) {
        setJobId(newRows[0].id);
        setStatus(newRows[0].status);
        setStage("queued");
        setProgress(0);
      }
      await loadChannels();
    } catch (e: any) {
      setJobError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const loadChannels = useCallback(async () => {
    try {
      const res = await listChannels();
      setChannels(res.channels || []);
      if (!selectedChannelId && (res.channels || []).length) {
        setSelectedChannelId(res.channels[0].id);
      }
    } catch {
      // ignore
    }
  }, [selectedChannelId]);

  const loadCollectionsForChannel = useCallback(async (channelId: string) => {
    if (!channelId) return;
    try {
      const res = await getChannelCollections(channelId);
      setChannelCollections((prev) => ({ ...prev, [channelId]: res.collections || [] }));
    } catch {
      // ignore
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await listJobs(300);
      setHistoryJobs(res.jobs || []);
    } catch {
      // ignore
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!jobId && !uploadedJobs.length) return;
    setBusy(true);
    setJobError("");
    try {
      const ids = Array.from(new Set([...(jobId ? [jobId] : []), ...uploadedJobs.map((j) => j.id)]));
      const updates = await Promise.all(
        ids.map(async (id) => {
          const job = await getJob(id);
          return {
            id,
            status: job.status,
            stage: (job as any).stage ?? "",
            progress: Number((job as any).progress ?? 0),
            error: job.error_message || "",
          };
        })
      );

      setUploadedJobs((prev) =>
        prev.map((row) => {
          const u = updates.find((x) => x.id === row.id);
          return u ? { ...row, status: u.status, stage: u.stage, progress: u.progress } : row;
        })
      );

      const selected = updates.find((u) => u.id === jobId);
      let selectedCompletedLoaded = false;
      if (selected) {
        setStatus(selected.status);
        setStage(selected.stage);
        setProgress(selected.progress);
        if (selected.status === "failed") setJobError(selected.error || "Job failed");
        if (selected.status === "completed") {
          if (loadedResultJobId !== selected.id) {
            const r = await getResult(selected.id);
            setResult(r);
            setLoadedResultJobId(selected.id);
          }
          selectedCompletedLoaded = true;
        }
      }

      // If selected job is not completed yet, auto-switch to the first completed
      // job in the current list and load its result.
      if (!selectedCompletedLoaded) {
        const firstCompleted = uploadedJobs.find((row) => {
          const u = updates.find((x) => x.id === row.id);
          return u?.status === "completed";
        });
        if (firstCompleted) {
          const u = updates.find((x) => x.id === firstCompleted.id);
          if (u) {
            setJobId(u.id);
            setStatus(u.status);
            setStage(u.stage);
            setProgress(u.progress);
            if (loadedResultJobId !== u.id) {
              const r = await getResult(u.id);
              setResult(r);
              setLoadedResultJobId(u.id);
            }
          }
        }
      }

      if (collectionId && ids.length > 1) {
        try {
          const cs = (await getCollectionSummary(collectionId)) as CollectionSummary;
          setCollectionSummary(cs);
        } catch {
          // ignore transient summary fetch failures while jobs are in progress
        }
      }
      await loadChannels();
      await loadHistory();
    } catch (e: any) {
      setJobError(e?.message ?? "Refresh failed");
    } finally {
      setBusy(false);
    }
  }, [jobId, uploadedJobs, loadedResultJobId, collectionId, loadChannels, loadHistory]);

  useEffect(() => {
    loadChannels().catch(() => {});
  }, [loadChannels]);

  useEffect(() => {
    loadHistory().catch(() => {});
  }, [loadHistory]);

  useEffect(() => {
    if (!selectedChannelId) return;
    loadCollectionsForChannel(selectedChannelId).catch(() => {});
  }, [selectedChannelId, loadCollectionsForChannel]);

  useEffect(() => {
    const activeCount = (historyJobs.length ? historyJobs : uploadedJobs).filter(
      (j: any) => j.status === "queued" || j.status === "processing"
    ).length;
    const hasActive = activeCount > 0 || (jobId && (status === "queued" || status === "processing"));
    if (!hasActive) return;
    const intervalMs = activeCount > 1 ? 3000 : 5000;
    const t = setInterval(() => {
      refresh().catch(() => {});
    }, intervalMs);
    return () => clearInterval(t);
  }, [jobId, status, uploadedJobs, historyJobs, refresh]);

  const cards = useMemo(() => {
    const s = result?.summary ?? {};
    const c = result?.cards ?? {};
    const durationSec = Number(s.duration_sec ?? 0);

    const tv = c.tonal_variation ?? {};
    const tonalScore =
      typeof tv.score === "number"
        ? tv.score
        : typeof (tv.pitch_hz as { std?: number })?.std === "number"
          ? (tv.pitch_hz as { std: number }).std
          : null;
    const tonalLabel = typeof tv.label === "string" ? (tv.label as string).toLowerCase() : null;

    const exprByType = (c.expressions?.by_type ?? {}) as Record<string, number>;
    const exprTop = Object.entries(exprByType).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
    const exprChanges = Number(c.expressions?.change_count ?? 0);
    const exprChangesPerMin = durationSec > 0 ? exprChanges / (durationSec / 60) : 0;
    const exprBadge =
      exprChangesPerMin < 20 ? "low" : exprChangesPerMin <= 60 ? "normal" : "high";

    return {
      score: s.overall_score ?? 0,
      warnings: (s.warnings as string[]) ?? [],
      wpm: c.speech_rate?.wpm ?? "-",
      fillers: c.filler_words?.per_minute ?? "-",
      eye: c.eye_contact?.on_camera_ratio ?? "-",
      gestures: c.gestures?.per_minute ?? "-",
      tonalScore,
      tonalLabel,
      exprTop,
      exprChangesPerMin,
      exprBadge,
      timeline: result?.timeline ?? { bin_size_sec: 60, bins: [] },
      events: (result?.events ?? []) as {
        metric?: string;
        label?: string;
        t0: number;
        t1?: number;
        value?: number;
        note?: string;
        type?: string;
        message?: string;
      }[],
      durationSec,
      tips: result?.tips ?? [
        "Reduce filler words.",
        "Improve tonal variation.",
        "Increase eye contact.",
        "Use more gestures.",
      ],
      suggestions: result?.feedback?.suggestions ?? [
        'Minimize use of "um" and "uh".',
        "Vary your tone during key points.",
        "Increase eye contact with the camera.",
      ],
      worstMoments: (result?.worst_moments ?? []) as { t0: number; t1: number; reason: string }[],
      clips: (result?.clips ?? []) as { t0: number; t1: number; url: string }[],
      storyClips: (result?.clips ?? []) as {
        t0: number;
        t1: number;
        url: string;
        label?: string;
        reason?: string;
        impact?: string;
      }[],
      coachComments: (result?.coach_comments ?? []) as { t0: number; comment: string }[],
      engagementDrops: (result?.engagement_drops ?? []) as { t0: number; t1?: number; note?: string; value?: number }[],
      confidenceScore: Number(result?.confidence_score ?? 0),
      energyScore: Number(result?.energy_score ?? 0),
      bestMoments: (result?.best_moments ?? []) as { t0: number; t1: number; note?: string }[],
      pauses: (result?.pauses ?? []) as { t0: number; t1: number; note?: string; value?: number }[],
      coachSummary: (result?.coach_summary ?? null) as {
        overall: string;
        top_priorities: { rank: number; metric: string; title: string; reason?: string }[];
        confidence_explanation: string;
      } | null,
      scoreBreakdown: (result?.score_breakdown ?? []) as {
        metric: string;
        label: string;
        delta: number;
        reason?: string;
      }[],
      priorities: (result?.priorities ?? []) as {
        metric: string;
        title: string;
        impact?: string;
        why_now?: string;
      }[],
      metricStories: (result?.metric_stories ?? []) as {
        metric: string;
        score: number;
        title: string;
        insight: string;
        impact: string;
        cause: string;
        evidence: {
          start: number;
          end: number;
          description: string;
          impact?: string;
          why_problem?: string;
        }[];
        actions: string[];
      }[],
      agentTrace: (result?.debug?.agent_trace ?? []) as {
        agent?: string;
        step?: string;
        plan?: Record<string, unknown>;
        reason?: string;
        model?: string | null;
        words?: number;
        face_visible_ratio?: number;
        engagement_score?: number;
        confidence_score?: number;
        overall_score?: number;
        strengths?: number;
        suggestions?: number;
      }[],
    };
  }, [result]);
  const allEvents = useMemo(() => (result?.events ?? []) as MetricEvent[], [result?.events]);
  const filteredEvents = useMemo(
    () =>
      (selectedMetric ? allEvents.filter((e) => String(e.metric || e.type) === selectedMetric) : allEvents).sort(
        (a, b) => Number(a.t0 || 0) - Number(b.t0 || 0)
      ),
    [allEvents, selectedMetric]
  );
  const activeTimelineEvent = useMemo(
    () =>
      filteredEvents.find((e) => {
        const t0 = Number(e.t0 || 0);
        const t1 = Number(e.t1 ?? e.t0 ?? 0);
        return t0 <= currentTime && currentTime <= Math.max(t0, t1);
      }) ?? null,
    [filteredEvents, currentTime]
  );
  const activeChannelName =
    channels.find((c) => c.id === selectedChannelId)?.name || channelName || "Creator";
  const visibleChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(channelSearch.trim().toLowerCase())
  );
  const localVideoUrl = useMemo(() => {
    const pick = file ?? files[0] ?? null;
    return pick ? URL.createObjectURL(pick) : "";
  }, [file, files]);

  useEffect(() => {
    return () => {
      if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
    };
  }, [localVideoUrl]);

  useEffect(() => {
    if (activeTimelineEvent) setActiveEvent(activeTimelineEvent);
  }, [activeTimelineEvent]);

  useEffect(() => {
    if (!demoMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setCurrentStep((s) => Math.min(demoSteps.length - 1, s + 1));
      if (e.key === "ArrowLeft") setCurrentStep((s) => Math.max(0, s - 1));
      if (e.key === "Escape") setDemoMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demoMode, demoSteps.length]);

  useEffect(() => {
    if (!demoMode) return;
    const focusId = demoSteps[currentStep]?.focusId;
    const update = () => {
      if (!focusId) return setDemoSpotlight(null);
      const el = document.getElementById(focusId);
      if (!el) return setDemoSpotlight(null);
      const r = el.getBoundingClientRect();
      setDemoSpotlight({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [demoMode, currentStep, demoSteps]);

  useEffect(() => {
    if (!demoMode) return;
    const stepId = demoSteps[currentStep]?.id;
    if (stepId === "metrics") {
      setSelectedMetric("speech_rate");
      setDemoMetricValue(0);
      const t = setInterval(() => setDemoMetricValue((v) => (v >= 96 ? 96 : v + 6)), 40);
      return () => clearInterval(t);
    }
    if (stepId === "timeline") {
      setSelectedMetric("");
      if (filteredEvents[0]) setActiveEvent(filteredEvents[0]);
    }
    if (stepId === "moments" || stepId === "worst") {
      setIsMomentPanelOpen(true);
      const wm = cards.worstMoments[0];
      if (wm) {
        setActiveEvent({ metric: "worst_moment", t0: wm.t0, t1: wm.t1, note: wm.reason });
        seekTo(wm.t0, wm.t1);
      }
    }
    if (stepId === "coach") {
      setIsMomentPanelOpen(true);
      const cc = cards.coachComments[0];
      if (cc) seekTo(cc.t0);
    }
    if (stepId === "clips") {
      setIsMomentPanelOpen(true);
      const c = cards.clips[0];
      if (c) {
        setClipPreviewUrl(`${API_BASE}${c.url}`);
        seekTo(c.t0, c.t1);
      }
    }
  }, [demoMode, currentStep, demoSteps, filteredEvents, cards.worstMoments, cards.coachComments, cards.clips]);

  async function exportDemoScreens() {
    try {
      const html2canvas = (await import("html2canvas")).default;
      const root = document.getElementById("demo-root");
      if (!root) return;
      for (let i = 0; i < demoSteps.length; i++) {
        setCurrentStep(i);
        await new Promise((r) => setTimeout(r, 350));
        const canvas = await html2canvas(root, { backgroundColor: "#0f172a", scale: 1.5 });
        const a = document.createElement("a");
        a.download = `demo-step-${i + 1}-${demoSteps[i].id}.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
      }
    } catch {
      // ignore optional export failures
    }
  }

  const seekTo = (time: number, endTime?: number) => {
    const t = Math.max(0, Number.isFinite(time) ? time : 0);
    const players = [videoRef.current, timelineVideoRef.current].filter(Boolean) as HTMLVideoElement[];
    if (!players.length) return;
    players.forEach((player) => {
      player.currentTime = t;
      void player.play();
      if (typeof endTime === "number" && endTime > t) {
        const stopAt = endTime;
        const stopHandler = () => {
          if (player.currentTime >= stopAt) {
            player.pause();
            player.removeEventListener("timeupdate", stopHandler);
          }
        };
        player.addEventListener("timeupdate", stopHandler);
      }
    });
  };
  const stepId = demoSteps[currentStep]?.id ?? "";
  const stepMotion = useMemo(() => {
    const byStep: Record<string, { initial: { opacity: number; y: number; scale: number }; duration: number }> = {
      problem: { initial: { opacity: 0, y: 40, scale: 0.99 }, duration: 0.5 },
      solution: { initial: { opacity: 0, y: 24, scale: 1.0 }, duration: 0.4 },
      metrics: { initial: { opacity: 0, y: 18, scale: 0.985 }, duration: 0.35 },
      timeline: { initial: { opacity: 0, y: 26, scale: 0.99 }, duration: 0.45 },
      moments: { initial: { opacity: 0, y: 22, scale: 1.0 }, duration: 0.4 },
      worst: { initial: { opacity: 0, y: 22, scale: 1.0 }, duration: 0.4 },
      coach: { initial: { opacity: 0, y: 20, scale: 1.0 }, duration: 0.4 },
      clips: { initial: { opacity: 0, y: 20, scale: 1.0 }, duration: 0.4 },
      value: { initial: { opacity: 0, y: 34, scale: 0.99 }, duration: 0.55 },
    };
    return byStep[stepId] ?? { initial: { opacity: 0, y: 24, scale: 0.99 }, duration: 0.4 };
  }, [stepId]);
  const showProblemSlide = !demoMode || stepId === "problem" || stepId === "solution";
  const showMetricsSlide = !demoMode || stepId === "metrics";
  const showTimelineSlide = !demoMode || ["timeline", "moments", "worst", "coach", "clips"].includes(stepId);
  const showValueSlide = !demoMode || stepId === "value";

  return (
    <div id="demo-root" className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">
      <AnimatePresence>
        {demoMode && !demoStarted ? (
          <motion.div
            key="demo-hero"
            className="fixed inset-0 z-[70] bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 flex items-center justify-center px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <motion.div
              className="text-center max-w-3xl"
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            >
              <div className="text-5xl md:text-6xl font-bold tracking-tight text-white">AI Video Performance Analyzer</div>
              <div className="mt-5 text-lg md:text-2xl text-slate-200">Turn communication into measurable intelligence</div>
              <button
                type="button"
                className="mt-10 px-6 py-3 rounded-xl bg-cyan-400 text-slate-950 font-semibold hover:scale-105 transition-transform"
                onClick={() => setDemoStarted(true)}
              >
                Start Demo
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <motion.div
        className="max-w-[96vw] mx-auto px-6 py-6 transition-all duration-500"
        initial={false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
      >
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 backdrop-blur px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center text-white font-semibold">
              ▶
            </div>
            <div>
              <div className="font-semibold tracking-tight text-3xl">AI Video Performance Analyzer</div>
              <div className="text-slate-300 text-sm">
                Upload one or many videos and get delivery insights
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="premium-ghost"
              onClick={() => {
                if (demoMode) {
                  setDemoMode(false);
                  setDemoStarted(false);
                } else {
                  setDemoMode(true);
                  setDemoStarted(false);
                  setCurrentStep(0);
                  setIsMomentPanelOpen(true);
                }
              }}
            >
              {demoMode ? "Exit Demo Mode" : "Enter Demo Mode"}
            </Button>
            <div className="text-slate-300">{demoMode ? "Presentation Mode" : "Dashboard"}</div>
          </div>
        </div>

        <motion.div
          key={demoMode ? `demo-step-${currentStep}` : "normal-mode"}
          className={`mt-6 grid grid-cols-12 gap-6 ${demoMode ? "min-h-[82vh] content-center" : ""}`}
          initial={demoMode ? stepMotion.initial : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: stepMotion.duration, ease: "easeOut" }}
        >
          <div className={`col-span-12 lg:col-span-6 ${showProblemSlide ? "" : "hidden"}`}>
            <VideoUploadPanel
              jobId={jobId}
              localVideoUrl={localVideoUrl}
              demoMode={demoMode}
              channelName={channelName}
              onChannelNameChange={setChannelName}
              onPickFiles={(picked) => {
                setFiles(picked);
                setFile(picked[0] ?? null);
              }}
              onAnalyze={startUpload}
              onRefresh={refresh}
              canAnalyze={Boolean(file) && !busy}
              canRefresh={Boolean(jobId || uploadedJobs.length) && !busy}
              selectedFilesCount={files.length}
              status={status}
              stage={stage}
              progress={progress}
              jobError={jobError}
              uploadedJobs={uploadedJobs}
              activeJobId={jobId}
              onSelectJob={async (nextJobId) => {
                const j = uploadedJobs.find((x) => x.id === nextJobId);
                if (!j) return;
                setJobId(j.id);
                setStatus(j.status);
                setStage(j.stage);
                setProgress(j.progress);
                if (j.status === "completed") {
                  try {
                    if (loadedResultJobId !== j.id) {
                      const r = await getResult(j.id);
                      setResult(r);
                      setLoadedResultJobId(j.id);
                    }
                  } catch {
                    setResult(null);
                    setLoadedResultJobId(null);
                  }
                } else {
                  setResult(null);
                  setLoadedResultJobId(null);
                }
              }}
              setVideoRef={(el) => {
                videoRef.current = el;
              }}
              onVideoLoadedMetadata={(duration) => setVideoDuration(duration)}
              onVideoTimeUpdate={(time) => setCurrentTime(time)}
            />
          </div>

          <InsightsSummaryPanel
            show={showProblemSlide}
            score={cards.score}
            warnings={cards.warnings}
            tips={cards.tips}
            suggestions={cards.suggestions}
          />

          <InsightsPanel
            insights={(() => {
              const lines: string[] = [];
              if (cards.engagementDrops?.length) {
                lines.push(`Lost engagement at ${formatTime(Number(cards.engagementDrops[0].t0 || 0))}`);
              }
              if (typeof cards.eye === "number" && cards.eye < 0.5) {
                lines.push("Eye contact drops during explanation");
              }
              if (typeof cards.wpm === "number" && cards.wpm > 160) {
                lines.push("Speech is strong but slightly fast");
              } else if (typeof cards.wpm === "number" && cards.wpm < 95) {
                lines.push("Speech is clear but slightly slow");
              }
              return lines.slice(0, 5);
            })()}
            engagementDrops={cards.engagementDrops}
            confidenceScore={cards.confidenceScore}
            energyScore={cards.energyScore}
            duration={Number(videoDuration || cards.durationSec || 0)}
            onSeek={(time) => seekTo(time)}
          />
          <CoachSummary summary={cards.coachSummary} />
          <ComparisonCoachPanel
            jobId={jobId}
            onSeek={(start, end) => seekTo(start, end)}
            onGenerate={getComparisonReport}
          />
          <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ScoreBreakdown score={Number(cards.score || 0)} parts={cards.scoreBreakdown} />
            <PriorityList items={cards.priorities} />
          </div>
          <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ScoreSimulator score={Number(cards.score || 0)} parts={cards.scoreBreakdown} />
            <ClipPlayer clips={cards.storyClips} apiBase={API_BASE} onSeek={(t0, t1) => seekTo(t0, t1)} />
          </div>
          <CoachingPlan priorities={cards.priorities} />
          {cards.metricStories.length ? (
            <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {cards.metricStories.map((s) => (
                <MetricStoryCard key={s.metric} story={s} onSeek={(start, end) => seekTo(start, end)} />
              ))}
            </div>
          ) : null}
          <AgentTracePanel trace={cards.agentTrace} />

          <AnalysisHistoryPanel
            jobs={historyJobs}
            activeJobId={jobId}
            onSelectJob={async (nextJobId) => {
              setJobId(nextJobId);
              try {
                const job = await getJob(nextJobId);
                setStatus(job.status);
                setStage((job as any).stage ?? "");
                setProgress(Number((job as any).progress ?? 0));
                if (job.status === "completed") {
                  const r = await getResult(nextJobId);
                  setResult(r);
                  setLoadedResultJobId(nextJobId);
                }
              } catch {
                // ignore
              }
            }}
          />

          <MetricsGrid
            show={showMetricsSlide}
            currentStepId={demoSteps[currentStep]?.id ?? ""}
            demoMetricValue={demoMetricValue}
            selectedMetric={selectedMetric}
            onSelectMetric={(metric) => {
              setSelectedMetric(metric);
              setIsMomentPanelOpen(true);
            }}
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

          {cards.durationSec > 0 && cards.events?.length > 0 && showTimelineSlide ? (
            <div id="demo-timeline" className="col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-5">
              <Card className="lg:col-span-8 p-4 rounded-xl shadow-sm transition-all duration-500 bg-white/5 border border-white/10 backdrop-blur text-white">
                <div className="mb-4 border border-white/10 rounded-xl overflow-hidden bg-black/30 aspect-video flex items-center justify-center text-slate-300 text-sm">
                  {localVideoUrl ? (
                    <video
                      ref={timelineVideoRef}
                      src={localVideoUrl}
                      controls
                      className="w-full h-full object-contain bg-black"
                      onLoadedMetadata={(e) => setVideoDuration(Number(e.currentTarget.duration || 0))}
                      onTimeUpdate={(e) => {
                        const current = Number(e.currentTarget.currentTime || 0);
                        setCurrentTime(current);
                        const mainPlayer = videoRef.current;
                        if (mainPlayer && Math.abs(mainPlayer.currentTime - current) > 0.35) {
                          mainPlayer.currentTime = current;
                        }
                      }}
                      onPlay={() => {
                        const mainPlayer = videoRef.current;
                        if (mainPlayer && mainPlayer.paused) void mainPlayer.play();
                      }}
                      onPause={() => {
                        const mainPlayer = videoRef.current;
                        if (mainPlayer && !mainPlayer.paused) mainPlayer.pause();
                      }}
                    />
                  ) : (
                    "Select a video to preview it above the timeline"
                  )}
                </div>
                <MultiMetricTimeline
                  events={filteredEvents}
                  engagementDrops={cards.engagementDrops as MetricEvent[]}
                  selectedMetric={selectedMetric}
                  durationSec={Number(videoDuration || cards.durationSec || 0)}
                  currentTime={currentTime}
                  activeEvent={activeEvent}
                  onSeek={(time, endTime) => seekTo(time, endTime)}
                  onActiveEventChange={(ev) => setActiveEvent(ev)}
                  cinematic={demoMode}
                />
              </Card>

              {isMomentPanelOpen ? (
                <motion.div
                  id="demo-moments"
                  className="lg:col-span-4 space-y-4"
                  initial={{ opacity: 0, x: 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                <Card id="demo-best" className="p-4 rounded-xl shadow-sm bg-white/5 border border-white/10 backdrop-blur text-white hover:scale-[1.005] transition-transform">
                  <BestMomentsPanel
                    moments={cards.bestMoments}
                    onClickMoment={(t0, t1) => {
                      setActiveEvent({ metric: "best_moment", t0, t1, note: "Strong delivery with high engagement" });
                      seekTo(t0, t1);
                    }}
                  />
                </Card>
                <Card id="demo-worst" className="p-4 rounded-xl shadow-sm bg-white/5 border border-white/10 backdrop-blur text-white hover:scale-[1.005] transition-transform">
                  <WorstMomentsPanel
                    moments={cards.worstMoments}
                    activeT0={activeEvent?.t0}
                    onClose={() => setIsMomentPanelOpen(false)}
                    onClickMoment={(t0, t1, reason) => {
                      setActiveEvent({ metric: "worst_moment", t0, t1, note: reason });
                      seekTo(t0, t1);
                    }}
                  />
                </Card>
                <Card id="demo-clips" className="p-4 rounded-xl shadow-sm bg-white/5 border border-white/10 backdrop-blur text-white hover:scale-[1.005] transition-transform">
                  <ClipsPanel
                    clips={cards.clips}
                    clipPreviewUrl={clipPreviewUrl}
                    onClickClip={(c) => {
                      setClipPreviewUrl(`${API_BASE}${c.url}`);
                      seekTo(Number(c.t0 || 0), Number(c.t1 || c.t0 || 0));
                    }}
                  />
                </Card>
                <Card id="demo-coach" className="p-4 rounded-xl shadow-sm bg-white/5 border border-white/10 backdrop-blur text-white hover:scale-[1.005] transition-transform">
                  <CoachPanel comments={cards.coachComments} onClickComment={(t0) => seekTo(t0)} />
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="text-sm font-semibold mb-2">⏱ Pauses</div>
                    <div className="space-y-2 max-h-[120px] overflow-auto">
                      {cards.pauses.length ? (
                        cards.pauses.map((p, i) => (
                          <button
                            key={`${i}-${p.t0}`}
                            type="button"
                            className="w-full text-left border border-white/10 rounded-lg px-3 py-2 hover:bg-white/10"
                            onClick={() => seekTo(Number(p.t0 || 0), Number(p.t1 || p.t0 || 0))}
                          >
                            <div className="text-xs font-semibold">
                              {formatTime(Number(p.t0 || 0))} - {formatTime(Number(p.t1 || p.t0 || 0))}
                            </div>
                            <div className="text-[11px] text-slate-300">{p.note || "Long pause detected"}</div>
                          </button>
                        ))
                      ) : (
                        <div className="text-xs text-slate-300">No long pauses detected.</div>
                      )}
                    </div>
                  </div>
                </Card>
                </motion.div>
              ) : null}
            </div>
          ) : null}
          {result && showValueSlide ? (
            <Card id="demo-value" className="col-span-12 p-4 bg-white/5 border border-white/10 backdrop-blur text-white">
              <div className="text-sm font-semibold mb-3">Description View</div>
              {demoMode ? (
                <div className="mb-4 rounded-xl border border-cyan-300/30 bg-cyan-400/10 p-4">
                  <div className="text-3xl font-bold">From feedback → to performance intelligence</div>
                  <div className="text-slate-300 mt-1">Know exactly where you improve communication.</div>
                  <button
                    type="button"
                    className="mt-4 px-4 py-2 rounded-lg bg-cyan-400 text-slate-950 font-semibold hover:scale-105 transition-transform"
                    onClick={() => setDemoMode(false)}
                  >
                    Try Your Own Video
                  </button>
                </div>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    metric: "Speech Rate",
                    analyzed: "How fast you speak during detected speech segments.",
                    measured: `Words/min = words / speaking minutes. Current: ${
                      typeof cards.wpm === "number" ? Math.round(cards.wpm) : "N/A"
                    } WPM.`,
                    improve: ["Target 95-160 WPM.", "Pause after key points."],
                  },
                  {
                    metric: "Tonal Variation",
                    analyzed: "Pitch movement and vocal variety.",
                    measured: `Computed with librosa piptrack pitch std. Label: ${
                      cards.tonalLabel ? labelCase(String(cards.tonalLabel)) : "N/A"
                    }.`,
                    improve: ["Stress key words.", "Vary intonation per sentence."],
                  },
                  {
                    metric: "Filler Words",
                    analyzed: 'Filler terms like "um", "uh", "like", "you know".',
                    measured: `Counted from transcript and normalized per minute. Current: ${
                      typeof cards.fillers === "number" ? cards.fillers.toFixed(1) : "N/A"
                    }/min.`,
                    improve: ["Replace fillers with short silence.", "Start slower."],
                  },
                  {
                    metric: "Eye Contact Ratio",
                    analyzed: "How often gaze is on camera when face is visible.",
                    measured: `On-camera face frames / face-detected frames. Current: ${
                      typeof cards.eye === "number" ? `${Math.round(cards.eye * 100)}%` : "N/A"
                    }.`,
                    improve: ["Look at camera during sentence endings.", "Keep notes near webcam."],
                  },
                  {
                    metric: "Expression Change",
                    analyzed: "Frequency of expression transitions.",
                    measured: `Expression label changes per minute. Current: ${
                      Number.isFinite(cards.exprChangesPerMin) ? cards.exprChangesPerMin.toFixed(1) : "N/A"
                    }/min.`,
                    improve: ["Use deliberate expression shifts.", "Add positive expression on key moments."],
                  },
                  {
                    metric: "Gesture Frequency",
                    analyzed: "How often gesture events happen.",
                    measured: `Gesture events/min with movement threshold + cooldown. Current: ${
                      typeof cards.gestures === "number" ? cards.gestures.toFixed(1) : "N/A"
                    }/min.`,
                    improve: ["Use one gesture per idea.", "Keep gestures in chest-level frame."],
                  },
                ].map((d) => (
                  <div key={d.metric} className="border border-black/5 rounded-lg p-3">
                    <div className="font-semibold text-sm">{d.metric}</div>
                    <div className="text-xs text-muted mt-2">
                      <span className="font-medium text-ink">Analyzed:</span> {d.analyzed}
                    </div>
                    <div className="text-xs text-muted mt-1">
                      <span className="font-medium text-ink">Measured:</span> {d.measured}
                    </div>
                    <div className="text-xs text-muted mt-1">
                      <span className="font-medium text-ink">How to improve:</span>
                    </div>
                    <ul className="text-xs text-muted list-disc pl-5 mt-1">
                      {d.improve.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          {collectionSummary && !demoMode ? (
            <Card className="col-span-12 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{labelCase(activeChannelName)}&apos;s Overall Analysis</div>
                <div className="text-xs">
                  {collectionSummary.processing_videos === 0 ? (
                    <span className="px-2 py-1 rounded bg-green-100 text-green-700">
                      All done ({collectionSummary.completed_videos}/{collectionSummary.total_videos})
                    </span>
                  ) : (
                    <span className="text-muted">
                      {collectionSummary.completed_videos}/{collectionSummary.total_videos} completed
                    </span>
                  )}
                </div>
              </div>
              {collectionSummary.completed_videos === 0 ? (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Waiting for completed videos to compute overall patterns. Aggregates will appear automatically
                  after the first video finishes.
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                <div className="rounded-md border border-black/5 p-2">
                  <div className="text-muted">Completed</div>
                  <div className="font-semibold">{collectionSummary.completed_videos}</div>
                </div>
                <div className="rounded-md border border-black/5 p-2">
                  <div className="text-muted">Processing/Queued</div>
                  <div className="font-semibold">{collectionSummary.processing_videos}</div>
                </div>
                <div className="rounded-md border border-black/5 p-2">
                  <div className="text-muted">Failed</div>
                  <div className="font-semibold">{collectionSummary.failed_videos}</div>
                </div>
                <div className="rounded-md border border-black/5 p-2">
                  <div className="text-muted">Collection ID</div>
                  <div className="font-semibold truncate" title={collectionSummary.collection_id}>
                    {collectionSummary.collection_id}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-md border border-black/5 p-3">
                  <div className="text-xs font-semibold mb-2">Common Patterns (Similar / Same)</div>
                  <ul className="text-xs text-muted space-y-1">
                    {Object.entries(collectionSummary.summary.common_patterns).length ? (
                      Object.entries(collectionSummary.summary.common_patterns).map(([k, v]) => (
                        <li key={k}>
                          {k}: <span className="font-medium text-ink">{v.most_common}</span> ({v.count}/
                          {collectionSummary.completed_videos}, {Math.round(v.share * 100)}%)
                        </li>
                      ))
                    ) : (
                      <li>Not enough completed videos yet.</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-md border border-black/5 p-3">
                  <div className="text-xs font-semibold mb-2">Consistency</div>
                  <ul className="text-xs text-muted space-y-1">
                    {Object.entries(collectionSummary.summary.consistency).length ? (
                      Object.entries(collectionSummary.summary.consistency).map(([k, v]) => (
                        <li key={k}>
                          {k}: mean {v.mean ?? "-"}, std {v.std ?? "-"} (min {v.min ?? "-"}, max {v.max ?? "-"})
                        </li>
                      ))
                    ) : (
                      <li>Not enough completed videos yet.</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-md border border-black/5 p-3">
                  <div className="text-xs font-semibold mb-2">Recurring Strengths</div>
                  <ul className="text-xs text-muted space-y-1">
                    {collectionSummary.summary.recurring_strengths.length ? (
                      collectionSummary.summary.recurring_strengths.map((x) => (
                        <li key={x.pattern}>
                          {x.pattern} ({x.count})
                        </li>
                      ))
                    ) : (
                      <li>-</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-md border border-black/5 p-3">
                  <div className="text-xs font-semibold mb-2">Recurring Issues</div>
                  <ul className="text-xs text-muted space-y-1">
                    {collectionSummary.summary.recurring_issues.length ? (
                      collectionSummary.summary.recurring_issues.map((x) => (
                        <li key={x.pattern}>
                          {x.pattern} ({x.count})
                        </li>
                      ))
                    ) : (
                      <li>-</li>
                    )}
                  </ul>
                </div>
              </div>
              <div className="mt-4 rounded-md border border-black/5 p-3">
                <div className="text-xs font-semibold mb-2">Per-video Contribution</div>
                {collectionSummary.summary.per_video?.length ? (
                  <div className="max-h-44 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="text-left px-2 py-1">Video ID</th>
                          <th className="text-left px-2 py-1">Score</th>
                          <th className="text-left px-2 py-1">Key Issue</th>
                          <th className="text-left px-2 py-1">Key Strength</th>
                        </tr>
                      </thead>
                      <tbody>
                        {collectionSummary.summary.per_video.map((v) => (
                          <tr key={v.job_id} className="border-t">
                            <td className="px-2 py-1 truncate max-w-[280px]" title={v.job_id}>
                              {v.job_id}
                            </td>
                            <td className="px-2 py-1">{v.score}</td>
                            <td className="px-2 py-1">{v.key_issue}</td>
                            <td className="px-2 py-1">{v.key_strength}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-muted">Not enough completed videos yet.</div>
                )}
              </div>
              <div className="mt-3 text-xs text-muted">
                Failed videos:{" "}
                <span className="font-medium text-ink">
                  {collectionSummary.summary.failed_job_ids?.length
                    ? collectionSummary.summary.failed_job_ids.join(", ")
                    : "-"}
                </span>
              </div>
              <div className="mt-3 text-xs text-muted">
                Best video: <span className="font-medium text-ink">{collectionSummary.summary.best_video ?? "-"}</span>{" "}
                | Worst video: <span className="font-medium text-ink">{collectionSummary.summary.worst_video ?? "-"}</span>
              </div>
            </Card>
          ) : null}
        </motion.div>
      </motion.div>
      {demoMode && demoStarted ? (
        <DemoOverlay
          step={demoSteps[currentStep]}
          index={currentStep}
          total={demoSteps.length}
          spotlight={demoSpotlight}
          onPrev={() => setCurrentStep((s) => Math.max(0, s - 1))}
          onNext={() => setCurrentStep((s) => Math.min(demoSteps.length - 1, s + 1))}
          onSkip={() => {
            setDemoMode(false);
            setDemoStarted(false);
          }}
          onExport={exportDemoScreens}
          canPrev={currentStep > 0}
          canNext={currentStep < demoSteps.length - 1}
        />
      ) : null}
    </div>
  );
}

