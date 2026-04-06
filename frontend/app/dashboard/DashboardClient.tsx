"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getApiBaseUrl } from "@/lib/api";
import type { ChannelSummary } from "@/lib/api";

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const s = parts[0] || "?";
  return s.slice(0, 2).toUpperCase();
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ")
    .trim();
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function DashboardClient() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [channels, setChannels] = useState<ChannelSummary[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const base = getApiBaseUrl();
        const res = await fetch(`${base}/api/channels/summary`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load channels (${res.status})`);
        const data = (await res.json()) as { channels: ChannelSummary[] };
        setChannels(data.channels || []);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load dashboard");
        setChannels([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const globals = useMemo(() => {
    const n = channels.length;
    const totalVideos = channels.reduce((s, c) => s + (c.totalVideos || 0), 0);
    const avgConf =
      n > 0 ? channels.reduce((s, c) => s + (c.avgConfidence || 0), 0) / n : 0;
    const avgEye =
      n > 0 ? channels.reduce((s, c) => s + (c.avgEyeContact || 0), 0) / n : 0;
    return {
      totalChannels: n,
      totalVideos,
      avgScore: Math.round(avgConf),
      avgEyePct: Math.round((avgEye > 1 ? avgEye / 100 : avgEye) * 100),
    };
  }, [channels]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold tracking-tight text-3xl">Dashboard</div>
          <div className="text-slate-300 text-sm">All channels at a glance</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Channels", value: globals.totalChannels },
          { label: "Total Analyses", value: globals.totalVideos },
          { label: "Avg Score", value: loading ? "—" : globals.avgScore },
          { label: "Avg Eye Contact", value: loading ? "—" : `${globals.avgEyePct}%` },
        ].map((x) => (
          <div key={x.label} className="bg-white/5 border border-white/10 backdrop-blur rounded-xl p-4">
            <div className="text-xs text-slate-400">{x.label}</div>
            <div className="mt-1 text-2xl font-semibold">
              {loading ? <span className="inline-block w-12 h-7 bg-white/10 rounded" /> : x.value}
            </div>
          </div>
        ))}
      </div>

      {err ? <div className="mt-4 text-sm text-red-400">{err}</div> : null}

      <div className="mt-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-72 bg-white/5 border border-white/10 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : channels.length === 0 ? (
          <div className="text-slate-300 text-sm bg-white/5 border border-white/10 rounded-2xl p-6">No channels yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {channels.map((ch) => {
              const hue = hashHue(ch.name);
              const href = `/history?channel=${encodeURIComponent(ch.name)}`;
              const processing = ch.processingCount > 0;
              const last = ch.lastAnalyzedAt || "";
              const thumb = ch.thumbnailUrl?.trim() || null;

              return (
                <Link
                  key={ch.id}
                  href={href}
                  className="group block text-left bg-white/5 border border-white/10 backdrop-blur rounded-2xl overflow-hidden hover:border-cyan-400/50 hover:bg-white/[0.07] transition-all"
                >
                  <div
                    className="relative h-28 border-b border-white/10 overflow-hidden"
                    style={
                      thumb
                        ? {
                            backgroundImage: `linear-gradient(rgba(15,23,42,0.6), rgba(15,23,42,0.85)), url(${JSON.stringify(thumb)})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : { background: `linear-gradient(135deg, hsl(${hue} 35% 22%), hsl(${hue} 25% 12%))` }
                    }
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-lg border border-white/20"
                        style={{ backgroundColor: `hsl(${hue} 45% 42%)` }}
                      >
                        {initials(ch.name)}
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{titleCase(ch.name)}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {ch.totalVideos} video{ch.totalVideos === 1 ? "" : "s"} · Last: {formatRelative(last)}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-[11px] px-2 py-1 rounded-lg border ${
                          processing
                            ? "text-amber-200 bg-amber-400/15 border-amber-400/30"
                            : "text-emerald-200 bg-emerald-400/10 border-emerald-400/25"
                        }`}
                      >
                        {processing ? `${ch.processingCount} processing` : "Active"}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                        <div className="text-[10px] text-slate-400">Conf.</div>
                        <div className="text-sm font-semibold">{ch.avgConfidence.toFixed(1)}</div>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                        <div className="text-[10px] text-slate-400">Energy</div>
                        <div className="text-sm font-semibold">{ch.avgEnergy.toFixed(1)}</div>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                        <div className="text-[10px] text-slate-400">Videos</div>
                        <div className="text-sm font-semibold">{ch.totalVideos}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span className="truncate">{last ? new Date(last).toLocaleString() : "—"}</span>
                      <span className="text-cyan-300 group-hover:text-cyan-200 whitespace-nowrap">View channel →</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
