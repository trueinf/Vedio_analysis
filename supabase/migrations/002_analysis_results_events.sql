-- Normalized result storage + timeline events; optional columns on analyses used by the API.

alter table public.analyses add column if not exists video_storage_path text default '';
alter table public.analyses add column if not exists source_type text default '';
alter table public.analyses add column if not exists source_url text default '';
alter table public.analyses add column if not exists title text default '';

-- Integer progress (0–100) alongside existing float progress for API compatibility.
alter table public.analyses add column if not exists progress_int integer default 0;

create table if not exists public.analysis_results (
  id uuid primary key default uuid_generate_v4(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  unique (analysis_id)
);

create index if not exists idx_analysis_results_analysis_id on public.analysis_results (analysis_id);

create table if not exists public.events (
  id uuid primary key default uuid_generate_v4(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  metric text not null default '',
  label text not null default '',
  t0 double precision not null default 0,
  t1 double precision not null default 0,
  value double precision
);

create index if not exists idx_events_analysis_id on public.events (analysis_id);
create index if not exists idx_events_metric on public.events (metric);

alter table public.analysis_results enable row level security;
alter table public.events enable row level security;

create policy "Allow all operations on analysis_results" on public.analysis_results for all using (true) with check (true);
create policy "Allow all operations on events" on public.events for all using (true) with check (true);
