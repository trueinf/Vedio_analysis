"use client";

import { Card, premiumSurfaceClass } from "./ui";

export type PriorityItem = {
  metric: string;
  title: string;
  impact?: string;
  why_now?: string;
};

export function PriorityList(props: { items: PriorityItem[] }) {
  if (!props.items.length) return null;
  return (
    <Card className={`p-4 rounded-xl ${premiumSurfaceClass}`}>
      <div className="text-sm font-semibold">🔥 What to Fix First</div>
      <div className="mt-3 space-y-2">
        {props.items.slice(0, 3).map((p, i) => (
          <div key={`${p.metric}-${i}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-sm font-medium text-slate-100">
              {i + 1}. {p.title}
            </div>
            {p.why_now ? <div className="text-xs text-slate-300 mt-1">{p.why_now}</div> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

