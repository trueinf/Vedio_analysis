"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

export type DarkSelectOption = { value: string; label: string };

/** Custom listbox with dark panel styling (native select option lists are OS-drawn and often unreadable on dark pages). */
export default function DarkSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: DarkSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  buttonClassName?: string;
}) {
  const {
    value,
    onChange,
    options,
    disabled,
    placeholder = "Select…",
    emptyLabel = "No options",
    className,
    buttonClassName,
  } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const hasOptions = options.length > 0;

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <button
        type="button"
        disabled={disabled || !hasOptions}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && hasOptions && setOpen((o) => !o)}
        className={clsx(
          "w-full text-left text-sm border border-white/15 bg-white/5 rounded-xl px-3 py-2.5 text-white",
          "flex items-center justify-between gap-2 min-h-[42px]",
          (!hasOptions || disabled) && "opacity-60 cursor-not-allowed",
          buttonClassName
        )}
      >
        <span className="truncate">
          {!hasOptions ? emptyLabel : selected?.label ?? placeholder}
        </span>
        <span className="text-slate-400 shrink-0 text-[10px] leading-none" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && hasOptions ? (
        <ul
          role="listbox"
          className="absolute z-[100] mt-1 max-h-60 w-full overflow-auto rounded-xl border border-white/15 bg-slate-950 shadow-2xl py-1 text-sm text-slate-100 ring-1 ring-white/10"
        >
          {options.map((o) => (
            <li key={o.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={clsx(
                  "w-full px-3 py-2.5 text-left text-slate-100 transition-colors",
                  o.value === value ? "bg-cyan-500/20 text-cyan-50" : "hover:bg-white/10"
                )}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
