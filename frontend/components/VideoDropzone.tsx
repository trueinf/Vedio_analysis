"use client";

import { useRef, useState } from "react";

export function VideoDropzone(props: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  title?: string;
  subtitle?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("video/"));
    props.onFilesChange(dropped);
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
        dragOver ? "border-cyan-400 bg-cyan-400/10" : "border-white/20 hover:border-white/40 hover:bg-white/5"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => props.onFilesChange(Array.from(e.target.files || []))}
      />
      <div className="text-5xl mb-4">🎬</div>
      <div className="text-lg font-medium">{props.title || "Drop videos here or click to browse"}</div>
      <div className="text-slate-400 text-sm mt-1">{props.subtitle || "Supports MP4, MOV, AVI, WebM · Up to 3 hours · No file limit"}</div>
      {props.files.length > 0 ? (
        <div className="mt-4 text-cyan-400 font-medium break-words">
          {props.files.length} file(s) selected: {props.files.map((f) => f.name).join(", ")}
        </div>
      ) : null}
    </div>
  );
}

