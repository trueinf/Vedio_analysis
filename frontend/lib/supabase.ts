import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export type AnalysisSummary = {
  id: string;
  job_id: string;
  created_at: string;
  updated_at: string;
  original_filename: string;
  duration_sec: number;
  status: "queued" | "processing" | "completed" | "failed";
  stage: string;
  progress: number;
  channel_name: string;
  overall_score: number;
  wpm: number;
  eye_contact_ratio: number;
  fillers_per_min: number;
  gestures_per_min: number;
  tonal_label: string;
  confidence_score: number;
  energy_score: number;
  error_message: string;
};

export type AnalysisFull = AnalysisSummary & {
  result_json: Record<string, unknown> | null;
};

export type ComparisonRecord = {
  id: string;
  created_at: string;
  source_analysis_id: string;
  target_analysis_id: string | null;
  niche: string;
  goal: string;
  platform: string;
  compare_mode: string;
  competitor_channel: string;
  report_json: Record<string, unknown>;
  source_score: number;
  projected_score: number;
};

