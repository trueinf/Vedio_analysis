"use client";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function BestMomentsPanel(props: {
  moments: { t0: number; t1: number; note?: string }[];
  onClickMoment: (t0: number, t1: number) => void;
}) {
  return (
    <div>
      <div className="text-sm font-semibold mb-2">🔥 Best Moments</div>
      <div className="space-y-2 max-h-[160px] overflow-auto">
        {props.moments.length ? (
          props.moments.map((m, i) => (
            <button
              key={`${i}-${m.t0}`}
              type="button"
              className="w-full text-left border border-white/10 rounded-lg px-3 py-2 hover:bg-white/10"
              onClick={() => props.onClickMoment(Number(m.t0 || 0), Number(m.t1 || m.t0 || 0))}
            >
              <div className="text-xs font-semibold">
                {formatTime(Number(m.t0 || 0))} - {formatTime(Number(m.t1 || m.t0 || 0))}
              </div>
              <div className="text-[11px] text-slate-300">{m.note || "Strong delivery with high engagement"}</div>
            </button>
          ))
        ) : (
          <div className="text-xs text-slate-300">No strong moments detected yet.</div>
        )}
      </div>
    </div>
  );
}

