export function Gauge(props: { value: number; label?: string }) {
  const value = Math.max(0, Math.min(100, props.value));
  const r = 56;
  const c = 2 * Math.PI * r;
  const start = c * 0.25; // show 3/4 ring
  const visible = c * 0.75;
  const filled = (visible * value) / 100;

  return (
    <div className="relative w-[160px] h-[120px]">
      <svg viewBox="0 0 160 120" className="w-full h-full">
        <g transform="translate(80,80) rotate(135)">
          <circle
            r={r}
            cx={0}
            cy={0}
            fill="transparent"
            stroke="rgba(15,23,42,0.08)"
            strokeWidth={12}
            strokeDasharray={`${visible} ${c - visible}`}
            strokeDashoffset={-start}
            strokeLinecap="round"
          />
          <circle
            r={r}
            cx={0}
            cy={0}
            fill="transparent"
            stroke="url(#grad)"
            strokeWidth={12}
            strokeDasharray={`${filled} ${c - filled}`}
            strokeDashoffset={-start}
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#EF4444" />
              <stop offset="50%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#16A34A" />
            </linearGradient>
          </defs>
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
        <div className="text-4xl font-semibold leading-none">{Math.round(value)}</div>
        <div className="text-xs text-muted mt-1">{props.label ?? "Score"}</div>
      </div>
    </div>
  );
}

