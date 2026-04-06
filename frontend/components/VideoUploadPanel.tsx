"use client";

import clsx from "clsx";
import { Button, Card, PremiumField } from "./ui";

export type UploadJobListItem = {
  id: string;
  name: string;
  status: string;
  stage: string;
  progress: number;
};

export function isValidYouTubeVideoUrl(input: string): boolean {
  return Boolean(getYouTubeVideoId(input));
}

function getYouTubeVideoId(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.replace(/^\//, "").split("/")[0];
      return id || null;
    }
    if (host.endsWith("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const m = url.pathname.match(/\/shorts\/([^/?#]+)/);
      if (m?.[1]) return m[1];
      const e = url.pathname.match(/\/embed\/([^/?#]+)/);
      if (e?.[1]) return e[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function VideoUploadPanel(props: {
  jobId: string | null;
  localVideoUrl: string;
  demoMode: boolean;
  channelName: string;
  onChannelNameChange: (v: string) => void;
  youtubeUrl: string;
  onYoutubeUrlChange: (v: string) => void;
  ytIngest: any | null;
  ytIngesting: boolean;
  onPickFiles: (files: File[]) => void;
  onAnalyze: () => void;
  onRefresh: () => void;
  onClearHistory?: () => void;
  canAnalyze: boolean;
  canRefresh: boolean;
  selectedFilesCount: number;
  status: string;
  stage: string;
  progress: number;
  jobError: string;
  uploadedJobs: UploadJobListItem[];
  activeJobId: string | null;
  onSelectJob: (jobId: string) => void;
  setVideoRef: (el: HTMLVideoElement | null) => void;
  onVideoLoadedMetadata: (duration: number) => void;
  onVideoTimeUpdate: (time: number) => void;
  /** When set, show Upload / YouTube tabs and optional channel picker for YouTube mode. */
  uploadMode?: "file" | "youtube";
  onUploadModeChange?: (m: "file" | "youtube") => void;
  channels?: { id: string; name: string }[];
  channelId?: string;
  onChannelIdChange?: (id: string) => void;
  youtubeFieldError?: string;
}) {
  const uploadMode = props.uploadMode ?? "file";
  const onUploadModeChange = props.onUploadModeChange ?? (() => {});
  const channels = props.channels ?? [];
  const channelId = props.channelId ?? "";
  const onChannelIdChange = props.onChannelIdChange ?? (() => {});
  const ytId = getYouTubeVideoId(props.youtubeUrl);
  const ytEmbedSrc = ytId
    ? `https://www.youtube.com/embed/${ytId}?autoplay=0&rel=0&modestbranding=1&playsinline=1`
    : "";
  return (
    <Card
      id="demo-problem"
      className={`col-span-12 lg:col-span-6 p-4 h-full transition-all duration-500 bg-white/5 border border-white/10 backdrop-blur text-white`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold">Video</div>
        {props.jobId ? <div className="text-xs text-slate-300">Job: {props.jobId}</div> : null}
      </div>
      {props.uploadMode != null ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => onUploadModeChange("file")}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-xs border transition-colors",
              uploadMode === "file"
                ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
                : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
            )}
          >
            Upload file
          </button>
          <button
            type="button"
            onClick={() => onUploadModeChange("youtube")}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-xs border transition-colors",
              uploadMode === "youtube"
                ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
                : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
            )}
          >
            YouTube URL
          </button>
        </div>
      ) : null}
      <div className="mt-3 border border-white/10 rounded-xl overflow-hidden bg-black/30 aspect-video flex items-center justify-center text-slate-300 text-sm">
        {props.localVideoUrl ? (
          <video
            ref={props.setVideoRef}
            src={props.localVideoUrl}
            controls
            className="w-full h-full object-contain bg-black"
            onLoadedMetadata={(e) => props.onVideoLoadedMetadata(Number(e.currentTarget.duration || 0))}
            onTimeUpdate={(e) => props.onVideoTimeUpdate(Number(e.currentTarget.currentTime || 0))}
          />
        ) : ytEmbedSrc ? (
          <iframe
            className="w-full h-full bg-black"
            src={ytEmbedSrc}
            title="YouTube video preview"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          "Video preview will appear here (optional)"
        )}
      </div>
      <div className={`mt-4 flex items-center gap-3 flex-wrap ${props.demoMode ? "hidden" : ""}`}>
        {props.uploadMode == null ? (
          <>
            <PremiumField
              value={props.channelName}
              onChange={props.onChannelNameChange}
              placeholder="Channel name (e.g. ifan)"
            />
            <PremiumField
              value={props.youtubeUrl}
              onChange={props.onYoutubeUrlChange}
              placeholder="Or paste YouTube link (https://www.youtube.com/watch?v=...)"
            />
            <input
              type="file"
              accept="video/*"
              multiple
              onChange={(e) => props.onPickFiles(Array.from(e.target.files ?? []))}
              className="text-sm text-slate-200 file:mr-2 file:px-3 file:py-1 file:rounded-md file:border-0 file:bg-white/10 file:text-white hover:file:bg-white/15"
            />
          </>
        ) : uploadMode === "file" ? (
          <>
            <PremiumField
              value={props.channelName}
              onChange={props.onChannelNameChange}
              placeholder="Channel name (e.g. ifan)"
            />
            <input
              type="file"
              accept="video/*"
              multiple
              onChange={(e) => props.onPickFiles(Array.from(e.target.files ?? []))}
              className="text-sm text-slate-200 file:mr-2 file:px-3 file:py-1 file:rounded-md file:border-0 file:bg-white/10 file:text-white hover:file:bg-white/15"
            />
            <div className="w-full text-xs text-slate-400">
              Supports MP4, MOV, AVI, WebM · Up to 3 hours · No file limit
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1 min-w-[200px] flex-1">
              <label className="text-[11px] text-slate-400">Channel</label>
              <select
                value={channelId}
                onChange={(e) => onChannelIdChange(e.target.value)}
                className="bg-white/5 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400/50"
              >
                <option value="">Select channel…</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <PremiumField
              value={props.youtubeUrl}
              onChange={props.onYoutubeUrlChange}
              placeholder="Paste YouTube URL (watch?v=, youtu.be, or /shorts/)"
            />
          </>
        )}
        <Button variant="premium" onClick={props.onAnalyze} disabled={!props.canAnalyze}>
          Analyze
        </Button>
        <Button variant="premium-ghost" onClick={props.onRefresh} disabled={!props.canRefresh}>
          Refresh
        </Button>
        <div className="text-xs text-slate-300">
          {uploadMode === "youtube" && props.uploadMode != null
            ? "Paste a video link and pick a channel"
            : props.selectedFilesCount
              ? `${props.selectedFilesCount} videos selected`
              : "Select one or more videos"}
        </div>
        <div className="text-sm text-slate-300">
          Status: <span className="font-medium text-white">{props.status || "-"}</span>
        </div>
        {props.status === "processing" || props.status === "queued" ? (
          <div className="text-xs text-slate-300">
            Stage: <span className="font-medium text-white">{props.stage || "-"}</span>{" "}
            {props.progress ? <span className="text-slate-400">({Math.round(props.progress * 100)}%)</span> : null}
          </div>
        ) : null}
        {props.stage === "downloading" ? (
          <div className="text-xs text-amber-200/90">Downloading video from YouTube… this can take a minute.</div>
        ) : null}
        {props.youtubeFieldError ? <div className="text-sm text-red-300">{props.youtubeFieldError}</div> : null}
        {props.jobError ? <div className="text-sm text-bad">{props.jobError}</div> : null}
      </div>

      {!props.demoMode && props.ytIngest ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-slate-200">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <div>
              <span className="text-slate-400">YouTube ingest</span> {props.ytIngest.channel_handle}
            </div>
            <div>
              <span className="text-slate-400">Status</span> {props.ytIngest.status}
            </div>
            <div>
              <span className="text-slate-400">Videos</span> {props.ytIngest.completed_videos}/{props.ytIngest.total_videos} completed
              {props.ytIngest.processing_videos ? ` · ${props.ytIngest.processing_videos} processing` : ""}
              {props.ytIngest.failed_videos ? ` · ${props.ytIngest.failed_videos} failed` : ""}
            </div>
            <div>
              <span className="text-slate-400">Benchmark</span>{" "}
              {props.ytIngest.benchmark_ready ? `ready (n=${props.ytIngest.benchmark_sample_size})` : "building"}
            </div>
          </div>
          {props.ytIngest.message ? <div className="mt-2 text-slate-300">{props.ytIngest.message}</div> : null}
        </div>
      ) : null}
      {props.uploadedJobs.length ? (
        <div className="mt-4 border border-white/10 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-2 py-2 bg-white/5">
            <div className="text-xs text-slate-300">Recent uploads</div>
            {props.onClearHistory ? (
              <Button variant="premium-ghost" onClick={props.onClearHistory}>
                Clear history
              </Button>
            ) : null}
          </div>
          <div className="max-h-44 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-white/5 text-slate-300">
                <tr>
                  <th className="text-left px-2 py-2">Video</th>
                  <th className="text-left px-2 py-2">Status</th>
                  <th className="text-left px-2 py-2">Progress</th>
                </tr>
              </thead>
              <tbody>
                {props.uploadedJobs.map((j) => (
                  <tr
                    key={j.id}
                    className={`border-t border-white/10 cursor-pointer ${props.activeJobId === j.id ? "bg-cyan-500/20" : "hover:bg-white/5"}`}
                    onClick={() => props.onSelectJob(j.id)}
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
  );
}

