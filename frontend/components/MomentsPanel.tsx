"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export function MomentsPanel(props: {
  worstMoments: { t0: number; t1?: number; reason?: string }[];
  bestMoments: { t0: number; t1?: number; note?: string }[];
  onSeek: (t0: number, t1?: number) => void;
}) {
  const [tab, setTab] = useState<"worst" | "best">("worst");

  const items = useMemo(() => {
    return tab === "worst" ? props.worstMoments : props.bestMoments;
  }, [tab, props.worstMoments, props.bestMoments]);

  return (
    <div className="w-full bg-white/5 border border-white/10 backdrop-blur rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Moments</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("worst")}
            className={clsx(
              "px-3 py-2 rounded-xl text-xs border transition-all",
              tab === "worst" ? "border-red-400/40 bg-red-400/10 text-red-200" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            )}
          >
            Worst
          </button>
          <button
            type="button"
            onClick={() => setTab("best")}
            className={clsx(
              "px-3 py-2 rounded-xl text-xs border transition-all",
              tab === "best" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            )}
          >
            Best
          </button>
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-400">
        {tab === "worst" ? "Top negative moments (click to seek)" : "Top positive moments (click to seek)"}
      </div>

      <div className="mt-3 space-y-2 max-h-[360px] overflow-auto pr-1">
        {items.length ? (
          items.slice(0, 10).map((m, i) => (
            <button
              key={`${tab}-${i}-${m.t0}`}
              type="button"
              onClick={() => props.onSeek(Number(m.t0 || 0), Number(m.t1 ?? m.t0 ?? 0))}
              className={clsx(
                "w-full text-left border rounded-xl px-3 py-2 transition-all",
                tab === "worst" ? "border-red-400/20 bg-white/5 hover:bg-red-400/10" : "border-emerald-400/20 bg-white/5 hover:bg-emerald-400/10"
              )}
            >
              <div className="text-xs font-semibold">
                {formatTime(Number(m.t0 || 0))} - {formatTime(Number(m.t1 ?? m.t0 ?? 0))}
              </div>
              <div className="text-[11px] text-slate-200 mt-1">{(m as any).reason || (m as any).note || "—"}</div>
            </button>
          ))
        ) : (
          <div className="text-xs text-slate-400">No moments available yet.</div>
        )}
      </div>
    </div>
  );
}

