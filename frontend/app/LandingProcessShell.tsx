"use client";

import dynamic from "next/dynamic";

const LazyHomeProcess = dynamic(() => import("./HomeProcessClient"), {
  ssr: false,
  loading: () => <HomeProcessSkeleton />,
});

function HomeProcessSkeleton() {
  return (
    <div className="mt-2 space-y-4" aria-hidden>
      <div className="h-48 rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 h-10 rounded-lg bg-white/5 animate-pulse" />
        <div className="w-full sm:w-36 h-10 rounded-lg bg-cyan-400/15 animate-pulse" />
      </div>
    </div>
  );
}

/** Client-only wrapper so `ssr: false` is allowed (lazy chunk for upload UI). */
export function LandingProcessShell() {
  return <LazyHomeProcess />;
}
