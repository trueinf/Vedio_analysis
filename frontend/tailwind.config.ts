import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F4F7FB",
        card: "#FFFFFF",
        ink: "#0F172A",
        muted: "#64748B",
        primary: "#2563EB",
        good: "#16A34A",
        warn: "#F59E0B",
        bad: "#EF4444",
      },
      boxShadow: {
        soft: "0 10px 30px rgba(15, 23, 42, 0.08)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
} satisfies Config;

