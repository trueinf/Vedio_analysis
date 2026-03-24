"use client";

import { Button, Card, PremiumField } from "./ui";

export type UploadJobListItem = {
  id: string;
  name: string;
  status: string;
  stage: string;
  progress: number;
};

export function VideoUploadPanel(props: {
  jobId: string | null;
  localVideoUrl: string;
  demoMode: boolean;
  channelName: string;
  onChannelNameChange: (v: string) => void;
  onPickFiles: (files: File[]) => void;
  onAnalyze: () => void;
  onRefresh: () => void;
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
}) {
  return (
    <Card
      id="demo-problem"
      className={`col-span-12 lg:col-span-6 p-4 h-full transition-all duration-500 bg-white/5 border border-white/10 backdrop-blur text-white`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Video</div>
        {props.jobId ? <div className="text-xs text-slate-300">Job: {props.jobId}</div> : null}
      </div>
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
        ) : (
          "Video preview will appear here (optional)"
        )}
      </div>
      <div className={`mt-4 flex items-center gap-3 flex-wrap ${props.demoMode ? "hidden" : ""}`}>
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
        <Button variant="premium" onClick={props.onAnalyze} disabled={!props.canAnalyze}>
          Analyze
        </Button>
        <Button variant="premium-ghost" onClick={props.onRefresh} disabled={!props.canRefresh}>
          Refresh
        </Button>
        <div className="text-xs text-slate-300">
          {props.selectedFilesCount ? `${props.selectedFilesCount} videos selected` : "Select one or more videos"}
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
        {props.jobError ? <div className="text-sm text-bad">{props.jobError}</div> : null}
      </div>
      {props.uploadedJobs.length ? (
        <div className="mt-4 border border-white/10 rounded-lg overflow-hidden">
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

