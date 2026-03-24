"use client";

import { useState } from "react";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ClipsPanel(props: {
  clips: { t0: number; t1: number; url: string }[];
  clipPreviewUrl: string;
  onClickClip: (clip: { t0: number; t1: number; url: string }) => void;
}) {
  const [hovered, setHovered] = useState<string>("");
  return (
    <div>
      <div className="text-sm font-semibold mb-2">🎬 Clips</div>
      <div className="space-y-2 max-h-[180px] overflow-auto">
        {props.clips.length ? (
          props.clips.map((c, i) => (
            <button
              key={`${i}-${c.t0}`}
              type="button"
              className="w-full text-left border border-black/10 rounded-lg px-3 py-2 hover:bg-slate-50 hover:scale-[1.01] transition-transform"
              onClick={() => props.onClickClip(c)}
              onMouseEnter={() => setHovered(c.url)}
              onMouseLeave={() => setHovered("")}
            >
              <div className="text-xs font-semibold">
                Clip {i + 1}: {formatTime(c.t0)} - {formatTime(c.t1)}
              </div>
              <div className="text-[11px] text-muted">{c.url}</div>
              {hovered === c.url && props.clipPreviewUrl ? (
                <video className="mt-2 w-full rounded-md border border-black/10" src={props.clipPreviewUrl} autoPlay muted loop playsInline />
              ) : null}
            </button>
          ))
        ) : (
          <div className="text-xs text-muted">No clips generated.</div>
        )}
      </div>
      {props.clipPreviewUrl ? (
        <video className="mt-2 w-full rounded-lg border border-black/10" src={props.clipPreviewUrl} controls autoPlay />
      ) : null}
    </div>
  );
}

