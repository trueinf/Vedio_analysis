"use client";

import { motion } from "framer-motion";

type DemoStep = {
  id: string;
  title: string;
  description: string;
};

export function DemoOverlay(props: {
  step: DemoStep;
  index: number;
  total: number;
  spotlight: { top: number; left: number; width: number; height: number } | null;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onExport: () => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  const s = props.spotlight;
  return (
    <div className="fixed inset-0 z-[60] pointer-events-none">
      <motion.div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
      />
      {s ? (
        <motion.div
          className="absolute rounded-2xl ring-2 ring-cyan-300/90 shadow-[0_0_24px_rgba(34,211,238,0.45),0_0_0_9999px_rgba(2,6,23,0.55)]"
          style={{ top: s.top - 8, left: s.left - 8, width: s.width + 16, height: s.height + 16 }}
          initial={{ opacity: 0.8, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      ) : null}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 w-[min(980px,92vw)] pointer-events-auto">
        <motion.div
          className="rounded-2xl border border-white/15 bg-slate-950/80 text-white px-6 py-5 shadow-2xl"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className="text-xs text-slate-300 uppercase tracking-[0.24em]">
            Demo Storyline {props.index + 1}/{props.total}
          </div>
          <div className="text-4xl md:text-5xl font-bold mt-1 tracking-tight">{props.step.title}</div>
          <div className="text-lg text-slate-300 mt-2 max-w-2xl leading-relaxed">{props.step.description}</div>
        </motion.div>
      </div>
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[min(980px,92vw)] pointer-events-auto">
        <motion.div
          className="rounded-2xl border border-white/15 bg-slate-950/85 text-white px-4 py-3 shadow-2xl"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
        >
          <div className="flex items-center justify-center gap-2 mb-2">
            {Array.from({ length: props.total }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === props.index ? "w-8 bg-cyan-300" : "w-3 bg-white/30"}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded-lg border border-white/20 disabled:opacity-40 hover:scale-105 transition-transform"
              onClick={props.onPrev}
              disabled={!props.canPrev}
            >
              Previous
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded-lg bg-cyan-400 text-slate-950 font-medium disabled:opacity-40 hover:scale-105 transition-transform"
              onClick={props.onNext}
              disabled={!props.canNext}
            >
              Next
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded-lg border border-white/20 hover:scale-105 transition-transform"
              onClick={props.onExport}
            >
              Export Screenshots
            </button>
            <button
              type="button"
              className="ml-auto px-3 py-1.5 text-sm rounded-lg border border-white/20 hover:scale-105 transition-transform"
              onClick={props.onSkip}
            >
              Skip Demo
            </button>
          </div>
          <div className="text-xs text-slate-400 mt-2">Use keyboard arrows: ← previous, → next, Esc to exit.</div>
        </motion.div>
      </div>
    </div>
  );
}

