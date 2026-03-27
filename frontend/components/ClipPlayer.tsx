"use client";

import { Card, premiumSurfaceClass } from "./ui";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Clip = {
  t0: number;
  t1: number;
  url: string;
  label?: string;
  reason?: string;
  impact?: string;
};

export function ClipPlayer(props: {
  clips: Clip[];
  apiBase: string;
  onSeek: (t0: number, t1?: number) => void;
}) {
  if (!props.clips.length) return null;
  return (
    <Card className={`p-4 rounded-xl ${premiumSurfaceClass}`}>
      <div className="text-sm font-semibold">Auto-generated Evidence Clips</div>
      <div className="mt-3 space-y-3">
        {props.clips.slice(0, 5).map((c, i) => (
          <div key={`${i}-${c.t0}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-sm font-medium text-slate-100">{c.label || "Issue segment"}</div>
            <div className="text-xs text-cyan-200 mt-1">
              {formatTime(Number(c.t0 || 0))} - {formatTime(Number(c.t1 || c.t0 || 0))}
            </div>
            {c.reason ? <div className="mt-1 text-xs text-slate-200">{c.reason}</div> : null}
            {c.impact ? <div className="mt-1 text-[11px] text-slate-300">{c.impact}</div> : null}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="px-2 py-1 rounded border border-white/15 text-xs hover:bg-white/10"
                onClick={() => props.onSeek(Number(c.t0 || 0), Number(c.t1 || c.t0 || 0))}
              >
                Seek
              </button>
              <video
                className="h-14 rounded border border-white/10"
                src={`${props.apiBase}${c.url}`}
                preload="metadata"
                muted
                playsInline
                controls
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

