-- Supabase schema for AI Video Performance Analyzer persistence.
-- Run this in Supabase SQL Editor (once).

-- Core analyses table: one row per analyzed video (upload or YouTube URL).
create table if not exists public.analyses (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- optional if you add auth later; keep nullable for now
  user_id uuid null,

  source_type text not null default 'upload', -- upload | youtube_url
  source_url text not null default '',
  title text not null default '',

  video_storage_path text not null default '', -- path in Supabase Storage bucket
  duration_sec integer not null default 0,

  status text not null default 'queued', -- queued | processing | completed | failed
  stage text not null default 'queued',
  progress double precision not null default 0,

  error_message text not null default ''
);

-- Full analysis payload as JSONB (your existing result object).
create table if not exists public.analysis_results (
  analysis_id uuid primary key references public.analyses(id) on delete cascade,
  created_at timestamptz not null default now(),
  result_version text not null default 'v1',
  result_json jsonb not null
);

-- Persist comparison reports (compare two analyses).
create table if not exists public.comparison_reports (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid null,
  left_analysis_id uuid not null references public.analyses(id) on delete cascade,
  right_analysis_id uuid not null references public.analyses(id) on delete cascade,
  report_version text not null default 'v1',
  report_json jsonb not null
);

create index if not exists analyses_created_at_idx on public.analyses(created_at desc);
create index if not exists analyses_status_idx on public.analyses(status);

