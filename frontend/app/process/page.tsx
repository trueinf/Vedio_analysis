"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "../../components/ui";
import { VideoUploadPanel } from "../../components/VideoUploadPanel";
import { createJobFromYouTubeUrl, getJob, uploadVideo } from "../../lib/api";
import { supabase } from "../../lib/supabaseClient";

type UploadJobRow = {
  id: string;
  name: string;
  status: string;
  stage: string;
  progress: number;
};

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
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [jobError, setJobError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const uploadInFlightRef = useRef(false);

  const [channelName, setChannelName] = useState<string>("");
  const [youtubeUrl, setYoutubeUrl] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  const localVideoUrl = useMemo(() => {
    const pick = file ?? files[0] ?? null;
    return pick ? URL.createObjectURL(pick) : "";
  }, [file, files]);

  useEffect(() => {
    return () => {
      if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
    };
  }, [localVideoUrl]);

  const refreshSelected = useCallback(async () => {
    if (!jobId) return;
    const j = await getJob(jobId);
    setStatus(j.status);
    setStage((j as any).stage ?? "");
    setProgress(Number((j as any).progress ?? 0));
    if (j.status === "failed") setJobError(j.error_message || "Job failed");
  }, [jobId]);

  const clearHistory = useCallback(() => {
    setUploadedJobs([]);
    setJobId(null);
    setStatus("");
    setStage("");
    setProgress(0);
    setJobError("");
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
        const ids = Array.from(
          new Set(
            uploadedJobs
              .map((j) => j.id)
              .filter((id) => !String(id).startsWith("uploading-"))
          )
        );
        if (!ids.length) return;
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
        const sel = updates.find((u) => u.id === jobId);
        if (sel) {
          setStatus(sel.status);
          setStage(sel.stage);
          setProgress(sel.progress);
          if (sel.status === "failed") setJobError(sel.error || "Job failed");
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

  async function startUpload() {
    // Extra guard: in dev it’s easy to trigger the handler twice (double-click / key repeat)
    // before React state updates disable the button.
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    const yt = youtubeUrl.trim();
    const batch = files.length ? files : file ? [file] : [];
    if (!batch.length && !yt) return;
    setBusy(true);
    setJobError("");
    try {
      const newRows: UploadJobRow[] = [];
      if (yt) {
        if (isYouTubeChannelLink(yt)) {
          setJobError("Channel ingest is available in the main dashboard comparison panel. Paste a YouTube *video* URL here.");
          return;
        }
        const u = await createJobFromYouTubeUrl(yt);
        newRows.push({ id: u.job_id, name: "YouTube URL", status: u.status, stage: "queued", progress: 0 });
      } else if (batch.length > 1) {
        const signedMax = supabaseSignedUploadMaxBytes();
        const needsSigned = batch.some((f) => f.size <= signedMax);
        if (needsSigned && !supabase) {
          setJobError("Supabase frontend env is not set. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to frontend env.");
          return;
        }
        if (needsSigned) {
          await fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"}/api/supabase/storage/ensure-bucket`, {
            method: "POST",
          });
        }
        const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "videos";
        for (const f of batch) {
          const tempId = `uploading-${crypto.randomUUID()}`;
          const uploadStage = f.size > signedMax ? "uploading_to_api" : "uploading_to_storage";
          setUploadedJobs((prev) => dedupeJobs([{ id: tempId, name: f.name, status: "processing", stage: uploadStage, progress: 0.01 }, ...prev]));

          if (f.size > signedMax) {
            const u = await uploadVideo(f, channelName);
            setUploadedJobs((prev) =>
              dedupeJobs(
                prev.map((row) => (row.id === tempId ? { id: u.job_id, name: f.name, status: u.status, stage: "queued", progress: 0 } : row))
              )
            );
            newRows.push({ id: u.job_id, name: f.name, status: u.status, stage: "queued", progress: 0 });
            continue;
          }

          const storagePath = `${crypto.randomUUID()}/${safeObjectName(f.name)}`;
          const signedRes = await fetch(
            `${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"}/api/supabase/storage/signed-upload-url`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bucket, path: storagePath }),
            }
          );
          if (!signedRes.ok) throw new Error(`Signed upload URL failed (${signedRes.status})`);
          const signed = (await signedRes.json()) as { token: string };
          const sb = supabase;
          if (!sb) throw new Error("Supabase client missing");
          const { error: upErr } = await sb.storage.from(bucket).uploadToSignedUrl(storagePath, signed.token, f);
          if (upErr) throw new Error(`Supabase upload failed: ${upErr.message}`);

          const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"}/api/jobs/from-supabase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storage_path: storagePath, original_filename: f.name, channel_name: channelName }),
          });
          if (!res.ok) throw new Error(`Create job from Supabase failed (${res.status})`);
          const u = await res.json();
          setUploadedJobs((prev) =>
            dedupeJobs(prev.map((row) => (row.id === tempId ? { id: u.job_id, name: f.name, status: u.status, stage: "queued", progress: 0 } : row)))
          );
          newRows.push({ id: u.job_id, name: f.name, status: u.status, stage: "queued", progress: 0 });
        }
      } else {
        const u = await uploadVideo(batch[0], channelName);
        newRows.push({ id: u.job_id, name: batch[0].name, status: u.status, stage: "queued", progress: 0 });
      }
      setUploadedJobs((prev) => dedupeJobs([...newRows, ...prev.filter((x) => !String(x.id).startsWith("uploading-"))]));
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
      <div className="max-w-[96vw] mx-auto px-6 py-6">
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
              onPickFiles={(picked) => {
                setFiles(picked);
                setFile(picked[0] ?? null);
              }}
              onAnalyze={startUpload}
              onRefresh={refreshSelected}
              onClearHistory={clearHistory}
              canAnalyze={(Boolean(file) || Boolean(youtubeUrl.trim()) || files.length > 0) && !busy}
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
      </div>
    </div>
  );
}

