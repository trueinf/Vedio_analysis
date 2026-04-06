import { supabase } from "./supabaseClient";

/** Base URL for the FastAPI backend only (no path suffix). */
function getApiBase(): string {
  // Prefer NEXT_PUBLIC_API_URL (Netlify/Railway), fall back to older NEXT_PUBLIC_API_BASE.
  let b = (process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000").trim();
  b = b.replace(/\/+$/, "");
  // Common misconfig: user sets .../api/jobs — strip so we don't double paths.
  b = b.replace(/\/api\/jobs\/?$/i, "");
  b = b.replace(/\/api\/?$/i, "");
  return b;
}

const API_BASE = getApiBase();

/** Exported for pages that still need a base URL for a one-off fetch. */
export function getApiBaseUrl(): string {
  return API_BASE;
}

export type JobStatus = "queued" | "processing" | "completed" | "failed";

/** Max file size (bytes) for direct-to-Supabase signed upload; larger files use streamed POST to the API. */
export function getSignedUploadMaxBytes(): number {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_SIGNED_UPLOAD_MAX_BYTES;
  if (raw && /^\d+$/.test(String(raw).trim())) return parseInt(String(raw).trim(), 10);
  return 48 * 1024 * 1024;
}

function safeObjectNameForStorage(originalName: string): string {
  const raw = (originalName || "upload.mp4").trim();
  const dot = raw.lastIndexOf(".");
  const ext = dot >= 0 ? raw.slice(dot).toLowerCase() : ".mp4";
  const base = dot >= 0 ? raw.slice(0, dot) : raw;
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return `${cleaned || "upload"}${ext}`;
}

async function uploadJobViaSupabaseSignedUrl(
  file: File,
  channelName: string
): Promise<{ job_id: string; status: JobStatus }> {
  if (!supabase) throw new Error("Supabase client is not configured (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)");

  await fetch(`${API_BASE}/api/supabase/storage/ensure-bucket`, { method: "POST" });

  const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "videos";
  const storagePath = `${crypto.randomUUID()}/${safeObjectNameForStorage(file.name)}`;

  const signedRes = await fetch(`${API_BASE}/api/supabase/storage/signed-upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, path: storagePath }),
  });
  if (!signedRes.ok) throw new Error(`Signed upload URL failed (${signedRes.status})`);
  const signed = (await signedRes.json()) as { token: string };

  const { error: upErr } = await supabase.storage.from(bucket).uploadToSignedUrl(storagePath, signed.token, file);
  if (upErr) throw new Error(`Supabase upload failed: ${upErr.message}`);

  const res = await fetch(`${API_BASE}/api/jobs/from-supabase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storage_path: storagePath,
      original_filename: file.name,
      channel_name: channelName.trim(),
    }),
  });
  if (!res.ok) throw new Error(`Create job from Supabase failed (${res.status})`);
  return await res.json();
}

export type Job = {
  id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  original_filename: string;
  duration_sec: number;
  error_message: string;
  stage?: string;
  progress?: number;
};

export type JobHistoryItem = {
  id: string;
  created_at: string;
  updated_at: string;
  status: JobStatus;
  stage: string;
  progress: number;
  original_filename: string;
  duration_sec: number;
  has_result: boolean;
};

export type AnalysisRow = {
  id: string;
  /** Backend often returns both id (uuid) and job_id (text). */
  job_id?: string;
  created_at: string;
  updated_at: string;
  source_type: string;
  source_url: string;
  title: string;
  original_filename?: string;
  channel_name?: string;
  video_storage_path: string;
  duration_sec: number;
  status: JobStatus;
  stage: string;
  progress: number;
  error_message: string;
  overall_score?: number;
  confidence_score?: number;
  energy_score?: number;
  wpm?: number;
  eye_contact_ratio?: number;
  result_json?: Record<string, unknown> | null;
};

export async function listAnalyses(limit = 200): Promise<{ analyses: AnalysisRow[] }> {
  const res = await fetch(`${API_BASE}/api/analyses?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Analyses list failed (${res.status})`);
  return await res.json();
}

export async function getAnalysisResult(analysisId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/analyses/${analysisId}/result`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Analysis result fetch failed (${res.status})`);
  const data = await res.json();
  return data.result;
}

export type ChannelItem = {
  id: string;
  name: string;
  collections: number;
  videos: number;
  latest_collection_id: string;
};

export type ChannelCollection = {
  collection_id: string;
  title: string;
  created_at: string;
  total_videos: number;
  completed_videos: number;
  failed_videos: number;
};

export type ComparisonInput = {
  job_id: string;
  source_type: "upload" | "youtube_url";
  video_url?: string;
  compare_mode: "niche_benchmark" | "specific_channel";
  niche: string;
  competitor_channel?: string;
  goal: "retention" | "clarity" | "conversion" | "confidence";
  platform: "youtube_long" | "youtube_shorts";
  language?: string;
  format?: "talking_head" | "tutorial" | "vlog" | "interview";
  audience_level?: "beginner" | "intermediate" | "advanced";
};

export async function getComparisonReport(payload: ComparisonInput): Promise<any> {
  const res = await fetch(`${API_BASE}/api/comparison/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = (data?.detail ? `: ${data.detail}` : "") as string;
    } catch {
      // ignore
    }
    throw new Error(`Comparison report failed (${res.status})${detail}`);
  }
  return await res.json();
}

export type YouTubeIngestCreateInput = { channel: string; video_count?: number };
export type YouTubeIngestCreateOutput = { ingest_id: string; status: string; channel_handle: string; message?: string };
export type YouTubeIngestStatus = {
  ingest_id: string;
  status: string;
  channel_handle: string;
  requested_video_count: number;
  message?: string;
  total_videos: number;
  completed_videos: number;
  failed_videos: number;
  processing_videos: number;
  benchmark_ready: boolean;
  benchmark_sample_size: number;
};

export async function createYouTubeChannelIngest(payload: YouTubeIngestCreateInput): Promise<YouTubeIngestCreateOutput> {
  const res = await fetch(`${API_BASE}/api/youtube/channel/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: payload.channel, video_count: payload.video_count ?? 10 }),
  });
  if (!res.ok) throw new Error(`YouTube ingest failed (${res.status})`);
  return await res.json();
}

export async function getYouTubeIngestStatus(ingestId: string): Promise<YouTubeIngestStatus> {
  const res = await fetch(`${API_BASE}/api/youtube/ingest/${ingestId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`YouTube ingest status failed (${res.status})`);
  return await res.json();
}

export async function uploadVideo(
  file: File,
  channelName = ""
): Promise<{ job_id: string; status: JobStatus; collection_id?: string; channel_id?: string; channel_name?: string }> {
  if (file.size <= getSignedUploadMaxBytes() && supabase) {
    return await uploadJobViaSupabaseSignedUrl(file, channelName);
  }
  const form = new FormData();
  form.append("file", file);
  if (channelName.trim()) form.append("channel_name", channelName.trim());
  const res = await fetch(`${API_BASE}/api/jobs/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return await res.json();
}

/** POST /api/upload — multipart to API, or direct-to-Supabase when under signed-url cap (avoids long Railway HTTP/2 uploads). */
export async function uploadVideoFast(
  file: File,
  channelName = ""
): Promise<{ analysis_id: string; status: "queued" }> {
  if (file.size <= getSignedUploadMaxBytes() && supabase) {
    const out = await uploadJobViaSupabaseSignedUrl(file, channelName);
    return { analysis_id: out.job_id, status: "queued" };
  }
  const form = new FormData();
  form.append("file", file);
  if (channelName.trim()) form.append("channel_name", channelName.trim());
  const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return await res.json();
}

export type AnalysisDetail = {
  analysis: Record<string, unknown> | null;
  job: {
    id: string;
    status: JobStatus;
    stage: string;
    progress: number;
    progress_percent: number;
    original_filename: string;
    duration_sec: number;
    error_message: string;
  } | null;
  result_json: Record<string, unknown> | null;
  events: unknown[];
};

/** Unified analysis row + SQLite job progress + result_json + events (poll while processing). */
export async function getAnalysisDetail(analysisId: string): Promise<AnalysisDetail> {
  const res = await fetch(`${API_BASE}/api/analyses/${analysisId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Analysis fetch failed (${res.status})`);
  return await res.json();
}

/** Prefer Supabase `analysis` fields (same source as Dashboard); fill gaps from SQLite `job` in the same response. */
function mergeProgressFromDetail(detail: AnalysisDetail): {
  status: string;
  stage: string;
  progress: number;
  error_message: string;
} {
  const a = detail.analysis as Record<string, unknown> | null | undefined;
  const j = detail.job;

  const pickStr = (primary: unknown, fallback: string) => {
    const s = primary != null ? String(primary).trim() : "";
    return s !== "" ? s : fallback;
  };

  let progress = 0;
  if (a && typeof a.progress === "number" && Number.isFinite(a.progress)) {
    progress = a.progress;
  } else if (a && typeof a.progress === "string") {
    const p = parseFloat(a.progress);
    if (Number.isFinite(p)) progress = p;
  } else if (j) {
    progress = Number(j.progress ?? 0);
  }

  const status = pickStr(a?.status, j?.status ?? "");
  const stage = pickStr(a?.stage, j?.stage ?? "");

  const errRaw = a?.error_message != null ? String(a.error_message).trim() : "";
  const error_message = errRaw !== "" ? errRaw : (j?.error_message ?? "");

  return { status, stage, progress, error_message };
}

/** POST /api/compare — two completed analyses by job/analysis id. */
export async function compareAnalyses(leftAnalysisId: string, rightAnalysisId: string): Promise<{
  comparison_report_id?: string;
  report: unknown;
}> {
  const res = await fetch(`${API_BASE}/api/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ left_analysis_id: leftAnalysisId, right_analysis_id: rightAnalysisId }),
  });
  if (!res.ok) throw new Error(`Compare failed (${res.status})`);
  return await res.json();
}

export async function uploadVideos(
  files: File[],
  channelName = "",
  collectionTitle = ""
): Promise<{
  jobs: { job_id: string; status: JobStatus; collection_id?: string; channel_id?: string; channel_name?: string }[];
  collection_id?: string;
  channel_id?: string;
  channel_name?: string;
  suggested_channel_name?: string;
  suggestion_confidence?: string;
}> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  if (channelName.trim()) form.append("channel_name", channelName.trim());
  if (collectionTitle.trim()) form.append("collection_title", collectionTitle.trim());
  const res = await fetch(`${API_BASE}/api/jobs/upload/batch`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Batch upload failed (${res.status})`);
  return await res.json();
}

export async function createJobFromYouTubeUrl(url: string): Promise<{ job_id: string; status: JobStatus }> {
  const res = await fetch(`${API_BASE}/api/jobs/from-youtube`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`YouTube URL job failed (${res.status})`);
  return await res.json();
}

export async function getCollectionSummary(collectionId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/collections/${collectionId}/summary`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Collection summary failed (${res.status})`);
  return await res.json();
}

export async function listChannels(): Promise<{ channels: ChannelItem[] }> {
  const res = await fetch(`${API_BASE}/api/channels`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Channel list failed (${res.status})`);
  return await res.json();
}

export async function getChannelCollections(channelId: string): Promise<{ channel_id: string; channel_name: string; collections: ChannelCollection[] }> {
  const res = await fetch(`${API_BASE}/api/channels/${channelId}/collections`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Channel collections failed (${res.status})`);
  return await res.json();
}

export async function renameChannel(channelId: string, name: string): Promise<ChannelItem> {
  const res = await fetch(`${API_BASE}/api/channels/${channelId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Rename channel failed (${res.status})`);
  return await res.json();
}

export async function deleteChannel(channelId: string): Promise<{ ok: boolean; deleted_channel_id: string }> {
  const res = await fetch(`${API_BASE}/api/channels/${channelId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete channel failed (${res.status})`);
  return await res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Job fetch failed (${res.status})`);
  const data = await res.json();
  return data.job as Job;
}

/**
 * Job progress for UI polling: matches Dashboard by preferring Supabase analyses row when present.
 * Falls back to GET /api/jobs if /api/analyses/{id} fails (e.g. row not created yet).
 */
export async function getJobProgressUnified(jobId: string): Promise<{
  status: JobStatus;
  stage: string;
  progress: number;
  error_message: string;
}> {
  try {
    const detail = await getAnalysisDetail(jobId);
    const m = mergeProgressFromDetail(detail);
    return {
      status: (m.status || "queued") as JobStatus,
      stage: m.stage,
      progress: m.progress,
      error_message: m.error_message,
    };
  } catch {
    const j = await getJob(jobId);
    return {
      status: j.status,
      stage: j.stage ?? "",
      progress: Number(j.progress ?? 0),
      error_message: j.error_message || "",
    };
  }
}

export async function listJobs(limit = 200): Promise<{ jobs: JobHistoryItem[] }> {
  const res = await fetch(`${API_BASE}/api/jobs?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Jobs list failed (${res.status})`);
  return await res.json();
}

export async function getResult(jobId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/result`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Result fetch failed (${res.status})`);
  const data = await res.json();
  return data.result;
}

