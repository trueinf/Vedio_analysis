"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteChannel, deleteChannelByName, fetchChannelsSummary, updateChannelName } from "@/lib/api";
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

function TrashIcon(props: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

function PencilIcon(props: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

export default function DashboardClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [showEmptyChannels, setShowEmptyChannels] = useState(false);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [nameEditError, setNameEditError] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const nameErrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const data = await fetchChannelsSummary();
        setChannels(data.channels || []);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load dashboard");
        setChannels([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (nameErrTimerRef.current) clearTimeout(nameErrTimerRef.current);
    };
  }, []);

  const visibleChannels = useMemo(() => {
    if (showEmptyChannels) return channels;
    return channels.filter((c) => (c.totalVideos || 0) > 0);
  }, [channels, showEmptyChannels]);

  const goToChannel = (channelName: string) => {
    if (editingId) return;
    router.push(`/channel/${encodeURIComponent(channelName)}`);
  };

  function showNameError(msg: string) {
    if (nameErrTimerRef.current) clearTimeout(nameErrTimerRef.current);
    setNameEditError(msg);
    nameErrTimerRef.current = setTimeout(() => {
      setNameEditError("");
      nameErrTimerRef.current = null;
    }, 3000);
  }

  async function commitRename(ch: ChannelSummary) {
    const next = editDraft.trim();
    if (next === ch.name) {
      setEditingId(null);
      setNameEditError("");
      return;
    }
    if (!next) {
      showNameError("Name can't be empty");
      return;
    }
    setRenamingId(ch.id);
    setNameEditError("");
    const prevName = ch.name;
    setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, name: next } : c)));
    setEditingId(null);
    try {
      const out = await updateChannelName(ch.id, next);
      setChannels((prev) => prev.map((c) => (c.id === out.channel.id ? { ...c, name: out.channel.name } : c)));
    } catch (e: unknown) {
      setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, name: prevName } : c)));
      setEditingId(ch.id);
      setEditDraft(next);
      showNameError(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setRenamingId(null);
    }
  }

  function cancelRename() {
    setEditingId(null);
    setEditDraft("");
    setNameEditError("");
    if (nameErrTimerRef.current) {
      clearTimeout(nameErrTimerRef.current);
      nameErrTimerRef.current = null;
    }
  }

  const globals = useMemo(() => {
    const list = visibleChannels;
    const n = list.length;
    const totalVideos = list.reduce((s, c) => s + (c.totalVideos || 0), 0);
    const avgConf = n > 0 ? list.reduce((s, c) => s + (c.avgConfidence || 0), 0) / n : 0;
    const avgEye = n > 0 ? list.reduce((s, c) => s + (c.avgEyeContact || 0), 0) / n : 0;
    return {
      totalChannels: n,
      totalVideos,
      avgScore: Math.round(avgConf),
      avgEyePct: Math.round((avgEye > 1 ? avgEye / 100 : avgEye) * 100),
    };
  }, [visibleChannels]);

  async function handleDeleteChannel(e: React.MouseEvent, ch: ChannelSummary) {
    e.preventDefault();
    e.stopPropagation();
    const isSupabaseOnly = String(ch.id || "").startsWith("supabase:");
    const ok = window.confirm(
      isSupabaseOnly
        ? `Delete ${ch.name}? This will permanently delete its analyses from Supabase.`
        : `Delete ${ch.name}? This won't delete existing analysis reports.`
    );
    if (!ok) return;
    setDeletingId(ch.id);
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[ch.id];
      return next;
    });
    try {
      if (isSupabaseOnly) {
        await deleteChannelByName(ch.name);
      } else {
        await deleteChannel(ch.id);
      }
      setChannels((prev) => prev.filter((c) => c.id !== ch.id));
    } catch (e: any) {
      setCardErrors((prev) => ({ ...prev, [ch.id]: e?.message ?? "Delete failed" }));
    } finally {
      setDeletingId(null);
    }
  }

  const hiddenEmptyCount = channels.filter((c) => (c.totalVideos || 0) === 0).length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="font-semibold tracking-tight text-3xl">Dashboard</div>
          <div className="text-slate-300 text-sm">All channels at a glance</div>
        </div>
        {channels.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={showEmptyChannels}
              onChange={(e) => setShowEmptyChannels(e.target.checked)}
              className="rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-400/40"
            />
            Show channels with no videos
            {hiddenEmptyCount > 0 && !showEmptyChannels ? (
              <span className="text-slate-500">({hiddenEmptyCount} hidden)</span>
            ) : null}
          </label>
        ) : null}
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
        ) : visibleChannels.length === 0 ? (
          <div className="text-slate-300 text-sm bg-white/5 border border-white/10 rounded-2xl p-6">
            No channels with uploaded analyses. Enable &quot;Show channels with no videos&quot; to see empty channels.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleChannels.map((ch) => {
              const hue = hashHue(ch.name);
              const last = ch.lastAnalyzedAt || "";
              const thumb = ch.thumbnailUrl?.trim() || null;
              const cardErr = cardErrors[ch.id];
              const readOnly = String(ch.id || "").startsWith("supabase:");

              return (
                <div
                  key={ch.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => goToChannel(ch.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      goToChannel(ch.name);
                    }
                  }}
                  className="group relative block cursor-pointer text-left bg-white/5 border border-white/10 backdrop-blur rounded-2xl overflow-hidden hover:border-cyan-400/50 hover:bg-white/[0.07] transition-all outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                >
                  {!readOnly ? (
                    <button
                      type="button"
                      title="Rename channel"
                      aria-label="Rename channel"
                      disabled={renamingId === ch.id || deletingId === ch.id}
                      className="absolute top-2 left-2 z-20 p-1.5 rounded-md text-slate-200 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditingId(ch.id);
                        setEditDraft(ch.name);
                        setNameEditError("");
                      }}
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                  ) : null}

                  <button
                    type="button"
                    title={readOnly ? "Delete Supabase analyses" : "Delete channel"}
                    aria-label="Delete channel"
                    disabled={deletingId === ch.id}
                    className="absolute top-2 right-2 z-20 p-1.5 rounded-md text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
                    onClick={(e) => void handleDeleteChannel(e, ch)}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>

                  <div className="relative h-28 border-b border-white/10 overflow-hidden">
                    {thumb && !thumbFailed[ch.id] ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={() => setThumbFailed((prev) => ({ ...prev, [ch.id]: true }))}
                        />
                        <div
                          className="absolute inset-0 z-[1]"
                          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
                          aria-hidden
                        />
                      </>
                    ) : (
                      <div
                        className="absolute inset-0"
                        style={{ background: `linear-gradient(135deg, hsl(${hue} 35% 22%), hsl(${hue} 25% 12%))` }}
                      />
                    )}
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-lg border border-white/20"
                        style={{ backgroundColor: `hsl(${hue} 45% 42%)` }}
                      >
                        {initials(ch.name)}
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {editingId === ch.id ? (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                            className="space-y-1"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <input
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                disabled={renamingId === ch.id}
                                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm font-semibold text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void commitRename(ch);
                                  }
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelRename();
                                  }
                                }}
                              />
                              <button
                                type="button"
                                title="Save"
                                className="shrink-0 rounded-md px-2 py-1 text-sm text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-40"
                                disabled={renamingId === ch.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void commitRename(ch);
                                }}
                              >
                                ✓
                              </button>
                              <button
                                type="button"
                                title="Cancel"
                                className="shrink-0 rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-white/10 disabled:opacity-40"
                                disabled={renamingId === ch.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelRename();
                                }}
                              >
                                ✗
                              </button>
                            </div>
                            {editingId === ch.id && nameEditError ? (
                              <div className="text-xs text-red-400">{nameEditError}</div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="text-sm font-semibold truncate">{titleCase(ch.name)}</div>
                        )}
                        <div className="mt-1 text-xs text-slate-400">
                          {ch.totalVideos} video{ch.totalVideos === 1 ? "" : "s"} · Last: {formatRelative(last)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                        <div className="text-[10px] text-slate-400">Conf.</div>
                        <div className="text-sm font-semibold">{Math.round(ch.avgConfidence)}</div>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                        <div className="text-[10px] text-slate-400">Energy</div>
                        <div className="text-sm font-semibold">{Math.round(ch.avgEnergy)}</div>
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

                    {cardErr ? <div className="mt-2 text-xs text-red-400">{cardErr}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
