"use client";

import { useEffect } from "react";
import type { MetricDetailPayload } from "./metricDetailContent";
import { Button } from "./ui";

export function MetricDetailModal(props: {
  open: boolean;
  onClose: () => void;
  detail: MetricDetailPayload | null;
  onApplyToTimeline?: () => void;
}) {
  const { open, onClose, detail, onApplyToTimeline } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !detail) return null;

  const d = detail;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-detail-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close details"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-2xl max-h-[88vh] sm:max-h-[92vh] overflow-hidden rounded-t-2xl sm:rounded-2xl border border-white/15 bg-slate-900/95 text-white shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-white/10 shrink-0">
          <div>
            <h2 id="metric-detail-title" className="text-lg font-semibold tracking-tight">
              {d.title}
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">{d.subtitle}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white text-xl leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4 flex-1">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">Your result</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-semibold">{d.valueLine}</span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-200 border border-cyan-400/30">
                {d.badgeText}
              </span>
            </div>
          </div>

          {d.statsRows.length ? (
            <section>
              <h3 className="text-sm font-semibold text-slate-200">Supporting data</h3>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {d.statsRows.map((row, i) => (
                  <div key={i} className="flex flex-col sm:flex-row sm:justify-between gap-0.5 border-b border-white/5 pb-2 sm:border-0 sm:pb-0">
                    <span className="text-slate-400 shrink-0">{row.label}</span>
                    <span className="text-slate-100 text-right sm:text-left sm:max-w-[60%] break-words">{row.value}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {d.detailSections.length
            ? d.detailSections.map((sec, si) => (
                <section key={si}>
                  <h3 className="text-sm font-semibold text-slate-200">{sec.title}</h3>
                  <ul className="mt-1 text-sm text-slate-300 list-disc pl-5 space-y-1">
                    {sec.items.map((item, ii) => (
                      <li key={ii} className="break-words">
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            : null}

          <section>
            <h3 className="text-sm font-semibold text-slate-200">What this means</h3>
            <p className="text-sm text-slate-300 mt-1 leading-relaxed">{d.interpretation}</p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-200">How we label it</h3>
            <p className="text-sm text-slate-300 mt-1 leading-relaxed">{d.targetRange}</p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-200">How it&apos;s measured</h3>
            <p className="text-sm text-slate-300 mt-1 leading-relaxed">{d.howMeasured}</p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-200">On your timeline</h3>
            <ul className="mt-1 max-h-44 overflow-y-auto text-sm text-slate-300 list-disc pl-5 space-y-1 pr-1">
              {d.timelineLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-200">Suggestions</h3>
            <ul className="mt-1 text-sm text-slate-300 list-disc pl-5 space-y-1">
              {d.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>
        </div>

        <div className="p-4 border-t border-white/10 flex flex-col sm:flex-row gap-2 shrink-0 bg-slate-900/80">
          {onApplyToTimeline ? (
            <Button variant="premium" className="flex-1" type="button" onClick={onApplyToTimeline}>
              Show on timeline
            </Button>
          ) : null}
          <Button variant="premium-ghost" className="flex-1" type="button" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
