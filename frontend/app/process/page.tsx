"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "../../components/ui";
import { isValidYouTubeVideoUrl, VideoUploadPanel } from "../../components/VideoUploadPanel";
import {
  createYouTubeJobWithChannel,
  getAnalysisDetail,
  getJobProgressUnified,
  listChannels,
  listAnalysesForChannel,
  uploadVideo,
} from "../../lib/api";
import type { AnalysisRow, ChannelItem } from "../../lib/api";
import ChannelReportClient from "../channel/[name]/ChannelReportClient";

type UploadJobRow = {
  id: string;
  name: string;
  status: string;
  stage: string;
  progress: number;
  /** Set after fetch when status is `completed`; `null` means fetched but no score. */
  confidence?: number | null;
};

type ChannelAnalyses = { analyses: AnalysisRow[] };

function truncateFilename(name: string, max = 34): string {
  const n = name || "";
  if (n.length <= max) return n;
  return `${n.slice(0, max)}…`;
}

function dedupeJobs(rows: UploadJobRow[]): UploadJobRow[] {
  const seen = new Set<string>();
  const out: UploadJobRow[] = [];
  for (const r of rows) {
    if (!r?.id) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function safeObjectName(originalName: string): string {
  const raw = (originalName || "upload.mp4").trim();
  const dot = raw.lastIndexOf(".");
  const ext = dot >= 0 ? raw.slice(dot).toLowerCase() : ".mp4";
  const base = dot >= 0 ? raw.slice(0, dot) : raw;
  // Keep it URL/path safe: ASCII-ish, no spaces/emojis/smart quotes.
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return `${cleaned || "upload"}${ext}`;
}

/** Below typical Supabase Free bucket cap (~50 MiB); larger files use streamed POST /api/jobs/upload. */
function supabaseSignedUploadMaxBytes(): number {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_SIGNED_UPLOAD_MAX_BYTES;
  if (raw && /^\d+$/.test(String(raw).trim())) return parseInt(String(raw).trim(), 10);
  return 48 * 1024 * 1024;
}

function isYouTubeChannelLink(s: string): boolean {
  const v = (s || "").trim().toLowerCase();
  if (!v) return false;
  if (v.startsWith("@")) return true;
  if (v.includes("youtube.com/@")) return true;
  if (v.includes("youtube.com/channel/")) return true;
  if (v.includes("youtube.com/c/")) return true;
  return false;
}

export default function ProcessPage() {
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedJobs, setUploadedJobs] = useState<UploadJobRow[]>([]);
  const uploadedJobsRef = useRef<UploadJobRow[]>([]);
  const confidenceFetchedRef = useRef<Set<string>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [jobError, setJobError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const uploadInFlightRef = useRef(false);

  const [channelName, setChannelName] = useState<string>("");
  const [activeBatchChannelName, setActiveBatchChannelName] = useState<string>("");
  const [youtubeUrl, setYoutubeUrl] = useState<string>("");
  const [uploadMode, setUploadMode] = useState<"file" | "youtube">("file");
  const [channelId, setChannelId] = useState<string>("");
  const [channelList, setChannelList] = useState<ChannelItem[]>([]);
  const [youtubeFieldError, setYoutubeFieldError] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  const [liveChannelData, setLiveChannelData] = useState<ChannelAnalyses | null>(null);
  const liveReportNonceRef = useRef(0);
  const [liveReportNonce, setLiveReportNonce] = useState(0);
  const lastStatusesRef = useRef<Map<string, string>>(new Map());
  const liveReportSectionRef = useRef<HTMLDivElement | null>(null);

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
    void listChannels()
      .then((d) => setChannelList(d.channels || []))
      .catch(() => setChannelList([]));
  }, []);

  useEffect(() => {
    uploadedJobsRef.current = uploadedJobs;
  }, [uploadedJobs]);

  const fetchLiveChannel = useCallback(
    async (name: string) => {
      const cn = (name || "").trim();
      if (!cn) {
        setLiveChannelData(null);
        return;
      }
      try {
        const data = await listAnalysesForChannel(cn, false);
        setLiveChannelData({ analyses: data.analyses || [] });
      } catch {
        // Best-effort; report UI below still tries to load using ChannelReportClient.
      }
    },
    []
  );

  useEffect(() => {
    if (!activeBatchChannelName.trim()) return;
    void fetchLiveChannel(activeBatchChannelName);
  }, [activeBatchChannelName, fetchLiveChannel]);

  useEffect(() => {
    if (!activeBatchChannelName.trim()) return;
    requestAnimationFrame(() => {
      liveReportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [liveReportNonce, activeBatchChannelName]);

  useEffect(() => {
    if (uploadMode === "file") setYoutubeFieldError("");
  }, [uploadMode]);

  const refreshSelected = useCallback(async () => {
    if (!jobId) return;
    const j = await getJobProgressUnified(jobId);
    setStatus(j.status);
    setStage(j.stage ?? "");
    setProgress(Number(j.progress ?? 0));
    if (j.status === "failed") setJobError(j.error_message || "Job failed");
    else setJobError("");
  }, [jobId]);

  const clearHistory = useCallback(() => {
    setUploadedJobs([]);
    setJobId(null);
    setStatus("");
    setStage("");
    setProgress(0);
    setJobError("");
    confidenceFetchedRef.current.clear();
    lastStatusesRef.current = new Map();
    setActiveBatchChannelName("");
    setLiveChannelData(null);
  }, []);

  useEffect(() => {
    if (!uploadedJobs.length) return;
    const hasActive = uploadedJobs.some((j) => j.status === "queued" || j.status === "processing");
    if (!hasActive) return;

    const poll = async () => {
      // Chromium may report net::ERR_NETWORK_IO_SUSPENDED if we poll while the tab is hidden,
      // the machine sleeps, or during a large same-origin upload. Skip those windows.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (busy) return;
      try {
        const prevRows = uploadedJobsRef.current;
        const ids = Array.from(
          new Set(prevRows.map((j) => j.id).filter((id) => !String(id).startsWith("uploading-")))
        );
        if (!ids.length) return;
        const updates = await Promise.all(
          ids.map(async (id) => {
            const job = await getJobProgressUnified(id);
            const row = prevRows.find((r) => r.id === id);
            let confidence = row?.confidence;
            if (job.status === "completed" && !confidenceFetchedRef.current.has(id)) {
              confidenceFetchedRef.current.add(id);
              try {
                const d = await getAnalysisDetail(id);
                const c = d.analysis?.confidence_score;
                confidence = typeof c === "number" ? Math.round(c) : null;
              } catch {
                confidence = null;
              }
            }
            return {
              id,
              status: job.status,
              stage: job.stage ?? "",
              progress: Number(job.progress ?? 0),
              error: job.error_message || "",
              confidence,
            };
          })
        );
        // Detect transitions to completed to refresh channel report.
        let anyJustCompleted = false;
        const nextStatusMap = new Map(lastStatusesRef.current);
        for (const u of updates) {
          const prev = nextStatusMap.get(u.id) || "";
          if (u.status === "completed" && prev !== "completed") anyJustCompleted = true;
          nextStatusMap.set(u.id, u.status);
        }
        lastStatusesRef.current = nextStatusMap;
        if (anyJustCompleted && activeBatchChannelName.trim()) {
          void fetchLiveChannel(activeBatchChannelName);
          liveReportNonceRef.current += 1;
          setLiveReportNonce(liveReportNonceRef.current);
        }
        setUploadedJobs((prev) =>
          prev.map((row) => {
            const u = updates.find((x) => x.id === row.id);
            if (!u) return row;
            return {
              ...row,
              status: u.status,
              stage: u.stage,
              progress: u.progress,
              confidence: u.confidence !== undefined ? u.confidence : row.confidence,
            };
          })
        );
        const sel = updates.find((u) => u.id === jobId);
        if (sel) {
          setStatus(sel.status);
          setStage(sel.stage);
          setProgress(sel.progress);
          if (sel.status === "failed") setJobError(sel.error || "Job failed");
          else setJobError("");
        }
      } catch {
        // ignore polling blips (offline, IO suspended, etc.)
      }
    };

    void poll();
    const t = setInterval(() => {
      void poll();
    }, 4000);
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") void poll();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    };
  }, [uploadedJobs, jobId, busy]);

  const canAnalyze = useMemo(() => {
    if (busy) return false;
    if (uploadMode === "file") {
      return Boolean(file || files.length > 0);
    }
    return Boolean(youtubeUrl.trim() && channelId);
  }, [busy, uploadMode, file, files.length, youtubeUrl, channelId]);

  async function startUpload() {
    // Extra guard: in dev it’s easy to trigger the handler twice (double-click / key repeat)
    // before React state updates disable the button.
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    const yt = youtubeUrl.trim();
    const batch = files.length ? files : file ? [file] : [];
    if (uploadMode === "youtube") {
      if (!channelId) {
        setJobError("Select a channel.");
        uploadInFlightRef.current = false;
        return;
      }
      if (!yt) {
        uploadInFlightRef.current = false;
        return;
      }
      if (!isValidYouTubeVideoUrl(yt)) {
        setYoutubeFieldError("Enter a valid YouTube video URL (watch?v=, youtu.be, or /shorts/).");
        uploadInFlightRef.current = false;
        return;
      }
    } else if (!batch.length) {
      uploadInFlightRef.current = false;
      return;
    }
    setBusy(true);
    setJobError("");
    setYoutubeFieldError("");
    try {
      const newRows: UploadJobRow[] = [];
      if (uploadMode === "youtube") {
        const resolvedName =
          (channelList.find((c) => c.id === channelId)?.name || "").trim() || channelName.trim() || "Channel";
        setActiveBatchChannelName(resolvedName);
        const u = await createYouTubeJobWithChannel(yt, channelId);
        newRows.push({ id: u.job_id, name: "YouTube video", status: u.status, stage: "queued", progress: 0 });
      } else {
        setActiveBatchChannelName(channelName.trim() || "Channel");
        const results = await Promise.all(
          batch.map(async (f) => {
            const tempId = `uploading-${crypto.randomUUID()}`;
            setUploadedJobs((prev) =>
              dedupeJobs([{ id: tempId, name: f.name, status: "processing", stage: "uploading_to_storage", progress: 0.01 }, ...prev])
            );
            const u = await uploadVideo(f, channelName, {
              onUploadProgress: (pct) => {
                setUploadedJobs((prev) =>
                  prev.map((row) =>
                    row.id === tempId ? { ...row, progress: pct / 100, stage: "uploading_to_storage" } : row
                  )
                );
              },
            });
            setUploadedJobs((prev) =>
              dedupeJobs(
                prev.map((row) =>
                  row.id === tempId ? { id: u.job_id, name: f.name, status: u.status, stage: "queued", progress: 0 } : row
                )
              )
            );
            return { id: u.job_id, name: f.name, status: u.status, stage: "queued" as const, progress: 0 };
          })
        );
        newRows.push(...results);
      }
      setUploadedJobs((prev) => dedupeJobs([...newRows, ...prev.filter((x) => !String(x.id).startsWith("uploading-"))]));
      // Reset transition tracking for new batch rows.
      lastStatusesRef.current = new Map(
        newRows.filter((r) => r?.id).map((r) => [r.id, r.status])
      );
      liveReportNonceRef.current += 1;
      setLiveReportNonce(liveReportNonceRef.current);
      if (newRows[0]) {
        setJobId(newRows[0].id);
        setStatus(newRows[0].status);
        setStage("queued");
        setProgress(0);
      }
    } catch (e: any) {
      setJobError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
      uploadInFlightRef.current = false;
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">
      <div className="w-full max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-10 py-6">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 backdrop-blur px-4 py-3">
          <div>
            <div className="font-semibold tracking-tight text-3xl">Process</div>
            <div className="text-slate-300 text-sm">Upload videos or paste a YouTube link to start analysis</div>
          </div>
          <div className="flex items-center gap-3">
            <a className="text-sm text-cyan-300 hover:underline" href="/dashboard">
              Dashboard
            </a>
            <a className="text-sm text-cyan-300 hover:underline" href="/compare">
              Compare
            </a>
          </div>
        </div>

        {/* When results are showing, use full-width two columns:
            Left = upload + queue, Right = live report */}
        {uploadedJobs.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <VideoUploadPanel
                jobId={jobId}
                localVideoUrl={localVideoUrl}
                demoMode={false}
                channelName={channelName}
                onChannelNameChange={setChannelName}
                youtubeUrl={youtubeUrl}
                onYoutubeUrlChange={setYoutubeUrl}
                ytIngest={null}
                ytIngesting={false}
                uploadMode={uploadMode}
                onUploadModeChange={(m) => {
                  setUploadMode(m);
                  if (m === "file") {
                    setYoutubeUrl("");
                    setYoutubeFieldError("");
                  } else {
                    setFiles([]);
                    setFile(null);
                  }
                }}
                channels={channelList.map((c) => ({ id: c.id, name: c.name }))}
                channelId={channelId}
                onChannelIdChange={setChannelId}
                youtubeFieldError={youtubeFieldError}
                onPickFiles={(picked) => {
                  setFiles(picked);
                  setFile(picked[0] ?? null);
                }}
                onAnalyze={startUpload}
                onRefresh={refreshSelected}
                onClearHistory={clearHistory}
                canAnalyze={canAnalyze}
                canRefresh={Boolean(jobId) && !busy}
                selectedFilesCount={files.length}
                status={status}
                stage={stage}
                progress={progress}
                jobError={jobError}
                uploadedJobs={uploadedJobs}
                activeJobId={jobId}
                onSelectJob={(nextJobId) => setJobId(nextJobId)}
                setVideoRef={(el) => {
                  videoRef.current = el;
                }}
                onVideoLoadedMetadata={(duration) => setVideoDuration(duration)}
                onVideoTimeUpdate={(time) => setCurrentTime(time)}
                hideJobHistoryTable
              />

              {/* Queue */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Analysis Queue</div>
                  <Button variant="premium-ghost" onClick={clearHistory}>
                    Clear history
                  </Button>
                </div>

                <Card className="p-4 bg-white/5 border border-white/10 backdrop-blur text-white rounded-2xl">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-slate-300">
                        Processing:{" "}
                        <span className="text-white font-semibold">{activeBatchChannelName || channelName || "Channel"}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {(() => {
                          const rows = uploadedJobs.filter((j) => !String(j.id).startsWith("uploading-"));
                          const total = rows.length;
                          const completed = rows.filter((j) => j.status === "completed").length;
                          const processing = rows.filter((j) => j.status === "processing").length;
                          const queued = rows.filter((j) => j.status === "queued").length;
                          const failed = rows.filter((j) => j.status === "failed").length;
                          return `${completed} of ${total} completed · ${processing} processing · ${queued} queued${failed ? ` · ${failed} failed` : ""}`;
                        })()}
                      </div>
                    </div>
                    <div className="text-right">
                      {(() => {
                        const rows = uploadedJobs.filter((j) => !String(j.id).startsWith("uploading-"));
                        const total = rows.length || 1;
                        const prog = rows.reduce((s, j) => {
                          if (j.status === "completed" || j.status === "failed") return s + 1;
                          return s + Math.max(0, Math.min(1, Number(j.progress || 0)));
                        }, 0);
                        const pct = Math.round((prog / total) * 100);
                        return <div className="text-xs text-slate-300 tabular-nums">{pct}%</div>;
                      })()}
                    </div>
                  </div>

                  <div className="mt-3 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.max(
                          3,
                          (() => {
                            const rows = uploadedJobs.filter((j) => !String(j.id).startsWith("uploading-"));
                            const total = rows.length || 1;
                            const prog = rows.reduce((s, j) => {
                              if (j.status === "completed" || j.status === "failed") return s + 1;
                              return s + Math.max(0, Math.min(1, Number(j.progress || 0)));
                            }, 0);
                            return Math.round((prog / total) * 100);
                          })()
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="mt-4">
                    <div className="text-xs text-slate-400 mb-2">Individual file status</div>
                    <div className="space-y-2">
                      {uploadedJobs.map((j) => {
                        const isTemp = String(j.id).startsWith("uploading-");
                        const dot =
                          j.status === "completed"
                            ? "bg-emerald-400"
                            : j.status === "failed"
                              ? "bg-red-400"
                              : j.status === "processing"
                                ? "bg-cyan-400 animate-pulse"
                                : "bg-amber-400";
                        return (
                          <div
                            key={j.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                          >
                            <div className="min-w-0 flex items-center gap-2">
                              <span className={`shrink-0 w-2 h-2 rounded-full ${dot}`} />
                              <div className="min-w-0">
                                <div className="text-xs text-white truncate" title={j.name}>
                                  {truncateFilename(j.name)}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {j.stage || j.status}
                                  {j.status === "processing" || j.status === "queued"
                                    ? ` · ${Math.round((j.progress || 0) * 100)}%`
                                    : ""}
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              {j.status === "completed" && !isTemp ? (
                                <div className="text-[11px] text-slate-300 tabular-nums">
                                  confidence: <span className="text-slate-100 font-medium">{j.confidence ?? "—"}</span>
                                </div>
                              ) : j.status === "failed" ? (
                                <div className="text-[11px] text-red-300">failed</div>
                              ) : (
                                <div className="text-[11px] text-slate-500">—</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              </div>
            </div>

            {/* Right column: Live report */}
            <div ref={liveReportSectionRef} className="scroll-mt-6">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-3">Live Channel Report</div>
              {activeBatchChannelName.trim() ? (
                <div className="rounded-2xl border border-white/10 bg-white/5">
                  <ChannelReportClient
                    key={`${activeBatchChannelName.trim().toLowerCase()}-${liveReportNonce}`}
                    encodedName={encodeURIComponent(activeBatchChannelName.trim())}
                  />
                </div>
              ) : (
                <div className="text-sm text-slate-400">Set a channel name to see the live report.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-7">
              <VideoUploadPanel
                jobId={jobId}
                localVideoUrl={localVideoUrl}
                demoMode={false}
                channelName={channelName}
                onChannelNameChange={setChannelName}
                youtubeUrl={youtubeUrl}
                onYoutubeUrlChange={setYoutubeUrl}
                ytIngest={null}
                ytIngesting={false}
                uploadMode={uploadMode}
                onUploadModeChange={(m) => {
                  setUploadMode(m);
                  if (m === "file") {
                    setYoutubeUrl("");
                    setYoutubeFieldError("");
                  } else {
                    setFiles([]);
                    setFile(null);
                  }
                }}
                channels={channelList.map((c) => ({ id: c.id, name: c.name }))}
                channelId={channelId}
                onChannelIdChange={setChannelId}
                youtubeFieldError={youtubeFieldError}
                onPickFiles={(picked) => {
                  setFiles(picked);
                  setFile(picked[0] ?? null);
                }}
                onAnalyze={startUpload}
                onRefresh={refreshSelected}
                onClearHistory={clearHistory}
                canAnalyze={canAnalyze}
                canRefresh={Boolean(jobId) && !busy}
                selectedFilesCount={files.length}
                status={status}
                stage={stage}
                progress={progress}
                jobError={jobError}
                uploadedJobs={uploadedJobs}
                activeJobId={jobId}
                onSelectJob={(nextJobId) => setJobId(nextJobId)}
                setVideoRef={(el) => {
                  videoRef.current = el;
                }}
                onVideoLoadedMetadata={(duration) => setVideoDuration(duration)}
                onVideoTimeUpdate={(time) => setCurrentTime(time)}
                hideJobHistoryTable
              />
            </div>

            <Card className="col-span-12 lg:col-span-5 p-4 bg-white/5 border border-white/10 backdrop-blur text-white">
              <div className="text-sm font-semibold">What happens next?</div>
              <div className="mt-2 text-sm text-slate-300">
                After analysis completes, your full result is saved to Supabase and will appear in the Dashboard.
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="premium-ghost" onClick={() => (window.location.href = "/dashboard")}>
                  Open Dashboard
                </Button>
                <Button variant="premium-ghost" onClick={() => (window.location.href = "/compare")}>
                  Open Compare
                </Button>
              </div>
              <div className="mt-4 text-xs text-slate-400">
                Player time: {Math.floor(currentTime)}s · Duration: {Math.floor(videoDuration)}s
              </div>
            </Card>
          </div>
        )}

      </div>
    </div>
  );
}

