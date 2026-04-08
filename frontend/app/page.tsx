import { LandingProcessShell } from "./LandingProcessShell";

/** Server-rendered shell for instant headline; upload UI loads in a lazy client chunk. */
export default function HomePage() {
  return (
    <div className="w-full max-w-[100rem] mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Process Video</h1>
        <p className="text-slate-400 mt-1">Upload videos for AI-powered delivery analysis</p>
      </div>
      <LandingProcessShell />
    </div>
  );
}
