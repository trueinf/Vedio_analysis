"use client";

import { useParams } from "next/navigation";

import { AnalysisReport } from "@/components/AnalysisReport";

export default function VideoPage() {
  const params = useParams();
  const id =
    typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] ?? "" : "";
  if (!id) return null;
  return <AnalysisReport analysisId={id} />;
}
