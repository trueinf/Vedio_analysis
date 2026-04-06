"use client";

export function StatsBar(props: {
  total: number;
  avgScore: number;
  avgWpm: number;
  avgEyeContact: number;
  loading?: boolean;
  error?: string;
}) {
  const loading = Boolean(props.loading);
  const err = props.error || "";
  const scoreDisplay = (() => {
    const v = Number(props.avgScore);
    if (!Number.isFinite(v) || v <= 0) return "—";
    return String(Math.round(v));
  })();
  const wpmDisplay = (() => {
    const v = Number(props.avgWpm);
    if (!Number.isFinite(v) || v <= 0) return "—";
    return String(Math.round(v));
  })();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[
        { label: "Total Analyses", value: props.total },
        { label: "Avg Score", value: scoreDisplay },
        { label: "Avg WPM", value: wpmDisplay },
        { label: "Avg Eye Contact", value: `${Math.round((props.avgEyeContact || 0) * 100)}%` },
      ].map((x) => (
        <div key={x.label} className="bg-white/5 border border-white/10 backdrop-blur rounded-xl p-4">
          <div className="text-xs text-slate-400">{x.label}</div>
          <div className="mt-1 text-2xl font-semibold">
            {loading ? <span className="inline-block w-16 h-6 bg-white/10 rounded" /> : x.value}
          </div>
          {err ? <div className="mt-1 text-xs text-red-400 truncate">{err}</div> : null}
        </div>
      ))}
    </div>
  );
}

