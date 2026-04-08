"use client";

import { useEffect, useRef, useState } from "react";
import { AnalysisReport } from "@/components/AnalysisReport";
import { getJobProgressUnified, uploadVideo } from "../lib/api";
import { VideoDropzone } from "@/components/VideoDropzone";

type JobRow = {
  id: string;
  name: string;
  status: string;
  stage: string;
  progress: number;
  error?: string;
};

/** Interactive landing block — loaded in a separate chunk (see `page.tsx`). */
export default function HomeProcessClient() {
  const [files, setFiles] = useState<File[]>([]);
  const [channelName, setChannelName] = useState("");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const jobsRef = useRef<JobRow[]>([]);
  const hasAutoOpenedReportRef = useRef(false);
  const reportSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  /** First job that reaches completed opens the inline report once (if nothing selected yet). */
  useEffect(() => {
    if (hasAutoOpenedReportRef.current) return;
    if (activeReportId != null) return;
    const firstDone = jobs.find((j) => j.status === "completed");
    if (!firstDone) return;
    setActiveReportId(firstDone.id);
    hasAutoOpenedReportRef.current = true;
  }, [jobs, activeReportId]);

  useEffect(() => {
    if (!activeReportId) return;
    requestAnimationFrame(() => {
      reportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [activeReportId]);

  useEffect(() => {
    const t = setInterval(async () => {
      const cur = jobsRef.current;
      const active = cur.filter((j) => j.status === "queued" || j.status === "processing");
      if (!active.length) return;
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
  }, []);

  async function handleUpload() {
    if (!files.length) return;
    setUploading(true);
    try {
      const newRows: JobRow[] = [];
      for (const f of files) {
        const u = await uploadVideo(f, channelName);
        newRows.push({ id: u.job_id, name: f.name, status: u.status, stage: "queued", progress: 0 });
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
    <>
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
                      <button
                        type="button"
                        onClick={() => setActiveReportId(job.id)}
                        className={`text-xs font-medium rounded-md px-2 py-1 transition-colors ${
                          activeReportId === job.id
                            ? "text-cyan-200 bg-cyan-400/20 border border-cyan-400/40"
                            : "text-cyan-400 hover:text-cyan-300 border border-transparent hover:border-cyan-400/30"
                        }`}
                      >
                        {activeReportId === job.id ? "Report open" : "View report"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {job.status === "processing" || job.status === "queued" ? (
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

      {activeReportId ? (
        <div ref={reportSectionRef} className="mt-10 scroll-mt-6 w-full max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-10">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-1">
            <div className="text-sm font-medium text-white">
              Report:{" "}
              <span className="text-slate-200">
                {jobs.find((j) => j.id === activeReportId)?.name ?? activeReportId}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <a
                href={`/video/${activeReportId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-cyan-300 hover:underline"
              >
                Open full page ↗
              </a>
              <button
                type="button"
                aria-label="Close report"
                className="rounded-lg border border-white/15 px-2.5 py-1 text-sm text-slate-200 hover:bg-white/10"
                onClick={() => setActiveReportId(null)}
              >
                ✕ Close
              </button>
            </div>
          </div>
          <AnalysisReport key={activeReportId} analysisId={activeReportId} embedded />
        </div>
      ) : null}
    </>
  );
}
