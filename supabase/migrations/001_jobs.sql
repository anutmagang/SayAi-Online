-- Run in Supabase SQL editor or via supabase db push
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  source_url text not null,
  error_message text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_user_id_created_at_idx
  on public.jobs (user_id, created_at desc);

alter table public.jobs enable row level security;

drop policy if exists "jobs_select_own" on public.jobs;
drop policy if exists "jobs_insert_own" on public.jobs;

create policy "jobs_select_own"
  on public.jobs for select
  using (auth.uid() = user_id);

create policy "jobs_insert_own"
  on public.jobs for insert
  with check (auth.uid() = user_id);

-- Updates are performed with the service role (bypasses RLS) from the worker process.
-- Application / worker should set updated_at when changing a row (or extend with a DB trigger later).
