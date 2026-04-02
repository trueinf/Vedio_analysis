/** Base URL for the FastAPI backend only (no path suffix). */
function getApiBase(): string {
  let b = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000").trim();
  b = b.replace(/\/+$/, "");
  // Common misconfig: user sets .../api/jobs — strip so we don't double paths.
  b = b.replace(/\/api\/jobs\/?$/i, "");
  b = b.replace(/\/api\/?$/i, "");
  return b;
}

const API_BASE = getApiBase();

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type Job = {
  id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  original_filename: string;
  duration_sec: number;
  error_message: string;
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
  created_at: string;
  updated_at: string;
  source_type: string;
  source_url: string;
  title: string;
  video_storage_path: string;
  duration_sec: number;
  status: JobStatus;
  stage: string;
  progress: number;
  error_message: string;
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
  const form = new FormData();
  form.append("file", file);
  if (channelName.trim()) form.append("channel_name", channelName.trim());
  const res = await fetch(`${API_BASE}/api/jobs/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
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

