"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MetricEvent } from "./video-analysis-types";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function labelCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function eventColor(metric?: string, label?: string): string {
  const m = String(metric || "");
  const l = String(label || "").toLowerCase();
  if (m === "eye_contact") return l.includes("low") ? "bg-red-400/80" : "bg-green-400/80";
  if (m === "filler_words") return "bg-orange-400/80";
  if (m === "gestures") return "bg-purple-400/80";
  if (m === "expression_change") return "bg-blue-400/80";
  if (m === "speech_rate") return l === "normal" ? "bg-green-300/80" : "bg-amber-400/80";
  if (m === "tonal_variation") return l === "monotone" ? "bg-red-300/80" : "bg-cyan-400/80";
  return "bg-slate-400/80";
}

export function MultiMetricTimeline(props: {
  events: MetricEvent[];
  selectedMetric: string;
  durationSec: number;
  currentTime: number;
  activeEvent: MetricEvent | null;
  onSeek: (time: number, endTime?: number) => void;
  onActiveEventChange: (event: MetricEvent | null) => void;
  cinematic?: boolean;
}) {
  const [hoveredEvent, setHoveredEvent] = useState<MetricEvent | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const filteredEvents = useMemo(
    () =>
      (props.selectedMetric
        ? props.events.filter((e) => String(e.metric || e.type) === props.selectedMetric)
        : props.events
      ).sort((a, b) => Number(a.t0 || 0) - Number(b.t0 || 0)),
    [props.events, props.selectedMetric]
  );
  const activeTimelineEvent = useMemo(
    () =>
      filteredEvents.find((e) => {
        const t0 = Number(e.t0 || 0);
        const t1 = Number(e.t1 ?? e.t0 ?? 0);
        return t0 <= props.currentTime && props.currentTime <= Math.max(t0, t1);
      }) ?? null,
    [filteredEvents, props.currentTime]
  );
  const dur = Math.max(1, Number(props.durationSec || 1));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">Video Timeline</div>
        <div className="text-xs text-muted">
          {props.selectedMetric ? `Filtered: ${labelCase(props.selectedMetric.replace("_", " "))}` : "All metrics"}
        </div>
      </div>
      <div className="text-xs text-muted mb-3">Click anywhere to seek, hover for context, drag scrubber.</div>
      <div
        className="relative rounded-xl bg-slate-100 border border-black/5 overflow-hidden cursor-pointer p-2 space-y-1"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          props.onSeek(ratio * dur);
        }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const t = (Math.max(0, Math.min(rect.width, x)) / rect.width) * dur;
          const hit = filteredEvents.find((ev) => {
            const t0 = Number(ev.t0 || 0);
            const t1 = Number(ev.t1 ?? ev.t0 ?? 0);
            return t0 <= t && t <= Math.max(t0, t1);
          });
          setHoveredEvent(hit || null);
          setTooltip({ x, y });
        }}
        onMouseLeave={() => {
          setHoveredEvent(null);
          setTooltip(null);
        }}
      >
        {["eye_contact", "filler_words", "gestures", "tonal_variation"].map((rowMetric) => (
          <div key={rowMetric} className="relative h-8 rounded-md bg-white/70 border border-black/5">
            <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted z-10">
              {labelCase(rowMetric.replace("_", " "))}
            </div>
            {filteredEvents
              .filter((ev) => String(ev.metric || ev.type) === rowMetric)
              .map((ev, i) => {
                const t0 = Number(ev.t0 || 0);
                const t1 = Number(ev.t1 ?? ev.t0 ?? 0);
                const left = (t0 / dur) * 100;
                const width = (Math.max(0.3, t1 - t0) / dur) * 100;
                const isActive =
                  props.activeEvent &&
                  Number(props.activeEvent.t0 || 0) === t0 &&
                  String(props.activeEvent.metric || props.activeEvent.type) === String(ev.metric || ev.type);
                const isLive = activeTimelineEvent === ev;
                const isWorst = String(ev.metric || ev.type) === "eye_contact" && String(ev.label || "").toLowerCase().includes("low");
                return (
                  <motion.div
                    key={`${rowMetric}-${i}-${ev.t0}`}
                    className={`absolute top-0 h-full ${eventColor(ev.metric || ev.type, ev.label)} ${
                      isActive || isLive ? "ring-2 ring-white/90 shadow-[0_0_0_2px_rgba(59,130,246,0.5)]" : ""
                    }`}
                    style={{ left: `${left}%`, width: `${Math.max(0.8, width)}%` }}
                    initial={props.cinematic ? { opacity: 0, scaleX: 0, transformOrigin: "left" } : false}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ duration: props.cinematic ? 0.45 : 0.2, delay: props.cinematic ? i * 0.015 : 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onActiveEventChange(ev);
                      props.onSeek(Number(ev.t0 || 0), typeof ev.t1 === "number" ? Number(ev.t1) : undefined);
                    }}
                  >
                    {isWorst && props.cinematic ? (
                      <div className="absolute inset-0 shadow-[0_0_10px_rgba(248,113,113,0.8)]" />
                    ) : null}
                  </motion.div>
                );
              })}
          </div>
        ))}
        <div className="absolute top-0 bottom-0 w-0.5 bg-black/70 z-20" style={{ left: `${((props.currentTime / dur) * 100).toFixed(2)}%` }} />
        {hoveredEvent && tooltip ? (
          <div
            className="absolute z-20 pointer-events-none bg-white border border-black/10 rounded-md shadow px-2 py-1 text-[11px]"
            style={{ left: Math.min(tooltip.x + 10, 400), top: Math.max(tooltip.y - 46, 2) }}
          >
            <div className="font-medium">{formatTime(Number(hoveredEvent.t0 || 0))}</div>
            <div>{hoveredEvent.metric ?? hoveredEvent.type}</div>
            <div>{hoveredEvent.label ?? "-"}</div>
            <div className="text-muted">{hoveredEvent.note ?? hoveredEvent.message ?? "-"}</div>
          </div>
        ) : null}
      </div>
      <input
        type="range"
        min={0}
        max={dur}
        step={0.1}
        value={Math.max(0, Math.min(Number(props.currentTime || 0), dur))}
        className="mt-3 w-full"
        onChange={(e) => props.onSeek(Number(e.target.value || 0))}
      />
    </div>
  );
}

