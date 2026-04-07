import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp.highlight;
  const first = Array.isArray(raw) ? raw[0] : raw;
  const hasHighlight = first !== undefined && first !== null && String(first).length > 0;
  if (hasHighlight) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => q.append(k, String(x)));
      else q.set(k, String(v));
    }
    redirect(`/history?${q.toString()}`);
  }
  return <DashboardClient />;
}
