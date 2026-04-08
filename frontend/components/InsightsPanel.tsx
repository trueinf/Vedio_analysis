"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Card, premiumSurfaceClass } from "./ui";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function scoreBand(v: number): "Good" | "Moderate" | "Needs Improvement" {
  if (v > 75) return "Good";
  if (v >= 50) return "Moderate";
  return "Needs Improvement";
}

function scoreTone(v: number): string {
  if (v > 75) return "text-emerald-300";
  if (v >= 50) return "text-amber-300";
  return "text-red-300";
}

function ScoreCard(props: { title: string; value: number }) {
  const band = scoreBand(props.value);
  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col justify-center">
      <div className="text-xs text-slate-300">{props.title}</div>
      <div className="text-4xl font-bold mt-1">{props.value}</div>
      <div className={`text-xs mt-1 ${scoreTone(props.value)}`}>{band}</div>
    </div>
  );
}

export function InsightsPanel(props: {
  insights: string[];
  engagementDrops: { t0: number; t1?: number; note?: string }[];
  confidenceScore: number;
  energyScore: number;
  duration: number;
  onSeek: (time: number) => void;
}) {
  const [hovered, setHovered] = useState<{ x: number; y: number; text: string } | null>(null);
  const duration = Math.max(1, Number(props.duration || 1));
  const insightRows =
    props.insights.length > 0 ? props.insights : ["No major issues detected. Good performance."];

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full mb-6"
    >
      <Card className={`p-6 rounded-2xl shadow-lg ${premiumSurfaceClass}`}>
        <div className="grid w-full grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 min-w-0">
          <div className="min-w-0 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-lg font-semibold text-white">🔥 Key Insights</div>
            <ul className="mt-3 space-y-2">
              {insightRows.map((x, i) => {
                const linkedDrop = props.engagementDrops[i];
                return (
                  <li key={`${x}-${i}`}>
                    <button
                      type="button"
                      className="text-left text-sm md:text-base text-white hover:text-blue-400 cursor-pointer transition-colors"
                      onClick={() => {
                        if (linkedDrop) props.onSeek(Number(linkedDrop.t0 || 0));
                      }}
                    >
                      • {x}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex flex-col gap-4 w-full lg:w-auto shrink-0 lg:min-w-[200px]">
            <ScoreCard title="Confidence Score" value={props.confidenceScore} />
            <ScoreCard title="Energy Score" value={props.energyScore} />
          </div>
        </div>
        <div className="mt-5 w-full">
          <div className="text-xs text-slate-300 mb-2">Engagement Drops</div>
          <div className="relative w-full h-3 bg-white/10 rounded-full overflow-hidden">
            {props.engagementDrops.map((d, i) => {
              const t0 = Number(d.t0 || 0);
              const t1 = Number(d.t1 ?? d.t0 ?? 0);
              const left = (t0 / duration) * 100;
              const width = (Math.max(0.5, t1 - t0) / duration) * 100;
              return (
                <button
                  key={`${i}-${t0}`}
                  type="button"
                  className="absolute top-0 h-3 bg-red-500 rounded-full"
                  style={{ left: `${left}%`, width: `${Math.max(1, width)}%` }}
                  onClick={() => props.onSeek(t0)}
                  onMouseEnter={(e) =>
                    setHovered({
                      x: e.currentTarget.offsetLeft,
                      y: -30,
                      text: d.note ? `${d.note} at ${formatTime(t0)}` : `Low engagement at ${formatTime(t0)}`,
                    })
                  }
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
            {hovered ? (
              <div
                className="absolute z-20 pointer-events-none whitespace-nowrap rounded-md bg-slate-950/95 text-white text-[11px] border border-white/10 px-2 py-1 shadow-lg"
                style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}
              >
                {hovered.text}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

