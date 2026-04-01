import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "AI Video Performance Analyzer",
  description: "Upload a video and get delivery insights.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">
        <nav className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-cyan-400 rounded-lg flex items-center justify-center text-slate-950 font-bold text-sm">
                ▶
              </div>
              <span className="font-bold text-lg tracking-tight">VideoAI</span>
            </div>
            <div className="flex items-center gap-1">
              <NavLink href="/" label="Process" icon="⬆" />
              <NavLink href="/dashboard" label="Dashboard" icon="📊" />
              <NavLink href="/comparison" label="Compare" icon="⚡" />
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}

function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-all"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

