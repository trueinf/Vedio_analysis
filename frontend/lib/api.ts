/** Base URL for the FastAPI backend only (no path suffix). */
function getApiBase(): string {
  // Prefer NEXT_PUBLIC_API_URL (Netlify/Railway), fall back to older NEXT_PUBLIC_API_BASE.
  let b = (process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000").trim();
  b = b.replace(/\/+$/, "");
  // Common misconfig: user sets .../api/jobs — strip so we don't double paths.
  b = b.replace(/\/api\/jobs\/?$/i, "");
  b = b.replace(/\/api\/?$/i, "");
  // Mistaken paste of a page path or single endpoint (would break all /api/* calls).
  b = b.replace(/\/dashboard\/?$/i, "");
  b = b.replace(/\/api\/analyses\/?$/i, "");
  b = b.replace(/\/analyses\/?$/i, "");
  return b;
}

const API_BASE = getApiBase();

/** Default timeout for API reads (Railway cold start + Supabase can exceed a few seconds). */
const API_FETCH_TIMEOUT_MS = 90_000;

/**
 * fetch() with an abort timeout so the UI does not spin forever when the API hangs or is unreachable.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = API_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: unknown) {
    const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
    if (name === "AbortError") {
      throw new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. Check NEXT_PUBLIC_API_URL, Railway status, and that the backend can reach Supabase.`
      );
    }
    throw e;
  } finally {
    clearTimeout(id);
  }
}

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

/** GET /api/upload-url — presigned upload target (bytes go browser → Supabase only). */
export async function getPresignedUploadUrl(filename: string): Promise<{ upload_url: string; storage_path: string; token: string }> {
  const res = await fetch(`${API_BASE}/api/upload-url?filename=${encodeURIComponent(filename)}`, { cache: "no-store" });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Presigned URL failed (${res.status}): ${t}`);
  }
  return await res.json();
}

/** PUT file bytes to Supabase signed URL (XHR for optional progress). */
export function uploadPutBlobWithProgress(uploadUrl: string, file: File, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload to storage failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload to storage"));
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  });
}

/** POST /api/jobs — queue analysis after the object exists in Storage. */
export async function createJobFromBrowserUpload(
  storage_path: string,
  filename: string,
  opts?: { channel_id?: string; channel_name?: string }
): Promise<{ job_id: string; status: JobStatus }> {
  const res = await fetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storage_path,
      filename,
      channel_id: opts?.channel_id || undefined,
      channel_name: opts?.channel_name?.trim() || undefined,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const d = (await res.json()) as { detail?: unknown };
      detail = typeof d?.detail === "string" ? d.detail : JSON.stringify(d);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Create job failed (${res.status}): ${detail}`);
  }
  return await res.json();
}

async function uploadViaPresignedToSupabase(
  file: File,
  channelName: string,
  opts?: { channel_id?: string; onUploadProgress?: (pct: number) => void }
): Promise<{ job_id: string; status: JobStatus }> {
  await fetch(`${API_BASE}/api/supabase/storage/ensure-bucket`, { method: "POST" });
  const meta = await getPresignedUploadUrl(file.name);
  await uploadPutBlobWithProgress(meta.upload_url, file, opts?.onUploadProgress);
  return await createJobFromBrowserUpload(meta.storage_path, file.name, {
    channel_name: channelName,
    channel_id: opts?.channel_id,
  });
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

/** GET /api/channels/summary — channel deck + aggregated Supabase stats. */
export type ChannelSummary = {
  id: string;
  name: string;
  totalVideos: number;
  completedCount: number;
  processingCount: number;
  avgConfidence: number;
  avgEnergy: number;
  avgEyeContact: number;
  lastAnalyzedAt: string;
  thumbnailUrl: string | null;
  /** Avg confidence of latest 5 completed videos (newest first). */
  recentAvgConfidence?: number | null;
  /** Avg confidence of videos 6–10; null if fewer than 5 older videos. */
  previousAvgConfidence?: number | null;
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
  thumbnail_url?: string;
  result_json?: Record<string, unknown> | null;
};

export async function listAnalyses(limit = 120, includeResultJson = false): Promise<{ analyses: AnalysisRow[] }> {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  if (includeResultJson) q.set("include_result", "true");
  const res = await fetchWithTimeout(`${API_BASE}/api/analyses?${q.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Analyses list failed (${res.status})`);
  return await res.json();
}

/** GET /api/channels/summary — same payload as dashboard. */
export async function fetchChannelsSummary(): Promise<{ channels: ChannelSummary[] }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/channels/summary`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Channels summary failed (${res.status})`);
  return await res.json();
}

/** GET /api/channels/{name}/analyses — all rows for channel, oldest first. */
export async function listAnalysesForChannel(
  channelName: string,
  includeResultJson = true
): Promise<{ analyses: AnalysisRow[] }> {
  const enc = encodeURIComponent(channelName);
  const q = new URLSearchParams();
  if (includeResultJson) q.set("include_result", "true");
  const qs = q.toString();
  const res = await fetch(`${API_BASE}/api/channels/${enc}/analyses${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Channel analyses failed (${res.status})`);
  return await res.json();
}

export type ChannelReport = {
  channel_name: string;
  total_videos: number;
  completed_videos: number;
  avg_confidence: number;
  avg_energy: number;
  avg_wpm: number;
  avg_eye_contact: number;
  confidence_trend: "improving" | "declining" | "stable" | null;
  recent_avg_confidence: number | null;
  previous_avg_confidence: number | null;
  benchmark?: Record<
    string,
    {
      n: number;
      missing: number;
      p10: number | null;
      p25: number | null;
      p50: number | null;
      p75: number | null;
      p90: number | null;
      hist: { labels: string[]; counts: number[] };
    }
  >;
  top_coach_patterns: { comment: string; count: number }[];
  best_videos: { filename: string; confidence: number | null; analysis_id: string }[];
  worst_videos: { filename: string; confidence: number | null; analysis_id: string }[];
  confidence_over_time: { date: string; value: number | null }[];
  individual_videos: {
    analysis_id: string;
    filename: string;
    confidence_score: number | null;
    energy_score: number | null;
    eye_contact_ratio: number | null;
    created_at: string;
    metrics: {
      speech_rate_wpm: number | null;
      filler_rate: number | null;
      gesture_rate: number | null;
      tonal_variation: number | null;
      expression_change: number | null;
    };
  }[];
};

export async function fetchChannelReport(channelName: string): Promise<ChannelReport> {
  const enc = encodeURIComponent(channelName.trim());
  const res = await fetch(`${API_BASE}/api/channels/${enc}/report`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Channel report failed (${res.status})`);
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
  channelName = "",
  opts?: { channel_id?: string; onUploadProgress?: (pct: number) => void }
): Promise<{ job_id: string; status: JobStatus; collection_id?: string; channel_id?: string; channel_name?: string }> {
  return await uploadViaPresignedToSupabase(file, channelName, opts);
}

/** Same pipeline as uploadVideo — presigned URL + POST /api/jobs (no multipart to Railway). */
export async function uploadVideoFast(
  file: File,
  channelName = ""
): Promise<{ analysis_id: string; status: "queued" }> {
  const out = await uploadViaPresignedToSupabase(file, channelName);
  return { analysis_id: out.job_id, status: "queued" };
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

/** Parallel uploads; each file uses presigned Storage + POST /api/jobs (no batch on Railway). */
export async function uploadVideos(
  files: File[],
  channelName = "",
  _collectionTitle = ""
): Promise<{
  jobs: { job_id: string; status: JobStatus; collection_id?: string; channel_id?: string; channel_name?: string }[];
  collection_id?: string;
  channel_id?: string;
  channel_name?: string;
  suggested_channel_name?: string;
  suggestion_confidence?: string;
}> {
  const jobs = await Promise.all(files.map((f) => uploadVideo(f, channelName)));
  return { jobs };
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

/** POST /api/jobs/youtube — YouTube video URL + existing SQLite channel. */
export async function createYouTubeJobWithChannel(
  youtubeUrl: string,
  channelId: string
): Promise<{ job_id: string; status: JobStatus }> {
  const res = await fetch(`${API_BASE}/api/jobs/youtube`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtube_url: youtubeUrl, channel_id: channelId }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { detail?: string };
      if (typeof data.detail === "string") detail = data.detail;
    } catch {
      // ignore
    }
    throw new Error(detail || `YouTube job failed (${res.status})`);
  }
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

/** PATCH /api/channels/{id} — updates SQLite display name only (Supabase analyses unchanged). */
export type ChannelRenameResult = { success: true; channel: { id: string; name: string } };

export async function updateChannelName(channelId: string, name: string): Promise<ChannelRenameResult> {
  const res = await fetch(`${API_BASE}/api/channels/${channelId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { detail?: string | { msg?: string }[] };
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((x) => (typeof x === "object" && x && "msg" in x ? String((x as { msg?: string }).msg) : "")).filter(Boolean).join(", ");
    } catch {
      // ignore
    }
    throw new Error(detail || `Rename channel failed (${res.status})`);
  }
  return (await res.json()) as ChannelRenameResult;
}

export async function deleteChannel(channelId: string): Promise<{ success: boolean; id: string }> {
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

