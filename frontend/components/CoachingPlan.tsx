"use client";

import { Card, premiumSurfaceClass } from "./ui";

type Priority = {
  metric: string;
  title: string;
  impact?: string;
  why_now?: string;
};

export function CoachingPlan(props: { priorities: Priority[] }) {
  const focus = props.priorities.slice(0, 3).map((p) => p.title);
  const daily = [
    "Practice one minute without filler words.",
    "Keep camera-level gaze during sentence endings.",
    "Rehearse key lines with expressive tone.",
  ];
  const during = [
    "Pause instead of saying fillers.",
    "Use one intentional gesture per key idea.",
    "Re-anchor eye contact before important points.",
  ];
  const before = [
    "Place notes close to camera lens.",
    "Mark 3 emphasis points in your script.",
    "Check framing so hands and face are visible.",
  ];
  return (
    <Card className={`col-span-12 p-4 rounded-xl ${premiumSurfaceClass}`}>
      <div className="text-sm font-semibold">Your Coaching Plan</div>
      {focus.length ? (
        <div className="mt-2 text-xs text-slate-300">
          Focus today: <span className="text-slate-100">{focus.join(", ")}</span>
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="text-xs font-semibold text-cyan-200">Daily Practice</div>
          <ul className="mt-2 list-disc pl-4 text-xs text-slate-300 space-y-1">
            {daily.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="text-xs font-semibold text-cyan-200">During Recording</div>
          <ul className="mt-2 list-disc pl-4 text-xs text-slate-300 space-y-1">
            {during.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="text-xs font-semibold text-cyan-200">Before Recording</div>
          <ul className="mt-2 list-disc pl-4 text-xs text-slate-300 space-y-1">
            {before.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

