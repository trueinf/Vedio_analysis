"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { MetricEvent } from "./video-analysis-types";
import { motion } from "framer-motion";

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function eventMetricKey(e: MetricEvent) {
  return String(e.metric || e.type || "").toLowerCase();
}

function eventLabel(e: MetricEvent) {
  return String(e.label || e.message || e.note || e.reason || "");
}

function eventQuality(e: MetricEvent): "good" | "bad" | "neutral" {
  const key = eventMetricKey(e);
  const lbl = eventLabel(e).toLowerCase();

  if (key.includes("best_moment")) return "good";
  if (key.includes("worst_moment")) return "bad";
  if (key.includes("engagement_drop")) return "bad";
  if (key.includes("pause")) return "neutral";

  if (key.includes("eye_contact")) return lbl.includes("low") ? "bad" : "good";
  if (key.includes("speech_rate")) return lbl.includes("normal") ? "good" : "neutral";

  if (key.includes("filler_words")) {
    if (lbl.includes("low")) return "good";
    if (lbl.includes("moderate")) return "neutral";
    if (lbl.includes("high")) return "bad";
    return "neutral";
  }

  if (key.includes("gestures")) {
    if (lbl.includes("low")) return "bad";
    if (lbl.includes("normal")) return "good";
    if (lbl.includes("high")) return "neutral";
    return "neutral";
  }

  if (key.includes("tonal_variation")) {
    if (lbl.includes("monotone") || lbl.includes("flat")) return "bad";
    if (lbl.includes("expressive")) return "good";
    if (lbl.includes("moderate")) return "neutral";
    return "neutral";
  }

  if (key.includes("expression_change")) {
    if (lbl.includes("high")) return "good";
    if (lbl.includes("low")) return "bad";
    return "neutral";
  }

  return "neutral";
}

function qualityColor(q: "good" | "bad" | "neutral") {
  if (q === "good") return "bg-emerald-400/70 border-emerald-300/30";
  if (q === "bad") return "bg-red-400/80 border-red-300/30";
  return "bg-amber-300/70 border-amber-200/30";
}

export function Timeline(props: {
  events: MetricEvent[];
  durationSec: number;
  currentTime: number;
  onSeek: (time: number) => void;
  selectedEvent?: MetricEvent | null;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const dur = Math.max(1, Number(props.durationSec || 1));

  const segments = useMemo(() => {
    const raw = (props.events || []).filter((e) => Number(e.t0 || 0) >= 0).slice(0, 2000);
    raw.sort((a, b) => Number(a.t0 || 0) - Number(b.t0 || 0));
    return raw.map((e) => {
      const t0 = Math.max(0, Number(e.t0 || 0));
      const t1 = Math.max(t0, Number(e.t1 ?? e.t0 ?? 0));
      const q = eventQuality(e);
      const left = (t0 / dur) * 100;
      const width = (Math.max(0.01, t1 - t0) / dur) * 100;
      const metricKey = eventMetricKey(e);
      const label = eventLabel(e);
      const text = label || metricKey || "Event";
      return { e, t0, t1, q, left, width, text };
    });
  }, [props.events, dur]);

  const currentLeft = `${((Math.max(0, props.currentTime || 0) / dur) * 100).toFixed(2)}%`;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">Timeline</div>
        <div className="text-xs text-slate-400">{segments.length ? `${formatTime(props.currentTime)} / ${formatTime(dur)}` : ""}</div>
      </div>

      <div
        className="relative rounded-xl bg-slate-100 border border-black/5 overflow-hidden cursor-pointer h-12"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          props.onSeek(ratio * dur);
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        <div className="absolute inset-0" />

        {segments.slice(0, 140).map((s, i) => (
          <motion.button
            key={`${i}-${s.t0}-${s.t1}`}
            type="button"
            className={clsx("absolute top-1 bottom-1 border rounded-md", qualityColor(s.q))}
            style={{ left: `${s.left}%`, width: `${Math.max(0.3, s.width)}%` }}
            initial={false}
            whileHover={{ y: -1 }}
            onClick={(e) => {
              e.stopPropagation();
              props.onSeek(s.t0);
            }}
            onMouseEnter={(e) => {
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
              setTooltip({
                x: rect.left + rect.width / 2,
                y: rect.top,
                text: `${formatTime(s.t0)} — ${s.text}`,
              });
            }}
          />
        ))}

        <div className="absolute top-0 bottom-0 w-[2px] bg-black/50" style={{ left: currentLeft }} />

        {tooltip ? (
          <div
            className="absolute z-20 pointer-events-none whitespace-nowrap rounded-md bg-slate-950/95 text-white text-[11px] border border-white/10 px-2 py-1 shadow-lg"
            style={{ left: Math.min(tooltip.x - 120, 600), top: Math.max(0, tooltip.y - 38) }}
          >
            {tooltip.text}
          </div>
        ) : null}
      </div>

      <input
        className="mt-3 w-full"
        type="range"
        min={0}
        max={dur}
        step={0.1}
        value={Math.max(0, Math.min(Number(props.currentTime || 0), dur))}
        onChange={(e) => props.onSeek(Number(e.target.value || 0))}
      />
    </div>
  );
}

