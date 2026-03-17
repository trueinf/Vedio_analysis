import { clsx } from "clsx";

export function Card(props: { className?: string; children: React.ReactNode }) {
  return (
    <div className={clsx("bg-card rounded-xl2 shadow-soft border border-black/5", props.className)}>
      {props.children}
    </div>
  );
}

export function Button(props: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
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
          : "bg-transparent hover:bg-black/5 text-ink",
        props.className
      )}
    >
      {props.children}
    </button>
  );
}

