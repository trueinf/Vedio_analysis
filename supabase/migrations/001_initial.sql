-- Phase 1A: Supabase schema (Cursor migration)
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Main analyses table
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

-- Comparisons table
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

-- Indexes for performance
create index if not exists idx_analyses_status on public.analyses(status);
create index if not exists idx_analyses_created_at on public.analyses(created_at desc);
create index if not exists idx_analyses_job_id on public.analyses(job_id);
create index if not exists idx_analyses_channel_name on public.analyses(channel_name);
create index if not exists idx_comparisons_source on public.comparisons(source_analysis_id);

-- Row level security (allow all for now, add auth later)
alter table public.analyses enable row level security;
alter table public.comparisons enable row level security;

create policy "Allow all operations on analyses" on public.analyses for all using (true) with check (true);
create policy "Allow all operations on comparisons" on public.comparisons for all using (true) with check (true);

-- Updated_at trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
  before update on public.analyses
  for each row execute procedure public.handle_updated_at();

