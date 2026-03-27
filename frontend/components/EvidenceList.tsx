"use client";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export type EvidenceItem = {
  start: number;
  end: number;
  description: string;
  impact?: string;
  why_problem?: string;
};

export function EvidenceList(props: { items: EvidenceItem[]; onSeek: (start: number, end?: number) => void }) {
  return (
    <div className="space-y-2">
      {props.items.slice(0, 3).map((e, i) => (
        <button
          key={`${i}-${e.start}`}
          type="button"
          className="w-full text-left rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10 transition"
          onClick={() => props.onSeek(Number(e.start || 0), Number(e.end || e.start || 0))}
        >
          <div className="text-xs font-semibold text-cyan-200">
            {formatTime(Number(e.start || 0))} - {formatTime(Number(e.end || e.start || 0))}
          </div>
          <div className="text-xs text-slate-100 mt-1">{e.description}</div>
          {e.why_problem ? <div className="text-[11px] text-slate-300 mt-1">{e.why_problem}</div> : null}
        </button>
      ))}
    </div>
  );
}

