import "./globals.css";
import AppNav from "@/components/AppNav";

export const metadata = {
  title: "AI Video Performance Analyzer",
  description: "Upload a video and get delivery insights.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">
        <AppNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
