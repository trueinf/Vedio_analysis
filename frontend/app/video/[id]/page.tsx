"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

import { Card, premiumSurfaceClass } from "@/components/ui";
import { InsightsPanel } from "@/components/InsightsPanel";
import MetricCard from "@/components/MetricCard";
import { Timeline } from "@/components/Timeline";
import { MomentsPanel } from "@/components/MomentsPanel";
import { CoachPanel } from "@/components/CoachPanel";

import type { AnalysisDetail } from "@/lib/api";
import { getAnalysisDetail, getApiBaseUrl } from "@/lib/api";
import { supabase as sbClient } from "@/lib/supabaseClient";

import type { MetricEvent } from "@/components/video-analysis-types";

const formatTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
};

function eventToQualityEvent(e: any): MetricEvent {
  if (!e) return { t0: 0, metric: "", label: "" };
  return {
    metric: e.metric ?? e.type,
    type: e.type,
    label: e.label ?? e.message ?? e.note ?? e.reason ?? "",
    t0: Number(e.t0 ?? 0),
    t1: e.t1 == null ? undefined : Number(e.t1),
    value: e.value == null ? undefined : Number(e.value),
    note: e.note,
    message: e.message,
  };
}

function deriveKeyInsights(result: any, durationSec: number): { insights: string[]; drops: { t0: number; t1?: number; note?: string }[] } {
  const events: any[] = result?.events ?? [];
  const engagementDrops: any[] = result?.engagement_drops ?? [];

  const candidates: any[] = [...events, ...engagementDrops];
  const scored = candidates
    .map((e) => {
      const t0 = Number(e.t0 ?? 0);
      const metric = String(e.metric ?? e.type ?? "");
      const label = String(e.label ?? e.message ?? e.note ?? e.reason ?? "");
      const lbl = label.toLowerCase();

      let score = 0;
      // Heuristic: "badness" patterns.
      if (metric.includes("engagement_drop")) score += 80;
      if (metric.includes("eye_contact") && lbl.includes("low")) score += 70;
      if (metric.includes("filler_words") && lbl.includes("high")) score += 65;
      if (metric.includes("tonal_variation") && (lbl.includes("monotone") || lbl.includes("flat"))) score += 60;
      if (metric.includes("worst_moment")) score += 75;

      // If the orchestrator already provides a severity-like field, add it.
      const sev = Number(e.severity ?? 0);
      if (Number.isFinite(sev)) score += Math.min(30, sev);

      // Prefer earlier events slightly (faster wins).
      score += Math.max(0, 20 - t0 / Math.max(1, durationSec) * 20);

      return { e, score, t0 };
    })
    .sort((a, b) => b.score - a.score || a.t0 - b.t0)
    .slice(0, 5);

  const drops = scored
    .sort((a, b) => a.t0 - b.t0)
    .map((x) => {
      const e = x.e;
      const metric = String(e.metric ?? e.type ?? "");
      const label = String(e.label ?? e.message ?? e.note ?? e.reason ?? "");
      const lbl = label.toLowerCase();
      const t0 = Number(e.t0 ?? 0);
      const t1 = e.t1 == null ? undefined : Number(e.t1);

      let note = "";
      if (metric.includes("engagement_drop")) note = `Low engagement at ${formatTime(t0)}`;
      else if (metric.includes("worst_moment")) note = `Low engagement moment at ${formatTime(t0)}`;
      else if (metric.includes("best_moment")) note = `High engagement moment at ${formatTime(t0)}`;
      else if (metric.includes("eye_contact") && lbl.includes("low")) note = `Low eye contact at ${formatTime(t0)}`;
      else if (metric.includes("filler_words") && lbl.includes("high")) note = `High filler usage early (${formatTime(t0)})`;
      else if (metric.includes("tonal_variation") && (lbl.includes("monotone") || lbl.includes("flat"))) note = `Monotone delivery near ${formatTime(t0)}`;
      else note = `${metric || "Issue"} at ${formatTime(t0)}`;

      return { t0, t1, note };
    });

  return { insights: drops.map((d) => d.note || "Key insight"), drops };
}

async function resolveSignedVideoUrl(params: { storagePath: string; bucket: string }) {
  const { storagePath, bucket } = params;
  if (!storagePath) return "";

  // Preferred: ask backend to create a signed download URL (service role key, no browser policies).
  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/supabase/storage/signed-download-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket, path: storagePath, expires_in_sec: 3600 }),
    });
    if (res.ok) {
      const data: any = await res.json();
      const signed = String(data?.signed_url || "");
      if (signed) return signed;
    }
  } catch {
    // fall through
  }

  // Fallback: supabase-js (requires NEXT_PUBLIC_SUPABASE_* and Storage policies).
  if (!sbClient) return "";

  // supabase-js supports `createSignedUrl` for private buckets when RLS/policies allow.
  try {
    const res: any = await (sbClient as any).storage.from(bucket).createSignedUrl(storagePath, 60 * 60);
    const signedUrl = res?.data?.signedUrl || res?.signedUrl || res?.data?.signed_url || "";
    return String(signedUrl || "");
  } catch {
    return "";
  }
}

export default function VideoDetailPage() {
  const params = useParams();
  const analysisId = String((params as any)?.id || "");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [videoSrcErr, setVideoSrcErr] = useState<string>("");
  const [decodeErr, setDecodeErr] = useState<string>("");
  const pendingSeekRef = useRef<number | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    // Read ?t= from URL without useSearchParams (keeps build happy).
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("t");
    if (!raw) return;
    const t = Number(raw);
    if (!Number.isFinite(t) || t < 0) return;
    pendingSeekRef.current = t;
    setCurrentTime(t);
  }, [analysisId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!analysisId) return;
      setLoading(true);
      setErr("");
      setDetail(null);
      setVideoSrc("");
      setVideoSrcErr("");
      setDecodeErr("");
      try {
        const d = await getAnalysisDetail(analysisId);
        if (!alive) return;
        setDetail(d as any);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load analysis");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [analysisId]);

  const durationSec = useMemo(() => {
    const fromJob = detail?.job?.duration_sec ?? 0;
    const fromSummary = (detail?.result_json as any)?.summary?.duration_sec ?? 0;
    const n = Number(fromJob || fromSummary || 0);
    return n > 0 ? n : 1;
  }, [detail]);

  const status = detail?.job?.status ?? (detail?.analysis as any)?.status ?? "queued";
  const progressPercent = detail?.job?.progress_percent ?? 0;

  const seekTo = (t0: number) => {
    const t = Math.max(0, Number(t0 || 0));
    setCurrentTime(t);
    const v = videoRef.current;
    if (v) {
      try {
        if (!videoReady || Number.isNaN(v.duration) || !Number.isFinite(v.duration)) {
          pendingSeekRef.current = t;
        } else {
          v.currentTime = t;
          pendingSeekRef.current = null;
        }
      } catch {
        // ignore seeking errors
      }
    } else {
      pendingSeekRef.current = t;
    }
  };

  const onSeek = (t0: number, _t1?: number) => {
    seekTo(t0);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!detail) return;
      const analysis: any = detail.analysis;
      const videoUrl = String(analysis?.video_url || "");
      const storagePath = String(analysis?.video_storage_path || "");

      if (videoUrl) {
        if (alive) setVideoSrc(videoUrl);
        return;
      }
      if (!storagePath) {
        if (alive) setVideoSrcErr("Video playback unavailable (missing storage path).");
        return;
      }

      const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "videos";
      const signedUrl = await resolveSignedVideoUrl({ storagePath, bucket });
      if (!alive) return;
      if (!signedUrl) {
        setVideoSrcErr("Could not generate signed playback URL. Showing insights without playback.");
        return;
      }
      setVideoSrc(signedUrl);
    })();
    return () => {
      alive = false;
    };
  }, [detail]);

  const result = detail?.result_json as any;
  const cards = result?.cards ?? {};

  const metrics = useMemo(() => {
    const wpm = Number(cards?.speech_rate?.wpm ?? NaN);
    const eye = Number(cards?.eye_contact?.on_camera_ratio ?? NaN);
    const fillers = Number(cards?.filler_words?.per_minute ?? NaN);
    const gestures = Number(cards?.gestures?.per_minute ?? NaN);
    const tonalLabel = String(cards?.tonal_variation?.label ?? "");
    const tonalScore =
      typeof cards?.tonal_variation?.score === "number"
        ? Number(cards?.tonal_variation?.score)
        : Number(cards?.tonal_variation?.pitch_hz?.std ?? NaN);

    const exprChanges = Number(cards?.expressions?.change_count ?? NaN);
    const exprPerMin = durationSec > 0 && Number.isFinite(exprChanges) ? exprChanges / (durationSec / 60) : NaN;

    const speechTone: "good" | "moderate" | "poor" | "neutral" = Number.isFinite(wpm)
      ? wpm >= 120 && wpm <= 160
        ? "good"
        : wpm >= 95 && wpm <= 175
          ? "moderate"
          : "poor"
      : "neutral";
    const eyeTone: "good" | "moderate" | "poor" | "neutral" = Number.isFinite(eye)
      ? eye >= 0.5
        ? "good"
        : eye >= 0.3
          ? "moderate"
          : "poor"
      : "neutral";
    const fillersTone: "good" | "moderate" | "poor" | "neutral" = Number.isFinite(fillers)
      ? fillers <= 2
        ? "good"
        : fillers <= 5
          ? "moderate"
          : "poor"
      : "neutral";
    const gesturesTone: "good" | "moderate" | "poor" | "neutral" = Number.isFinite(gestures)
      ? gestures >= 4 && gestures <= 20
        ? "good"
        : gestures >= 2 && gestures < 4
          ? "moderate"
          : "poor"
      : "neutral";
    const tonalLabelLower = tonalLabel.toLowerCase();
    const tonalFinalTone: "good" | "moderate" | "poor" | "neutral" = tonalLabelLower.includes("expressive")
      ? "good"
      : tonalLabelLower.includes("moderate")
        ? "moderate"
        : tonalLabelLower.includes("monotone") || tonalLabelLower.includes("flat")
          ? "poor"
          : tonalLabelLower
            ? "neutral"
            : "neutral";

    const exprTone: "good" | "moderate" | "poor" | "neutral" = Number.isFinite(exprPerMin)
      ? exprPerMin >= 60
        ? "good"
        : exprPerMin >= 20
          ? "moderate"
          : "poor"
      : "neutral";

    return {
      speech: { value: Number.isFinite(wpm) ? `${Math.round(wpm)} WPM` : "—", label: speechTone === "good" ? "Good" : speechTone === "moderate" ? "Moderate" : "Poor", tone: speechTone },
      eye: { value: Number.isFinite(eye) ? `${Math.round(eye * 100)}%` : "—", label: eyeTone === "good" ? "Good" : eyeTone === "moderate" ? "Moderate" : "Poor", tone: eyeTone },
      fillers: { value: Number.isFinite(fillers) ? fillers.toFixed(1) : "—", label: fillersTone === "good" ? "Good" : fillersTone === "moderate" ? "Moderate" : "Poor", tone: fillersTone },
      gestures: { value: Number.isFinite(gestures) ? gestures.toFixed(1) : "—", label: gesturesTone === "good" ? "Good" : gesturesTone === "moderate" ? "Moderate" : "Poor", tone: gesturesTone },
      tonal: { value: Number.isFinite(tonalScore) ? tonalScore.toFixed(1) : "—", label: tonalFinalTone === "good" ? "Good" : tonalFinalTone === "moderate" ? "Moderate" : "Poor", tone: tonalFinalTone },
      expr: { value: Number.isFinite(exprPerMin) ? exprPerMin.toFixed(1) : "—", label: exprTone === "good" ? "Good" : exprTone === "moderate" ? "Moderate" : "Poor", tone: exprTone },
    };
  }, [cards, durationSec]);

  const keyInsights = useMemo(() => deriveKeyInsights(result, durationSec), [result, durationSec]);

  const timelineEvents = useMemo(() => {
    const events: any[] = result?.events ?? [];
    const drops: any[] = result?.engagement_drops ?? [];
    const pauses: any[] = result?.pauses ?? [];
    const best: any[] = result?.best_moments ?? [];
    const worst: any[] = result?.worst_moments ?? [];

    const mapped: MetricEvent[] = [];
    for (const e of events) mapped.push(eventToQualityEvent(e));
    for (const e of drops) mapped.push({ ...eventToQualityEvent(e), metric: e.metric ?? e.type ?? "engagement_drop", type: e.type ?? e.metric ?? "engagement_drop" });
    for (const e of pauses) mapped.push({ ...eventToQualityEvent(e), metric: "pause", type: "pause", label: e.reason ?? e.label ?? e.note ?? "Pause" });
    for (const e of best) mapped.push({ ...eventToQualityEvent(e), metric: "best_moment", type: "best_moment", label: e.note ?? e.label ?? "Best moment" });
    for (const e of worst) mapped.push({ ...eventToQualityEvent(e), metric: "worst_moment", type: "worst_moment", label: e.reason ?? e.label ?? "Worst moment" });

    return mapped.sort((a, b) => Number(a.t0 || 0) - Number(b.t0 || 0));
  }, [result]);

  const worstMoments = useMemo(() => {
    const wm = (result?.worst_moments ?? []) as any[];
    return wm.map((x) => ({ t0: Number(x.t0 ?? 0), t1: x.t1 == null ? Number(x.t0 ?? 0) : Number(x.t1), reason: String(x.reason ?? x.label ?? "Moment issue") }));
  }, [result]);

  const bestMoments = useMemo(() => {
    const bm = (result?.best_moments ?? []) as any[];
    return bm.map((x) => ({ t0: Number(x.t0 ?? 0), t1: x.t1 == null ? Number(x.t0 ?? 0) : Number(x.t1), note: String(x.note ?? x.label ?? "Strong moment") }));
  }, [result]);

  const coachComments = useMemo(() => {
    const cc = (result?.coach_comments ?? []) as any[];
    const rows = cc?.length
      ? cc.map((x) => ({ t0: Number(x.t0 ?? 0), comment: String(x.comment ?? x.text ?? "") })).filter((x) => x.comment)
      : (() => {
          const priorities = (result?.priorities ?? []) as any[];
          return priorities
            .slice(0, 6)
            .map((p) => ({ t0: Number(p.t0 ?? 0), comment: String(p.why_now ?? p.why ?? p.title ?? "") }))
            .filter((x) => x.comment);
        })();

    const seen = new Set<string>();
    const out: { t0: number; comment: string }[] = [];
    for (const r of rows) {
      const key = r.comment.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [result]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold tracking-tight text-3xl">Video Detail</div>
          <div className="text-slate-300 text-sm mt-1">{loading ? "" : String(detail?.analysis?.original_filename ?? detail?.analysis?.title ?? analysisId)}</div>
        </div>
        <div className="text-right">
          {status ? (
            <div className="text-sm text-slate-300">
              Status: <span className="text-white font-medium">{status}</span>
              {status === "processing" || status === "queued" ? (
                <span className="text-slate-400"> · {progressPercent ? `${Math.round(progressPercent)}%` : "—"} </span>
              ) : null}
            </div>
          ) : null}
          {err ? <div className="mt-2 text-red-300 text-sm">{err}</div> : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-white/5 border border-white/10 rounded-2xl h-96 animate-pulse" />
          <div className="lg:col-span-4 bg-white/5 border border-white/10 rounded-2xl h-96 animate-pulse" />
        </div>
      ) : err ? (
        <div className="mt-8 text-red-300 text-sm">{err}</div>
      ) : (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            {/* Avoid backdrop-blur on the player card: it can break GPU compositing and show a black picture while audio plays. */}
            <Card className="p-4 rounded-2xl bg-white/5 border border-white/10 text-white">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-semibold">Player</div>
                <div className="text-xs text-slate-400">Seek by clicking insights or timeline</div>
              </div>
              <div className="relative z-10 isolate rounded-xl overflow-hidden border border-white/10 bg-black">
                {videoSrc ? (
                  <video
                    ref={videoRef}
                    src={videoSrc}
                    controls
                    playsInline
                    preload="metadata"
                    className="block w-full max-h-[min(72vh,900px)] min-h-[200px] bg-black object-contain [transform:translateZ(0)]"
                    onTimeUpdate={(e) => setCurrentTime(Number((e.currentTarget as HTMLVideoElement).currentTime || 0))}
                    onLoadedMetadata={() => {
                      setVideoReady(true);
                      try {
                        const v = videoRef.current;
                        const pending = pendingSeekRef.current;
                        if (v && pending != null) {
                          v.currentTime = Math.max(0, pending);
                          pendingSeekRef.current = null;
                          setCurrentTime(v.currentTime || pending);
                        } else if (v) {
                          setCurrentTime(v.currentTime || 0);
                        }
                      } catch {
                        // ignore
                      }
                    }}
                    onCanPlay={() => {
                      setVideoReady(true);
                      try {
                        const v = videoRef.current;
                        const pending = pendingSeekRef.current;
                        if (v && pending != null) {
                          v.currentTime = Math.max(0, pending);
                          pendingSeekRef.current = null;
                          setCurrentTime(v.currentTime || pending);
                        }
                      } catch {
                        // ignore
                      }
                    }}
                    onError={() => {
                      const v = videoRef.current;
                      const code = v?.error?.code;
                      const map: Record<number, string> = {
                        1: "Playback aborted",
                        2: "Network error",
                        3: "Decode failed (codec may be unsupported in this browser)",
                        4: "Source not supported",
                      };
                      setDecodeErr(code != null ? map[code] ?? "Playback error" : "Playback error");
                    }}
                  />
                ) : (
                  <div className="h-[360px] flex items-center justify-center text-slate-300 text-sm">
                    Video preview unavailable
                  </div>
                )}
              </div>
              {videoSrcErr ? <div className="mt-2 text-xs text-slate-300">{videoSrcErr}</div> : null}
              {decodeErr ? <div className="mt-2 text-xs text-amber-200">{decodeErr}</div> : null}
            </Card>

            <InsightsPanel
              insights={keyInsights.insights}
              engagementDrops={keyInsights.drops}
              confidenceScore={Number(detail?.analysis?.confidence_score ?? result?.confidence_score ?? 0) || 0}
              energyScore={Number(detail?.analysis?.energy_score ?? result?.energy_score ?? 0) || 0}
              duration={durationSec}
              onSeek={(t) => onSeek(t)}
            />

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur">
              <div className="text-sm font-semibold mb-3">Metrics</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                <MetricCard title="Speech Rate" value={metrics.speech.value} label={metrics.speech.label} tone={metrics.speech.tone as any} description="Higher isn’t always better—aim for steady, conversational pacing." onClick={() => seekTo(0)} />
                <MetricCard title="Eye Contact" value={metrics.eye.value} label={metrics.eye.label} tone={metrics.eye.tone as any} description="On-camera time reflects connection and confidence." onClick={() => seekTo(0)} />
                <MetricCard title="Fillers" value={metrics.fillers.value} label={metrics.fillers.label} tone={metrics.fillers.tone as any} description="Lower filler usage keeps your message crisp." onClick={() => seekTo(0)} />
                <MetricCard title="Gestures" value={metrics.gestures.value} label={metrics.gestures.label} tone={metrics.gestures.tone as any} description="Good gesture frequency improves clarity and engagement." onClick={() => seekTo(0)} />
                <MetricCard title="Tonal Variation" value={metrics.tonal.value} label={metrics.tonal.label} tone={metrics.tonal.tone as any} description="Expressive tone helps retain attention and signal emphasis." onClick={() => seekTo(0)} />
                <MetricCard title="Expression Change" value={metrics.expr.value} label={metrics.expr.label} tone={metrics.expr.tone as any} description="Meaningful facial changes help your delivery feel dynamic." onClick={() => seekTo(0)} />
              </div>
            </div>

            <Timeline events={timelineEvents} durationSec={durationSec} currentTime={currentTime} onSeek={(t) => seekTo(t)} />

            <MomentsPanel worstMoments={worstMoments} bestMoments={bestMoments} onSeek={(t0, _t1) => seekTo(t0)} />
          </div>

          <div className="lg:col-span-4 space-y-6">
            <Card className={`p-4 rounded-2xl ${premiumSurfaceClass}`}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">AI Coach</div>
                <div className="text-xs text-slate-400">Actionable suggestions</div>
              </div>
              <div className="mt-3">
                <CoachPanel comments={coachComments.map((x) => ({ t0: x.t0, comment: x.comment }))} onClickComment={(t0) => seekTo(t0)} />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

