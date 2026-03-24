"use client";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function WorstMomentsPanel(props: {
  moments: { t0: number; t1: number; reason: string }[];
  activeT0?: number;
  onClose: () => void;
  onClickMoment: (t0: number, t1: number, reason: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">⚠️ Worst Moments</div>
        <button type="button" className="text-xs text-muted hover:text-ink" onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className="text-xs text-muted mb-2">⏱ Top 5 negative moments</div>
      <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
        {props.moments.length ? (
          props.moments.map((wm, i) => {
            const isActive = Number(props.activeT0 ?? -1) === Number(wm.t0 || 0);
            return (
              <button
                key={`${i}-${wm.t0}`}
                type="button"
                className={`w-full text-left border rounded-lg px-3 py-2 transition ${
                  isActive ? "border-blue-300 bg-blue-50 shadow-sm" : "border-black/10 hover:bg-slate-50"
                }`}
                onClick={() => props.onClickMoment(wm.t0, wm.t1, wm.reason)}
              >
                <div className="text-xs font-semibold">
                  {formatTime(Number(wm.t0 || 0))} - {formatTime(Number(wm.t1 || wm.t0 || 0))}
                </div>
                <div className="text-[11px] text-muted mt-0.5">{wm.reason}</div>
              </button>
            );
          })
        ) : (
          <div className="text-xs text-muted">No moments available.</div>
        )}
      </div>
    </div>
  );
}

