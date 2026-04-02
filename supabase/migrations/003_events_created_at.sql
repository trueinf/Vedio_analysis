-- Optional: timeline ordering by insert time (list_events can select created_at after this runs)
alter table public.events add column if not exists created_at timestamptz default now();
