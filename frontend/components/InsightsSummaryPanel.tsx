"use client";

import { Gauge } from "./gauge";
import { Card, premiumSurfaceClass } from "./ui";

export function InsightsSummaryPanel(props: {
  show: boolean;
  score: number;
  warnings: string[];
  tips: string[];
  suggestions: string[];
}) {
  return (
    <div
      id="demo-solution"
      className={`col-span-12 lg:col-span-3 grid gap-5 h-full auto-rows-fr ${props.show ? "" : "hidden"}`}
    >
      <Card className={`p-4 h-full ${premiumSurfaceClass}`}>
        <div className="text-sm font-semibold">Overall Score</div>
        <div className="mt-2 flex items-center justify-between">
          <Gauge value={props.score} label="Good" />
          <div className="ml-2 flex-1">
            {props.warnings?.length ? (
              <div className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {props.warnings[0]}
              </div>
            ) : null}
            <div className="text-sm font-semibold mb-2">Key Improvement Tips</div>
            <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1">
              {props.tips.slice(0, 4).map((t: string, i: number) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card className={`p-4 h-full ${premiumSurfaceClass}`}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">AI Feedback</div>
          <div className="text-xs text-slate-300">Suggestions</div>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          {props.suggestions.slice(0, 3).map((s: string, i: number) => (
            <div key={i} className="flex gap-2">
              <div className="mt-1 w-2 h-2 rounded-full bg-primary" />
              <div className="text-slate-300">{s}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

