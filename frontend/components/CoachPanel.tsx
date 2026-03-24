"use client";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CoachPanel(props: {
  comments: { t0: number; comment: string }[];
  onClickComment: (t0: number) => void;
}) {
  return (
    <div>
      <div className="text-sm font-semibold mb-2">💡 AI Coach Comments</div>
      <div className="space-y-2 max-h-[200px] overflow-auto">
        {props.comments.length ? (
          props.comments.map((cc, i) => (
            <button
              key={`${i}-${cc.t0}`}
              type="button"
              className="w-full text-left border border-black/10 rounded-lg px-3 py-2 hover:bg-slate-50"
              onClick={() => props.onClickComment(Number(cc.t0 || 0))}
            >
              <div className="text-xs font-semibold">{formatTime(Number(cc.t0 || 0))}</div>
              <div className="text-[11px] text-muted">{cc.comment}</div>
            </button>
          ))
        ) : (
          <div className="text-xs text-muted">No comments available.</div>
        )}
      </div>
    </div>
  );
}

