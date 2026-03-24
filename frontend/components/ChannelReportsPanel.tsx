"use client";

import { ChannelCollection, ChannelItem } from "../lib/api";
import { Card, PremiumActionButton, PremiumChip, PremiumField, premiumSurfaceClass } from "./ui";

export function ChannelReportsPanel(props: {
  channelSearch: string;
  onChannelSearchChange: (v: string) => void;
  channelViewMode: "latest" | "all";
  onChannelViewModeChange: (v: "latest" | "all") => void;
  visibleChannels: ChannelItem[];
  selectedChannelId: string;
  onSelectChannel: (channelId: string, channelName: string) => void;
  renameDraft: string;
  onRenameDraftChange: (v: string) => void;
  channelCollections: Record<string, ChannelCollection[]>;
  onRenameChannel: (channelId: string) => Promise<void>;
  onDeleteChannel: (channelId: string) => Promise<void>;
  onSelectCollection: (collectionId: string) => Promise<void>;
}) {
  return (
    <Card className={`col-span-12 lg:col-span-3 lg:row-span-2 p-4 h-full lg:ml-2 ${premiumSurfaceClass}`}>
      <div className="text-sm font-semibold">Channel Reports</div>
      <div className="text-xs text-slate-300 mt-1">Stored analyses by channel</div>
      <div className="mt-3 flex items-center gap-2">
        <PremiumField value={props.channelSearch} onChange={props.onChannelSearchChange} placeholder="Search channels" />
      </div>
      <div className="mt-2 flex gap-2 text-xs">
        <PremiumChip active={props.channelViewMode === "latest"} onClick={() => props.onChannelViewModeChange("latest")}>
          Latest
        </PremiumChip>
        <PremiumChip active={props.channelViewMode === "all"} onClick={() => props.onChannelViewModeChange("all")}>
          All-time
        </PremiumChip>
      </div>
      <div className="mt-3 space-y-2 max-h-[520px] overflow-auto pr-1">
        {props.visibleChannels.length ? (
          props.visibleChannels.map((ch) => (
            <div key={ch.id} className="border border-white/10 rounded-md bg-white/5">
              <button
                type="button"
                className={`w-full text-left px-3 py-2 text-xs ${props.selectedChannelId === ch.id ? "bg-cyan-500/15" : ""}`}
                onClick={() => props.onSelectChannel(ch.id, ch.name)}
              >
                <div className="font-medium truncate">{ch.name}</div>
                <div className="text-slate-300">
                  {ch.collections} collections · {ch.videos} videos
                </div>
              </button>
              {props.selectedChannelId === ch.id ? (
                <div className="px-3 pb-2">
                  <div className="mt-1 flex items-center gap-1">
                    <PremiumField
                      value={props.renameDraft}
                      onChange={props.onRenameDraftChange}
                      placeholder="Rename channel"
                      className="text-[11px] min-w-0"
                    />
                    <PremiumActionButton onClick={() => props.onRenameChannel(ch.id)}>Save</PremiumActionButton>
                    <PremiumActionButton tone="danger" onClick={() => props.onDeleteChannel(ch.id)}>
                      Delete
                    </PremiumActionButton>
                  </div>
                  <div className="text-[11px] text-muted mb-1 mt-2">Collections</div>
                  <div className="space-y-1 max-h-28 overflow-auto">
                    {(props.channelViewMode === "latest"
                      ? (props.channelCollections[ch.id] || []).slice(0, 1)
                      : props.channelCollections[ch.id] || []
                    ).map((c) => (
                      <PremiumActionButton
                        key={c.collection_id}
                        className="w-full text-left border-white/10"
                        onClick={() => props.onSelectCollection(c.collection_id)}
                      >
                        <div className="font-medium truncate">{c.title || c.collection_id}</div>
                        <div className="text-slate-300">
                          {c.completed_videos}/{c.total_videos} completed
                        </div>
                      </PremiumActionButton>
                    ))}
                    {!(props.channelCollections[ch.id] || []).length ? (
                      <div className="text-[11px] text-muted">No collections yet.</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="text-xs text-muted">No channel reports found.</div>
        )}
      </div>
    </Card>
  );
}

