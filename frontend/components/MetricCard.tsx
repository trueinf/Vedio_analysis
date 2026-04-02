"use client";

import clsx from "clsx";

type Tone = "good" | "moderate" | "poor" | "neutral";

function toneStyles(tone: Tone) {
  if (tone === "good") return "bg-emerald-400/10 border-emerald-400/20 text-emerald-200";
  if (tone === "moderate") return "bg-amber-400/10 border-amber-400/20 text-amber-200";
  if (tone === "poor") return "bg-red-400/10 border-red-400/20 text-red-200";
  return "bg-white/5 border-white/10 text-slate-200";
}

export default function MetricCard(props: {
  title: string;
  value: string;
  label: string;
  tone: Tone;
  description?: string;
  onClick?: () => void;
}) {
  const Comp: any = props.onClick ? "button" : "div";
  return (
    <Comp
      type={props.onClick ? "button" : undefined}
      onClick={props.onClick}
      className={clsx(
        "w-full text-left p-4 rounded-2xl border backdrop-blur bg-white/5 transition hover:bg-white/7",
        toneStyles(props.tone),
        props.onClick ? "cursor-pointer hover:shadow-md" : ""
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400">{props.title}</div>
          <div className="mt-1 text-3xl font-bold">{props.value}</div>
        </div>
        <div className="text-xs px-3 py-1 rounded-xl border border-black/10 bg-black/10 shrink-0">{props.label}</div>
      </div>
      {props.description ? <div className="mt-3 text-xs text-slate-300 leading-relaxed">{props.description}</div> : null}
    </Comp>
  );
}

