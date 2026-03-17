"use client";

import { useEffect, useMemo, useState } from "react";
import { getJob, getResult, uploadVideo } from "../lib/api";
import { Button, Card } from "../components/ui";
import { Gauge } from "../components/gauge";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function StatCard(props: {
  title: string;
  subtitle: string;
  value: string;
  badge: { text: string; tone: "good" | "warn" | "bad" | "neutral" };
}) {
  const tone =
    props.badge.tone === "good"
      ? "bg-green-100 text-green-700"
      : props.badge.tone === "warn"
      ? "bg-amber-100 text-amber-700"
      : props.badge.tone === "bad"
      ? "bg-red-100 text-red-700"
      : "bg-slate-100 text-slate-700";
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold">{props.title}</div>
      <div className="text-xs text-muted mt-0.5">{props.subtitle}</div>
      <div className="mt-3 flex items-end justify-between">
        <div className="text-3xl font-semibold leading-none">{props.value}</div>
        <div className={`text-xs px-2 py-1 rounded-md ${tone}`}>{props.badge.text}</div>
      </div>
    </Card>
  );
}

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [jobError, setJobError] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function startUpload() {
    if (!file) return;
    setBusy(true);
    setJobError("");
    setResult(null);
    try {
      const u = await uploadVideo(file);
      setJobId(u.job_id);
      setStatus(u.status);
      setStage("queued");
      setProgress(0);
    } catch (e: any) {
      setJobError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!jobId) return;
    setBusy(true);
    setJobError("");
    try {
      const job = await getJob(jobId);
      setStatus(job.status);
      // @ts-expect-error backend returns stage/progress
      setStage((job as any).stage ?? "");
      // @ts-expect-error backend returns stage/progress
      setProgress(Number((job as any).progress ?? 0));
      if (job.status === "failed") setJobError(job.error_message || "Job failed");
      if (job.status === "completed") {
        const r = await getResult(jobId);
        setResult(r);
      }
    } catch (e: any) {
      setJobError(e?.message ?? "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!jobId) return;
    if (status !== "queued" && status !== "processing") return;
    const t = setInterval(() => {
      refresh().catch(() => {});
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status]);

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
      events: (result?.events ?? []) as { t0: number; type: string; message?: string }[],
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
    };
  }, [result]);

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center text-white font-semibold">
              ▶
            </div>
            <div>
              <div className="font-semibold">AI Video Performance Analyzer</div>
              <div className="text-xs text-muted">Upload a video and get delivery insights</div>
            </div>
          </div>

          <div className="text-sm text-muted">Dashboard</div>
        </div>

        <div className="mt-6 grid grid-cols-12 gap-5">
          <Card className="col-span-12 lg:col-span-7 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Video</div>
              {jobId ? <div className="text-xs text-muted">Job: {jobId}</div> : null}
            </div>
            <div className="mt-3 border border-black/5 rounded-xl overflow-hidden bg-black/5 aspect-video flex items-center justify-center text-muted text-sm">
              Video preview will appear here (optional)
            </div>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              <Button onClick={startUpload} disabled={!file || busy}>
                Analyze
              </Button>
              <Button variant="ghost" onClick={refresh} disabled={!jobId || busy}>
                Refresh
              </Button>
              <div className="text-sm text-muted">
                Status: <span className="font-medium text-ink">{status || "-"}</span>
              </div>
              {status === "processing" || status === "queued" ? (
                <div className="text-xs text-muted">
                  Stage: <span className="font-medium text-ink">{stage || "-"}</span>{" "}
                  {progress ? <span className="text-muted">({Math.round(progress * 100)}%)</span> : null}
                </div>
              ) : null}
              {jobError ? <div className="text-sm text-bad">{jobError}</div> : null}
            </div>
          </Card>

          <div className="col-span-12 lg:col-span-5 grid gap-5">
            <Card className="p-4">
              <div className="text-sm font-semibold">Overall Score</div>
              <div className="mt-2 flex items-center justify-between">
                <Gauge value={cards.score} label="Good" />
                <div className="ml-2 flex-1">
                  {cards.warnings?.length ? (
                    <div className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      {cards.warnings[0]}
                    </div>
                  ) : null}
                  <div className="text-sm font-semibold mb-2">Key Improvement Tips</div>
                  <ul className="text-sm text-muted list-disc pl-5 space-y-1">
                    {cards.tips.slice(0, 4).map((t: string, i: number) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">AI Feedback</div>
                <div className="text-xs text-muted">Suggestions</div>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                {cards.suggestions.slice(0, 3).map((s: string, i: number) => (
                  <div key={i} className="flex gap-2">
                    <div className="mt-1 w-2 h-2 rounded-full bg-primary" />
                    <div className="text-muted">{s}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 gap-5">
            <StatCard
              title="Speech Rate"
              subtitle="Words Per Minute"
              value={typeof cards.wpm === "number" ? `${Math.round(cards.wpm)} WPM` : `${cards.wpm}`}
              badge={(() => {
                const w = Number(cards.wpm);
                if (!Number.isFinite(w)) return { text: "—", tone: "neutral" as const };
                if (w < 95) return { text: "Slow", tone: "warn" as const };
                if (w > 160) return { text: "Fast", tone: "warn" as const };
                return { text: "Normal", tone: "good" as const };
              })()}
            />
            <StatCard
              title="Filler Words"
              subtitle="Per Minute"
              value={typeof cards.fillers === "number" ? `${cards.fillers.toFixed(1)}` : `${cards.fillers}`}
              badge={(() => {
                const f = Number(cards.fillers);
                if (!Number.isFinite(f)) return { text: "—", tone: "neutral" as const };
                if (f <= 2) return { text: "Low", tone: "good" as const };
                if (f <= 5) return { text: "Moderate", tone: "warn" as const };
                return { text: "High", tone: "bad" as const };
              })()}
            />
            <StatCard
              title="Eye Contact"
              subtitle="On Camera Time"
              value={typeof cards.eye === "number" ? `${Math.round(cards.eye * 100)}%` : `${cards.eye}`}
              badge={(() => {
                const e = Number(cards.eye);
                if (!Number.isFinite(e) || e < 0) return { text: "—", tone: "neutral" as const };
                const pct = e * 100;
                if (pct >= 50) return { text: "Good", tone: "good" as const };
                if (pct >= 30) return { text: "Decent", tone: "warn" as const };
                return { text: "Low", tone: "bad" as const };
              })()}
            />
            <StatCard
              title="Gestures"
              subtitle="Actions Per Minute"
              value={typeof cards.gestures === "number" ? `${cards.gestures.toFixed(1)}` : `${cards.gestures}`}
              badge={(() => {
                const g = Number(cards.gestures);
                if (!Number.isFinite(g)) return { text: "—", tone: "neutral" as const };
                if (g < 4) return { text: "Low", tone: "warn" as const };
                if (g <= 20) return { text: "Normal", tone: "good" as const };
                return { text: "High", tone: "warn" as const };
              })()}
            />
          </div>

          <div className="col-span-12 grid grid-cols-1 md:grid-cols-2 gap-5">
            <StatCard
              title="Tonal Variation"
              subtitle="Pitch Variation (librosa)"
              value={
                cards.tonalScore != null && typeof cards.tonalScore === "number"
                  ? cards.tonalScore.toFixed(1)
                  : "N/A"
              }
              badge={(() => {
                const label = cards.tonalLabel;
                const text =
                  label === "expressive"
                    ? "Expressive"
                    : label === "moderate"
                      ? "Moderate"
                      : label === "monotone"
                        ? "Monotone"
                        : label === "flat"
                          ? "Flat"
                          : label
                            ? String(label).replace(/\b\w/g, (c) => c.toUpperCase())
                            : "N/A";
                const tone =
                  label === "expressive"
                    ? "good"
                    : label === "moderate"
                      ? "warn"
                      : label === "monotone" || label === "flat"
                        ? "bad"
                        : "neutral";
                return { text, tone: tone as "good" | "warn" | "bad" | "neutral" };
              })()}
            />
            <StatCard
              title="Expressions"
              subtitle={cards.exprTop !== "-" ? `Changes/min · Top: ${cards.exprTop}` : "Changes Per Minute"}
              value={Number.isFinite(cards.exprChangesPerMin) ? cards.exprChangesPerMin.toFixed(1) : "-"}
              badge={{
                text:
                  cards.exprBadge === "low"
                    ? "Low"
                    : cards.exprBadge === "high"
                      ? "High"
                      : "Normal",
                tone:
                  cards.exprBadge === "normal"
                    ? "good"
                    : cards.exprBadge === "low"
                      ? "warn"
                      : "warn",
              }}
            />
          </div>

          {cards.durationSec > 0 && (cards.timeline?.bins?.length > 0 || cards.events?.length > 0) ? (
            <Card className="col-span-12 p-4">
              <div className="text-sm font-semibold mb-2">Timeline</div>
              <div className="text-xs text-muted mb-3">
                Fillers, low eye contact, and pace warnings over time
              </div>
              <div className="relative h-10 rounded-lg overflow-hidden bg-slate-100 flex">
                {(cards.timeline.bins as { t0: number; t1: number; fillers_per_min?: number; eye_contact?: number; wpm?: number }[]).map(
                  (bin, i) => {
                    const pct = (100 * (bin.t1 - bin.t0)) / cards.durationSec;
                    const hasFillers = Number(bin.fillers_per_min) > 5;
                    const lowEye = bin.eye_contact != null && bin.eye_contact < 0.5;
                    const paceWarn =
                      typeof bin.wpm === "number" && (bin.wpm > 200 || (bin.wpm > 0 && bin.wpm < 95));
                    const color = hasFillers
                      ? "bg-amber-400"
                      : lowEye
                        ? "bg-red-300"
                        : paceWarn
                          ? "bg-amber-200"
                          : "bg-green-200";
                    return (
                      <div
                        key={i}
                        className={`${color} min-w-[2px] border-r border-white/50 last:border-0`}
                        style={{ width: `${pct}%` }}
                        title={`${Math.floor(bin.t0 / 60)}m–${Math.floor(bin.t1 / 60)}m`}
                      />
                    );
                  }
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-amber-400" /> High fillers
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-red-300" /> Low eye contact
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-amber-200" /> Pace warning
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-green-200" /> OK
                </span>
              </div>
              {cards.events?.length > 0 ? (
                <div className="mt-3 pt-3 border-t border-black/5">
                  <div className="text-xs font-medium text-muted mb-2">Events (first 10)</div>
                  <ul className="text-xs text-muted space-y-1">
                    {cards.events.slice(0, 10).map((ev, i) => (
                      <li key={i}>
                        {formatTime(ev.t0)} – {ev.type}: {ev.message ?? ev.type}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

