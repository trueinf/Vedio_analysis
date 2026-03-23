const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

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

export async function uploadVideo(file: File): Promise<{ job_id: string; status: JobStatus; collection_id?: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/jobs/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return await res.json();
}

export async function uploadVideos(
  files: File[]
): Promise<{ jobs: { job_id: string; status: JobStatus; collection_id?: string }[]; collection_id?: string }> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const res = await fetch(`${API_BASE}/api/jobs/upload/batch`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Batch upload failed (${res.status})`);
  return await res.json();
}

export async function getCollectionSummary(collectionId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/collections/${collectionId}/summary`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Collection summary failed (${res.status})`);
  return await res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Job fetch failed (${res.status})`);
  const data = await res.json();
  return data.job as Job;
}

export async function getResult(jobId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/result`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Result fetch failed (${res.status})`);
  const data = await res.json();
  return data.result;
}

