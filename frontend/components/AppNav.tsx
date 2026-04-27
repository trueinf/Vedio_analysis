"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Process", icon: "⬆" },
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/history", label: "History", icon: "🕐" },
  { href: "/compare", label: "Compare", icon: "⚡" },
  { href: "/explain", label: "Explain", icon: "ℹ" },
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppNav() {
  const pathname = usePathname() || "";
  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-md">
      <div className="w-full max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-cyan-400 rounded-lg flex items-center justify-center text-slate-950 font-bold text-sm">
            ▶
          </div>
          <span className="font-bold text-lg tracking-tight">VideoAI</span>
        </div>
        <div className="flex items-center gap-1">
          {items.map(({ href, label, icon }) => {
            const active = isActive(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  active ? "text-white bg-white/15 border border-white/10" : "text-slate-300 hover:text-white hover:bg-white/10"
                }`}
              >
                <span>{icon}</span>
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
