-- Full Supabase setup for the AI Video Performance Analyzer.
-- Run ONCE in the target project's Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Idempotent: safe to re-run. Consolidates migrations 001/002/003 + comparison_reports.

create extension if not exists "uuid-ossp";

-- ============ analyses (one row per analyzed video) ============
create table if not exists public.analyses (
  id uuid primary key default uuid_generate_v4(),
  job_id text unique not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  original_filename text not null default '',
  video_url text default '',
  duration_sec integer default 0,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  stage text default 'queued',
  progress float default 0.0,
  error_message text default '',
  channel_name text default '',
  result_json jsonb,
  overall_score integer,
  wpm float,
  eye_contact_ratio float,
  fillers_per_min float,
  gestures_per_min float,
  tonal_label text,
  confidence_score integer,
  energy_score integer,
  thumbnail_url text default '',
  tags text[] default '{}'
);

-- columns introduced by migration 002
alter table public.analyses add column if not exists video_storage_path text default '';
alter table public.analyses add column if not exists source_type text default '';
alter table public.analyses add column if not exists source_url text default '';
alter table public.analyses add column if not exists title text default '';
alter table public.analyses add column if not exists progress_int integer default 0;

-- ============ analysis_results (full JSON payload) ============
create table if not exists public.analysis_results (
  id uuid primary key default uuid_generate_v4(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  unique (analysis_id)
);

-- ============ events (timeline markers) ============
create table if not exists public.events (
  id uuid primary key default uuid_generate_v4(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  metric text not null default '',
  label text not null default '',
  t0 double precision not null default 0,
  t1 double precision not null default 0,
  value double precision,
  created_at timestamptz default now()
);

-- ============ comparisons (legacy table from migration 001) ============
create table if not exists public.comparisons (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz default now(),
  source_analysis_id uuid references public.analyses(id) on delete cascade,
  target_analysis_id uuid references public.analyses(id) on delete set null,
  niche text default 'education',
  goal text default 'retention',
  platform text default 'youtube_long',
  compare_mode text default 'niche_benchmark',
  competitor_channel text default '',
  report_json jsonb,
  source_score integer,
  projected_score integer
);

-- ============ comparison_reports (written by create_comparison_report) ============
create table if not exists public.comparison_reports (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid null,
  left_analysis_id uuid not null references public.analyses(id) on delete cascade,
  right_analysis_id uuid not null references public.analyses(id) on delete cascade,
  report_version text not null default 'v1',
  report_json jsonb not null
);

-- ============ indexes ============
create index if not exists idx_analyses_status on public.analyses(status);
create index if not exists idx_analyses_created_at on public.analyses(created_at desc);
create index if not exists idx_analyses_job_id on public.analyses(job_id);
create index if not exists idx_analyses_channel_name on public.analyses(channel_name);
create index if not exists idx_analysis_results_analysis_id on public.analysis_results (analysis_id);
create index if not exists idx_events_analysis_id on public.events (analysis_id);
create index if not exists idx_events_metric on public.events (metric);
create index if not exists idx_comparisons_source on public.comparisons(source_analysis_id);

-- ============ updated_at trigger ============
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.analyses;
create trigger set_updated_at
  before update on public.analyses
  for each row execute procedure public.handle_updated_at();

-- ============ RLS (allow-all; the backend uses the service_role key, which bypasses RLS) ============
alter table public.analyses enable row level security;
alter table public.analysis_results enable row level security;
alter table public.events enable row level security;
alter table public.comparisons enable row level security;
alter table public.comparison_reports enable row level security;

drop policy if exists "Allow all operations on analyses" on public.analyses;
create policy "Allow all operations on analyses" on public.analyses for all using (true) with check (true);
drop policy if exists "Allow all operations on analysis_results" on public.analysis_results;
create policy "Allow all operations on analysis_results" on public.analysis_results for all using (true) with check (true);
drop policy if exists "Allow all operations on events" on public.events;
create policy "Allow all operations on events" on public.events for all using (true) with check (true);
drop policy if exists "Allow all operations on comparisons" on public.comparisons;
create policy "Allow all operations on comparisons" on public.comparisons for all using (true) with check (true);
drop policy if exists "Allow all operations on comparison_reports" on public.comparison_reports;
create policy "Allow all operations on comparison_reports" on public.comparison_reports for all using (true) with check (true);
