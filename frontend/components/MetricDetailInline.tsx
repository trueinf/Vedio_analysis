"use client";

import type { MetricDetailPayload } from "./metricDetailContent";

export function MetricDetailInline(props: {
  detail: MetricDetailPayload;
  resultLabel?: string;
  benchmarkMode?: boolean;
}) {
  const { detail: d, resultLabel, benchmarkMode } = props;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-tight">{d.title}</div>
          <div className="text-sm text-slate-400 mt-0.5">{d.subtitle}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-xs uppercase tracking-wide text-slate-400">
          {resultLabel || (benchmarkMode ? "Typical for this channel" : "Your result")}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-semibold">{d.valueLine}</span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-200 border border-cyan-400/30">
            {d.badgeText}
          </span>
        </div>
      </div>

      {d.statsRows.length ? (
        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-200">Supporting data</h3>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {d.statsRows.map((row, i) => (
              <div
                key={i}
                className="flex flex-col sm:flex-row sm:justify-between gap-0.5 border-b border-white/5 pb-2 sm:border-0 sm:pb-0"
              >
                <span className="text-slate-400 shrink-0">{row.label}</span>
                <span className="text-slate-100 text-right sm:text-left sm:max-w-[60%] break-words">{row.value}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {d.detailSections.length
        ? d.detailSections.map((sec, si) => (
            <section key={si} className="mt-4">
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

      <section className="mt-4">
        <h3 className="text-sm font-semibold text-slate-200">What this means</h3>
        <p className="text-sm text-slate-300 mt-1 leading-relaxed">{d.interpretation}</p>
      </section>

      <section className="mt-4">
        <h3 className="text-sm font-semibold text-slate-200">{benchmarkMode ? "How to read this" : "How we label it"}</h3>
        <p className="text-sm text-slate-300 mt-1 leading-relaxed">{d.targetRange}</p>
      </section>

      <section className="mt-4">
        <h3 className="text-sm font-semibold text-slate-200">{benchmarkMode ? "Where this comes from" : "How it&apos;s measured"}</h3>
        <p className="text-sm text-slate-300 mt-1 leading-relaxed">{d.howMeasured}</p>
      </section>

      <section className="mt-4">
        <h3 className="text-sm font-semibold text-slate-200">{benchmarkMode ? "Scope" : "On your timeline"}</h3>
        <ul className="mt-1 text-sm text-slate-300 list-disc pl-5 space-y-1">
          {d.timelineLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

