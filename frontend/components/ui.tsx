import { clsx } from "clsx";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function Card(props: ComponentPropsWithoutRef<"div"> & { children: ReactNode }) {
  const { className, children, ...rest } = props;
  return (
    <div {...rest} className={clsx("bg-card rounded-xl2 shadow-soft border border-black/5", className)}>
      {children}
    </div>
  );
}

export function Button(props: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "premium" | "premium-ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const v = props.variant ?? "primary";
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={clsx(
        "px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed",
        v === "primary"
          ? "bg-primary text-white hover:bg-blue-700"
          : v === "ghost"
          ? "bg-transparent hover:bg-black/5 text-ink"
          : v === "premium"
          ? "bg-cyan-400 text-slate-950 hover:bg-cyan-300 shadow-[0_8px_24px_rgba(34,211,238,0.25)]"
          : "border border-white/15 bg-white/5 hover:bg-white/10 text-white",
        props.className
      )}
    >
      {props.children}
    </button>
  );
}

export const premiumInputClass =
  "text-sm border border-white/15 bg-white/5 rounded-md px-2 py-1 text-white placeholder:text-slate-400";

export const premiumSurfaceClass = "bg-white/5 border border-white/10 backdrop-blur text-white";

export function PremiumField(props: {
  className?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: "text" | "search";
}) {
  return (
    <input
      type={props.type ?? "text"}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className={clsx(premiumInputClass, props.className)}
    />
  );
}

export function PremiumChip(props: {
  className?: string;
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "px-2 py-1 rounded border text-xs transition",
        props.active ? "bg-cyan-500/20 border-cyan-300/60 text-cyan-200" : "border-white/15 text-slate-300 hover:bg-white/10",
        props.className
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function PremiumActionButton(props: {
  className?: string;
  tone?: "default" | "danger";
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "text-[11px] px-2 py-1 rounded border shrink-0 transition",
        props.tone === "danger"
          ? "border-red-300/50 text-red-200 hover:bg-red-500/20"
          : "border-white/15 text-slate-200 hover:bg-white/10",
        props.className
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

