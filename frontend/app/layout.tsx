import "./globals.css";

export const metadata = {
  title: "AI Video Performance Analyzer",
  description: "Upload a video and get delivery metrics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

