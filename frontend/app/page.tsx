"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChannelCollection,
  ChannelItem,
  deleteChannel,
  getChannelCollections,
  getCollectionSummary,
  getJob,
  getResult,
  listChannels,
  renameChannel,
  uploadVideo,
  uploadVideos,
} from "../lib/api";
import { Button, Card } from "../components/ui";
import { Gauge } from "../components/gauge";

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

  async function loadChannels() {
    try {
      const res = await listChannels();
      setChannels(res.channels || []);
      if (!selectedChannelId && (res.channels || []).length) {
        setSelectedChannelId(res.channels[0].id);
      }
    } catch {
      // ignore
    }
  }

  async function loadCollectionsForChannel(channelId: string) {
    if (!channelId) return;
    try {
      const res = await getChannelCollections(channelId);
      setChannelCollections((prev) => ({ ...prev, [channelId]: res.collections || [] }));
    } catch {
      // ignore
    }
  }

  async function refresh() {
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
    } catch (e: any) {
      setJobError(e?.message ?? "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadChannels().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedChannelId) return;
    loadCollectionsForChannel(selectedChannelId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannelId]);

  useEffect(() => {
    const activeCount = uploadedJobs.filter((j) => j.status === "queued" || j.status === "processing").length;
    const hasActive = activeCount > 0 || (jobId && (status === "queued" || status === "processing"));
    if (!hasActive) return;
    const intervalMs = activeCount > 1 ? 3000 : 5000;
    const t = setInterval(() => {
      refresh().catch(() => {});
    }, intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status, uploadedJobs]);

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
  const activeChannelName =
    channels.find((c) => c.id === selectedChannelId)?.name ||
    channelName ||
    "Creator";
  const visibleChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(channelSearch.trim().toLowerCase())
  );

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
              <div className="text-xs text-muted">Upload one or many videos and get delivery insights</div>
            </div>
          </div>

          <div className="text-sm text-muted">Dashboard</div>
        </div>

        <div className="mt-6 grid grid-cols-12 gap-5">
          <Card className="col-span-12 lg:col-span-6 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Video</div>
              {jobId ? <div className="text-xs text-muted">Job: {jobId}</div> : null}
            </div>
            <div className="mt-3 border border-black/5 rounded-xl overflow-hidden bg-black/5 aspect-video flex items-center justify-center text-muted text-sm">
              Video preview will appear here (optional)
            </div>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <input
                type="text"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="Channel name (e.g. ifan)"
                className="text-sm border border-black/10 rounded-md px-2 py-1"
              />
              <input
                type="file"
                accept="video/*"
                multiple
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  setFiles(picked);
                  setFile(picked[0] ?? null);
                }}
                className="text-sm"
              />
              <Button onClick={startUpload} disabled={!file || busy}>
                Analyze
              </Button>
              <Button variant="ghost" onClick={refresh} disabled={(!jobId && !uploadedJobs.length) || busy}>
                Refresh
              </Button>
              <div className="text-xs text-muted">
                {files.length ? `${files.length} videos selected` : "Select one or more videos"}
              </div>
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
            {uploadedJobs.length ? (
              <div className="mt-4 border border-black/5 rounded-lg overflow-hidden">
                <div className="max-h-44 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left px-2 py-2">Video</th>
                        <th className="text-left px-2 py-2">Status</th>
                        <th className="text-left px-2 py-2">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadedJobs.map((j) => (
                        <tr
                          key={j.id}
                          className={`border-t cursor-pointer ${jobId === j.id ? "bg-blue-50" : ""}`}
                          onClick={async () => {
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
                        >
                          <td className="px-2 py-2 truncate max-w-[280px]" title={j.name}>
                            {j.name}
                          </td>
                          <td className="px-2 py-2">{j.status}</td>
                          <td className="px-2 py-2">{Math.round((j.progress || 0) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </Card>

          <div className="col-span-12 lg:col-span-3 grid gap-5">
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

          <Card className="col-span-12 lg:col-span-3 p-4">
            <div className="text-sm font-semibold">Channel Reports</div>
            <div className="text-xs text-muted mt-1">Stored analyses by channel</div>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder="Search channels"
                className="w-full text-xs border border-black/10 rounded-md px-2 py-1"
              />
            </div>
            <div className="mt-2 flex gap-2 text-xs">
              <button
                type="button"
                className={`px-2 py-1 rounded border ${channelViewMode === "latest" ? "bg-blue-50 border-blue-200" : "border-black/10"}`}
                onClick={() => setChannelViewMode("latest")}
              >
                Latest
              </button>
              <button
                type="button"
                className={`px-2 py-1 rounded border ${channelViewMode === "all" ? "bg-blue-50 border-blue-200" : "border-black/10"}`}
                onClick={() => setChannelViewMode("all")}
              >
                All-time
              </button>
            </div>
            <div className="mt-3 space-y-2 max-h-80 overflow-auto">
              {visibleChannels.length ? (
                visibleChannels.map((ch) => (
                  <div key={ch.id} className="border border-black/5 rounded-md">
                    <button
                      type="button"
                      className={`w-full text-left px-3 py-2 text-xs ${selectedChannelId === ch.id ? "bg-blue-50" : ""}`}
                      onClick={() => {
                        setSelectedChannelId(ch.id);
                        setRenameDraft(ch.name);
                      }}
                    >
                      <div className="font-medium">{ch.name}</div>
                      <div className="text-muted">
                        {ch.collections} collections · {ch.videos} videos
                      </div>
                    </button>
                    {selectedChannelId === ch.id ? (
                      <div className="px-3 pb-2">
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="text"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            placeholder="Rename channel"
                            className="w-full text-[11px] border border-black/10 rounded px-2 py-1"
                          />
                          <button
                            type="button"
                            className="text-[11px] px-2 py-1 rounded border border-black/10 hover:bg-slate-50"
                            onClick={async () => {
                              const next = renameDraft.trim();
                              if (!next) return;
                              try {
                                await renameChannel(ch.id, next);
                                await loadChannels();
                                setChannelName(next);
                                setRenameDraft("");
                              } catch {
                                // ignore
                              }
                            }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="text-[11px] px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50"
                            onClick={async () => {
                              try {
                                await deleteChannel(ch.id);
                                setSelectedChannelId("");
                                setCollectionSummary(null);
                                await loadChannels();
                              } catch {
                                // ignore
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                        <div className="text-[11px] text-muted mb-1 mt-2">Collections</div>
                        <div className="space-y-1 max-h-28 overflow-auto">
                          {(channelViewMode === "latest"
                            ? (channelCollections[ch.id] || []).slice(0, 1)
                            : channelCollections[ch.id] || []
                          ).map((c) => (
                            <button
                              key={c.collection_id}
                              type="button"
                              className="w-full text-left text-[11px] border border-black/5 rounded px-2 py-1 hover:bg-slate-50"
                              onClick={async () => {
                                setCollectionId(c.collection_id);
                                try {
                                  const cs = (await getCollectionSummary(c.collection_id)) as CollectionSummary;
                                  setCollectionSummary(cs);
                                  if (cs.summary.best_video) {
                                    setJobId(cs.summary.best_video);
                                  }
                                } catch {
                                  // ignore
                                }
                              }}
                            >
                              <div className="font-medium truncate">{c.title || c.collection_id}</div>
                              <div className="text-muted">
                                {c.completed_videos}/{c.total_videos} completed
                              </div>
                            </button>
                          ))}
                          {!(channelCollections[ch.id] || []).length ? (
                            <div className="text-[11px] text-muted">No collections yet.</div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="text-xs text-muted">No channel reports found.</div>
              )}
            </div>
          </Card>

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
          {result ? (
            <Card className="col-span-12 p-4">
              <div className="text-sm font-semibold mb-3">Description View</div>
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
          {collectionSummary ? (
            <Card className="col-span-12 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{labelCase(activeChannelName)}'s Overall Analysis</div>
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
        </div>
      </div>
    </div>
  );
}

