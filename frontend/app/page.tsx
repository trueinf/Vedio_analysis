"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getJobProgressUnified, uploadVideo, uploadVideos } from "../lib/api";
import { VideoDropzone } from "@/components/VideoDropzone";

type JobRow = {
  id: string;
  name: string;
  status: string;
  stage: string;
  progress: number;
  error?: string;
};

export default function ProcessPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [channelName, setChannelName] = useState("");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [uploading, setUploading] = useState(false);
  //

  useEffect(() => {
    const active = jobs.filter((j) => j.status === "queued" || j.status === "processing");
    if (!active.length) return;
    const t = setInterval(async () => {
      const updates = await Promise.all(
        active.map(async (row) => {
          try {
            const u = await getJobProgressUnified(row.id);
            return { id: row.id, ...u };
          } catch {
            return null;
          }
        })
      );
      setJobs((prev) =>
        prev.map((row) => {
          const u = updates.find((x) => x?.id === row.id);
          if (!u) return row;
          return {
            ...row,
            status: u.status,
            stage: u.stage || "",
            progress: Number(u.progress || 0),
            error: u.error_message || "",
          };
        })
      );
    }, 3000);
    return () => clearInterval(t);
  }, [jobs]);

  async function handleUpload() {
    if (!files.length) return;
    setUploading(true);
    try {
      const newRows: JobRow[] = [];
      if (files.length > 1) {
        const resp = await uploadVideos(files, channelName);
        resp.jobs.forEach((u, i) => {
          newRows.push({ id: u.job_id, name: files[i]?.name || "", status: u.status, stage: "queued", progress: 0 });
        });
      } else {
        const u = await uploadVideo(files[0], channelName);
        newRows.push({ id: u.job_id, name: files[0].name, status: u.status, stage: "queued", progress: 0 });
      }
      setJobs((prev) => [...newRows, ...prev]);
      setFiles([]);
    } catch (e: any) {
      alert("Upload failed: " + (e?.message || "unknown error"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Process Video</h1>
        <p className="text-slate-400 mt-1">Upload videos for AI-powered delivery analysis</p>
      </div>

      <VideoDropzone files={files} onFilesChange={setFiles} />

      <div className="mt-6 flex items-center gap-4">
        <input
          type="text"
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
          placeholder="Channel name (optional)"
          className="flex-1 bg-white/5 border border-white/15 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
        />
        <button
          onClick={handleUpload}
          disabled={!files.length || uploading}
          className="px-6 py-2.5 bg-cyan-400 text-slate-950 font-semibold rounded-lg hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {uploading ? "Uploading..." : `Analyze ${files.length > 1 ? `${files.length} Videos` : "Video"}`}
        </button>
      </div>

      {jobs.length > 0 ? (
        <div className="mt-10">
          <h2 className="text-lg font-semibold mb-4">Analysis Queue</h2>
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="bg-white/5 border border-white/10 rounded-xl px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`shrink-0 w-2 h-2 rounded-full ${
                        job.status === "completed"
                          ? "bg-emerald-400"
                          : job.status === "failed"
                            ? "bg-red-400"
                            : job.status === "processing"
                              ? "bg-cyan-400 animate-pulse"
                              : "bg-amber-400"
                      }`}
                    />
                    <span className="text-sm font-medium truncate">{job.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-xs text-slate-400">{job.stage || job.status}</span>
                    {job.status === "completed" ? (
                      <Link
                        href={`/dashboard?highlight=${job.id}`}
                        className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
                      >
                        View in Dashboard →
                      </Link>
                    ) : null}
                  </div>
                </div>

                {(job.status === "processing" || job.status === "queued") ? (
                  <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(3, (job.progress || 0) * 100)}%` }}
                    />
                  </div>
                ) : null}

                {job.status === "failed" && job.error ? (
                  <div className="mt-2 text-xs text-red-400">{job.error.split("\n")[0]}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

