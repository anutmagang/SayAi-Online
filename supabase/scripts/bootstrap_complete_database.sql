-- =============================================================================
-- Fai-Clipper / SayAi — BOOTSTRAP DATABASE LENGKAP
-- =============================================================================
--
-- Tujuan: satu berkas untuk project Supabase BARU (schema kosong).
-- Isi: gabungan berurutan seluruh file di supabase/migrations/ (001–023).
--
-- PERINGATAN:
-- - Untuk DB yang sudah sebagian ter-migrate: jalankan file migrasi INCREMENTAL
--   saja (yang belum), atau reset project — bootstrap penuh bisa bentrok.
--
-- Setelah sukses: promote admin via supabase/scripts/promote_admin_by_email.sql
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 001_jobs.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 002_phase4_monetization_analytics.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Phase 4: profiles + credits, manual top-up requests, admin review RPC,
-- atomic job start with debit, optional upload-abort refund.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null default 'free'
    check (tier in ('free', 'starter', 'pro')),
  credits_balance int not null default 5
    check (credits_balance >= 0 and credits_balance <= 1000000),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_is_admin_idx
  on public.profiles (is_admin)
  where is_admin = true;

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- credit ledger (audit)
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta int not null,
  balance_after int not null,
  reason text not null,
  ref_type text,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_created_idx
  on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;

create policy "credit_ledger_select_own"
  on public.credit_ledger for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- manual top-up requests
-- ---------------------------------------------------------------------------
create table if not exists public.topup_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credits_requested int not null
    check (credits_requested > 0 and credits_requested <= 100000),
  payment_note text not null,
  bank_reference text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists topup_requests_user_created_idx
  on public.topup_requests (user_id, created_at desc);

create index if not exists topup_requests_status_created_idx
  on public.topup_requests (status, created_at desc);

alter table public.topup_requests enable row level security;

create policy "topup_select_own"
  on public.topup_requests for select
  using (auth.uid() = user_id);

create policy "topup_select_admin"
  on public.topup_requests for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid() and coalesce(p.is_admin, false)
    )
  );

create policy "topup_insert_own"
  on public.topup_requests for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- New signups â†’ profile row
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, tier, credits_balance)
  values (new.id, 'free', 5)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill existing users (before trigger existed)
insert into public.profiles (user_id, tier, credits_balance)
select id, 'free', 5
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Jobs: remove direct insert for end users (credits enforced via RPC)
-- ---------------------------------------------------------------------------
drop policy if exists "jobs_insert_own" on public.jobs;

-- ---------------------------------------------------------------------------
-- start_clip_job: create row + debit 1 credit (skip debit for tier = pro)
-- ---------------------------------------------------------------------------
create or replace function public.start_clip_job(p_source_url text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  bal int;
  p_tier text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (user_id, tier, credits_balance)
  values (uid, 'free', 5)
  on conflict (user_id) do nothing;

  select tier, credits_balance
  into p_tier, bal
  from public.profiles
  where user_id = uid
  for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if p_tier is distinct from 'pro' and bal < 1 then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into public.jobs (user_id, source_url, status)
  values (uid, p_source_url, 'pending')
  returning id into jid;

  if p_tier is distinct from 'pro' then
    update public.profiles
    set credits_balance = credits_balance - 1, updated_at = now()
    where user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      -1,
      (select credits_balance from public.profiles where user_id = uid),
      'job_debit',
      'job',
      jid
    );
  end if;

  return jid;
end;
$$;

revoke all on function public.start_clip_job(text) from public;
grant execute on function public.start_clip_job(text) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_pending_job: upload failed after debit â€” delete pending job + credit
-- ---------------------------------------------------------------------------
create or replace function public.refund_pending_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  j record;
  p_tier text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into j from public.jobs where id = p_job_id for update;
  if not found then
    return;
  end if;
  if j.user_id <> uid then
    raise exception 'FORBIDDEN';
  end if;
  if j.status <> 'pending' then
    return;
  end if;

  delete from public.jobs where id = p_job_id;

  select tier into p_tier from public.profiles where user_id = uid for update;
  if p_tier is distinct from 'pro' then
    update public.profiles
    set credits_balance = credits_balance + 1, updated_at = now()
    where user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      1,
      (select credits_balance from public.profiles where user_id = uid),
      'job_upload_aborted_refund',
      'job',
      p_job_id
    );
  end if;
end;
$$;

revoke all on function public.refund_pending_job(uuid) from public;
grant execute on function public.refund_pending_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_review_topup
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_topup(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  adm boolean;
  r record;
  new_bal int;
begin
  select exists(
    select 1 from public.profiles p
    where p.user_id = auth.uid() and coalesce(p.is_admin, false)
  ) into adm;

  if not adm then
    raise exception 'FORBIDDEN';
  end if;

  select * into r from public.topup_requests where id = p_request_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if r.status <> 'pending' then
    raise exception 'ALREADY_REVIEWED';
  end if;

  if p_approve then
    update public.profiles
    set credits_balance = credits_balance + r.credits_requested, updated_at = now()
    where user_id = r.user_id
    returning credits_balance into new_bal;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      r.user_id,
      r.credits_requested,
      new_bal,
      'topup_approved',
      'topup',
      p_request_id
    );

    update public.topup_requests
    set
      status = 'approved',
      admin_note = p_admin_note,
      reviewed_at = now(),
      updated_at = now()
    where id = p_request_id;
  else
    update public.topup_requests
    set
      status = 'rejected',
      admin_note = p_admin_note,
      reviewed_at = now(),
      updated_at = now()
    where id = p_request_id;
  end if;
end;
$$;

revoke all on function public.admin_review_topup(uuid, boolean, text) from public;
grant execute on function public.admin_review_topup(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- ensure_user_profile â€” for /api/me before first job (RLS-safe)
-- ---------------------------------------------------------------------------
create or replace function public.ensure_user_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  insert into public.profiles (user_id, tier, credits_balance)
  values (auth.uid(), 'free', 5)
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.ensure_user_profile() from public;
grant execute on function public.ensure_user_profile() to authenticated;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 003_phase5_beta_social.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Phase 5: beta onboarding, public beta stats, social token vault (service role only),
-- publish queue for TikTok inbox upload / Instagram (documented).

-- ---------------------------------------------------------------------------
-- Onboarding (first-login checklist)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

-- Existing users: skip forced welcome
update public.profiles
set onboarding_completed_at = coalesce(onboarding_completed_at, now())
where onboarding_completed_at is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (new.id, 'free', 5, null)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.ensure_user_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (auth.uid(), 'free', 5, null)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.start_clip_job(p_source_url text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  bal int;
  p_tier text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (uid, 'free', 5, null)
  on conflict (user_id) do nothing;

  select tier, credits_balance
  into p_tier, bal
  from public.profiles
  where user_id = uid
  for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if p_tier is distinct from 'pro' and bal < 1 then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into public.jobs (user_id, source_url, status)
  values (uid, p_source_url, 'pending')
  returning id into jid;

  if p_tier is distinct from 'pro' then
    update public.profiles
    set credits_balance = credits_balance - 1, updated_at = now()
    where user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      -1,
      (select credits_balance from public.profiles where user_id = uid),
      'job_debit',
      'job',
      jid
    );
  end if;

  return jid;
end;
$$;

create or replace function public.complete_onboarding()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (auth.uid(), 'free', 5, now())
  on conflict (user_id) do update
    set onboarding_completed_at = excluded.onboarding_completed_at,
        updated_at = now();
end;
$$;

revoke all on function public.complete_onboarding() from public;
grant execute on function public.complete_onboarding() to authenticated;

create or replace function public.beta_enrollment_stats()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'registered', least((select count(*)::int from public.profiles), 100),
    'cap', 100,
    'spots_left', greatest(0, 100 - (select count(*)::int from public.profiles)),
    'closed', (select count(*)::int from public.profiles) >= 100
  );
$$;

revoke all on function public.beta_enrollment_stats() from public;
grant execute on function public.beta_enrollment_stats() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Social OAuth tokens â€” no RLS policies for authenticated (service role only)
-- ---------------------------------------------------------------------------
create table if not exists public.social_channel_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('tiktok', 'instagram')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  open_id text,
  display_name text,
  provider_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.social_channel_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- Publish queue
-- ---------------------------------------------------------------------------
create table if not exists public.publish_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  clip_index int not null check (clip_index >= 0 and clip_index < 128),
  platform text not null check (platform in ('tiktok', 'instagram')),
  caption text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'posted', 'failed')),
  error_message text,
  external_post_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publish_queue_user_created_idx
  on public.publish_queue (user_id, created_at desc);

create index if not exists publish_queue_pending_idx
  on public.publish_queue (status, created_at)
  where status = 'pending';

create unique index if not exists publish_queue_pending_unique_target
  on public.publish_queue (job_id, clip_index, platform)
  where status in ('pending', 'processing');

alter table public.publish_queue enable row level security;

create policy "publish_queue_select_own"
  on public.publish_queue for select
  using (auth.uid() = user_id);

create policy "publish_queue_insert_own"
  on public.publish_queue for insert
  with check (auth.uid() = user_id);



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 004_release_ready.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Release-ready migration: hapus fitur social publish, tambah tier/subscription/quota,
-- job_events progress, LLM preference per user, jobs audit, Storage buckets,
-- retention + rate limit. Idempotent: aman dijalankan berulang.

-- ---------------------------------------------------------------------------
-- Drop Phase 5 social publish artefacts
-- ---------------------------------------------------------------------------
drop table if exists public.publish_queue cascade;
drop table if exists public.social_channel_tokens cascade;

-- ---------------------------------------------------------------------------
-- profiles: tambah kolom tier expiry, monthly quota, llm preference
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists plan_expires_at timestamptz,
  add column if not exists monthly_quota int not null default 0
    check (monthly_quota >= 0 and monthly_quota <= 100000),
  add column if not exists monthly_used int not null default 0
    check (monthly_used >= 0),
  add column if not exists monthly_reset_at timestamptz not null default now(),
  add column if not exists llm_preference text not null default 'auto'
    check (llm_preference in ('auto', 'groq', 'gemini', 'openai', 'anthropic'));

-- Existing users: tier pro -> kuota besar (soft cap 500/bulan). Starter -> 30.
-- Free -> 0 monthly_quota (mereka pakai credits_balance).
update public.profiles
set monthly_quota = case tier
  when 'pro' then 500
  when 'starter' then 30
  else 0
end
where monthly_quota = 0;

-- ---------------------------------------------------------------------------
-- jobs: tambah kolom audit tier/provider waktu job dibuat
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists tier_used text
    check (tier_used is null or tier_used in ('free', 'starter', 'pro')),
  add column if not exists llm_provider_used text,
  add column if not exists transcribe_provider_used text,
  add column if not exists source_kind text not null default 'url'
    check (source_kind in ('url', 'upload')),
  add column if not exists source_storage_path text,
  add column if not exists clips_storage_prefix text,
  add column if not exists finished_at timestamptz;

-- ---------------------------------------------------------------------------
-- job_events: progress realtime dari worker ke UI
-- ---------------------------------------------------------------------------
create table if not exists public.job_events (
  id bigserial primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  phase text not null,
  message text,
  progress numeric(5, 2)
    check (progress is null or (progress >= 0 and progress <= 100)),
  created_at timestamptz not null default now()
);

create index if not exists job_events_job_created_idx
  on public.job_events (job_id, created_at);

create index if not exists job_events_user_created_idx
  on public.job_events (user_id, created_at desc);

alter table public.job_events enable row level security;

drop policy if exists "job_events_select_own" on public.job_events;
create policy "job_events_select_own"
  on public.job_events for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- subscription_requests: user minta upgrade, admin approve manual
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  requested_tier text not null check (requested_tier in ('starter', 'pro')),
  months int not null default 1 check (months > 0 and months <= 24),
  payment_note text not null,
  bank_reference text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscription_requests_user_created_idx
  on public.subscription_requests (user_id, created_at desc);

create index if not exists subscription_requests_status_created_idx
  on public.subscription_requests (status, created_at desc);

alter table public.subscription_requests enable row level security;

drop policy if exists "sub_select_own" on public.subscription_requests;
create policy "sub_select_own"
  on public.subscription_requests for select
  using (auth.uid() = user_id);

drop policy if exists "sub_select_admin" on public.subscription_requests;
create policy "sub_select_admin"
  on public.subscription_requests for select
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and coalesce(p.is_admin, false)
    )
  );

drop policy if exists "sub_insert_own" on public.subscription_requests;
create policy "sub_insert_own"
  on public.subscription_requests for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Reset kuota bulanan otomatis
-- Dipanggil di dalam start_clip_job; reset kalau lewat 30 hari dari monthly_reset_at.
-- ---------------------------------------------------------------------------
create or replace function public._maybe_reset_monthly_quota(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select plan_expires_at, monthly_reset_at into r
  from public.profiles where user_id = uid for update;
  if not found then return; end if;
  -- Kalau subscription expired â†’ kuota jadi 0 (downgrade ke free).
  if r.plan_expires_at is not null and r.plan_expires_at < now() then
    update public.profiles
    set monthly_used = 0,
        monthly_quota = 0,
        monthly_reset_at = now(),
        tier = 'free',
        updated_at = now()
    where user_id = uid;
    return;
  end if;
  -- Reset kalau lewat 30 hari sejak last reset.
  if r.monthly_reset_at is null or r.monthly_reset_at + interval '30 days' <= now() then
    update public.profiles
    set monthly_used = 0,
        monthly_reset_at = now(),
        updated_at = now()
    where user_id = uid;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_clip_job: cek quota/credit + rate limit + return tier untuk worker env
-- ---------------------------------------------------------------------------
drop function if exists public.start_clip_job(text);
create or replace function public.start_clip_job(
  p_source_url text,
  p_source_kind text default 'url',
  p_source_storage_path text default null
)
returns table (
  job_id uuid,
  tier text,
  llm_preference text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  p_tier text;
  p_pref text;
  bal int;
  mq int;
  mu int;
  pending_count int;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (uid, 'free', 5, null)
  on conflict (user_id) do nothing;

  -- Auto-reset kuota bulanan kalau sudah waktunya (dan handle expiry).
  perform public._maybe_reset_monthly_quota(uid);

  select tier, credits_balance, monthly_quota, monthly_used, llm_preference
  into p_tier, bal, mq, mu, p_pref
  from public.profiles
  where user_id = uid
  for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  -- Rate limit: max 3 pending/running per user supaya tidak spam worker.
  select count(*) into pending_count
  from public.jobs
  where user_id = uid and status in ('pending', 'running');
  if pending_count >= 3 then
    raise exception 'TOO_MANY_ACTIVE_JOBS';
  end if;

  -- Quota check: tier berbayar pakai monthly_quota; free pakai credits_balance.
  if p_tier in ('starter', 'pro') then
    if mu >= mq then
      raise exception 'MONTHLY_QUOTA_EXHAUSTED';
    end if;
  else
    if bal < 1 then
      raise exception 'INSUFFICIENT_CREDITS';
    end if;
  end if;

  insert into public.jobs (
    user_id, source_url, status, tier_used, source_kind, source_storage_path
  )
  values (
    uid, p_source_url, 'pending', p_tier, p_source_kind, p_source_storage_path
  )
  returning id into jid;

  -- Debit: paid tier naikin monthly_used; free kurangin credits_balance.
  if p_tier in ('starter', 'pro') then
    update public.profiles
    set monthly_used = monthly_used + 1, updated_at = now()
    where user_id = uid;
  else
    update public.profiles
    set credits_balance = credits_balance - 1, updated_at = now()
    where user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      -1,
      (select credits_balance from public.profiles where user_id = uid),
      'job_debit',
      'job',
      jid
    );
  end if;

  return query select jid, p_tier, p_pref;
end;
$$;

revoke all on function public.start_clip_job(text, text, text) from public;
grant execute on function public.start_clip_job(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_pending_job: sekarang juga return kuota bulanan untuk tier berbayar
-- ---------------------------------------------------------------------------
create or replace function public.refund_pending_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  j record;
  p_tier text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into j from public.jobs where id = p_job_id for update;
  if not found then return; end if;
  if j.user_id <> uid then
    raise exception 'FORBIDDEN';
  end if;
  if j.status <> 'pending' then return; end if;

  delete from public.jobs where id = p_job_id;

  select tier into p_tier from public.profiles where user_id = uid for update;

  if j.tier_used in ('starter', 'pro') or p_tier in ('starter', 'pro') then
    update public.profiles
    set monthly_used = greatest(0, monthly_used - 1), updated_at = now()
    where user_id = uid;
  else
    update public.profiles
    set credits_balance = credits_balance + 1, updated_at = now()
    where user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      1,
      (select credits_balance from public.profiles where user_id = uid),
      'job_upload_aborted_refund',
      'job',
      p_job_id
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_llm_preference: user Pro pilih model preferred
-- ---------------------------------------------------------------------------
create or replace function public.set_llm_preference(p_pref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p_tier text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_pref not in ('auto', 'groq', 'gemini', 'openai', 'anthropic') then
    raise exception 'INVALID_PREFERENCE';
  end if;
  select tier into p_tier from public.profiles where user_id = uid;
  if p_tier is distinct from 'pro' and p_pref <> 'auto' then
    raise exception 'PRO_REQUIRED';
  end if;
  update public.profiles
  set llm_preference = p_pref, updated_at = now()
  where user_id = uid;
end;
$$;

revoke all on function public.set_llm_preference(text) from public;
grant execute on function public.set_llm_preference(text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_review_subscription: admin approve/reject permintaan upgrade
-- Saat approve: set tier + plan_expires_at + reset monthly_quota sesuai tier.
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_subscription(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  adm boolean;
  r record;
  new_quota int;
  new_expires timestamptz;
  current_expires timestamptz;
begin
  select exists(
    select 1 from public.profiles p
    where p.user_id = auth.uid() and coalesce(p.is_admin, false)
  ) into adm;

  if not adm then raise exception 'FORBIDDEN'; end if;

  select * into r from public.subscription_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;

  if p_approve then
    new_quota := case r.requested_tier
      when 'starter' then 30
      when 'pro' then 500
      else 0
    end;

    -- Kalau user masih punya sisa subscription aktif, extend. Kalau enggak, mulai dari now().
    select plan_expires_at into current_expires from public.profiles where user_id = r.user_id;
    if current_expires is not null and current_expires > now() then
      new_expires := current_expires + (r.months || ' months')::interval;
    else
      new_expires := now() + (r.months || ' months')::interval;
    end if;

    update public.profiles
    set tier = r.requested_tier,
        plan_expires_at = new_expires,
        monthly_quota = new_quota,
        monthly_used = 0,
        monthly_reset_at = now(),
        updated_at = now()
    where user_id = r.user_id;

    update public.subscription_requests
    set status = 'approved',
        admin_note = p_admin_note,
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id;
  else
    update public.subscription_requests
    set status = 'rejected',
        admin_note = p_admin_note,
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id;
  end if;
end;
$$;

revoke all on function public.admin_review_subscription(uuid, boolean, text) from public;
grant execute on function public.admin_review_subscription(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- purge_old_jobs: retention â€” hapus job + files >14 hari (dipanggil via cron)
-- Storage objects dihapus di worker Node (function ini hanya cleanup DB + kembalikan list path).
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_jobs(p_days int default 14)
returns table (job_id uuid, source_storage_path text, clips_storage_prefix text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with deleted as (
    delete from public.jobs
    where created_at < now() - (p_days || ' days')::interval
    returning id, source_storage_path, clips_storage_prefix
  )
  select id, source_storage_path, clips_storage_prefix from deleted;
end;
$$;

revoke all on function public.purge_old_jobs(int) from public;
-- Hanya service role yang boleh purge (dipanggil dari worker cron, bukan dari user).

-- ---------------------------------------------------------------------------
-- Storage buckets: sources (source asli user) + clips (hasil render)
-- Keduanya private; akses lewat signed URL dari server.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sources', 'sources', false, 2147483648,   -- 2 GB cap per source
  array['video/mp4','video/webm','video/quicktime','video/x-matroska','audio/mpeg','audio/mp4','audio/wav','application/octet-stream']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clips', 'clips', false, 524288000,         -- 500 MB cap per clip
  array['video/mp4']
)
on conflict (id) do nothing;

-- Storage RLS: user hanya bisa INSERT ke sources/<uid>/... ; READ dilakukan server pakai service role.
drop policy if exists "sources_insert_own" on storage.objects;
create policy "sources_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sources_select_own" on storage.objects;
create policy "sources_select_own"
  on storage.objects for select
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sources_delete_own" on storage.objects;
create policy "sources_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- clips bucket: server only (service role). Tidak ada policy authenticated di sini.



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 005_cleanup_and_admin.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Fai-Clipper release cleanup:
-- 1) drop leftover beta-only artefacts (100-user cap, beta stats)
-- 2) promote the operator account to admin (imadmin@verinusa.com)
-- 3) add a convenience is-admin check function for RLS
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Drop beta enrollment stats (no more public user cap)
-- ---------------------------------------------------------------------------
drop function if exists public.beta_enrollment_stats();

-- ---------------------------------------------------------------------------
-- Promote operator to admin.
-- Works on existing or future signup: creates a profile row if missing, then
-- sets is_admin = true. Change the email literal below for self-hosting.
-- ---------------------------------------------------------------------------
do $$
declare
  admin_email constant text := 'imadmin@verinusa.com';
  admin_uid uuid;
begin
  select id into admin_uid from auth.users where lower(email) = lower(admin_email);
  if admin_uid is null then
    raise notice 'Admin email % not found in auth.users (signup dulu, lalu jalankan migrasi ulang).', admin_email;
    return;
  end if;

  insert into public.profiles (user_id, tier, credits_balance, is_admin, onboarding_completed_at)
  values (admin_uid, 'pro', 100, true, now())
  on conflict (user_id) do update
    set is_admin = true,
        tier = case when public.profiles.tier = 'free' then 'pro' else public.profiles.tier end,
        onboarding_completed_at = coalesce(public.profiles.onboarding_completed_at, now()),
        updated_at = now();
end$$;

-- ---------------------------------------------------------------------------
-- is_admin() helper â€” use in future RLS policies to avoid subquery repetition.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where user_id = uid), false);
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_failed_job: dipanggil worker (service role) saat job gagal system error.
-- Sama logika dengan refund_pending_job tapi tanpa auth.uid() check â€” karena
-- worker pakai service role, bukan user session. Aman: argumen p_job_id
-- diverifikasi exists + belum pernah di-refund (ditandai refunded_at).
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists refunded_at timestamptz;

create or replace function public.refund_failed_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j record;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then return; end if;
  if j.refunded_at is not null then return; end if;
  if j.status not in ('failed', 'pending', 'running') then return; end if;

  if j.tier_used in ('starter', 'pro') then
    update public.profiles
    set monthly_used = greatest(0, monthly_used - 1), updated_at = now()
    where user_id = j.user_id;
  else
    update public.profiles
    set credits_balance = credits_balance + 1, updated_at = now()
    where user_id = j.user_id;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      j.user_id,
      1,
      (select credits_balance from public.profiles where user_id = j.user_id),
      'job_failed_refund',
      'job',
      p_job_id
    );
  end if;

  update public.jobs set refunded_at = now(), updated_at = now() where id = p_job_id;
end;
$$;

revoke all on function public.refund_failed_job(uuid) from public;
-- No grant to authenticated â€” service role only.



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 006_fix_start_clip_job.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Fix: "column reference 'tier' is ambiguous" in start_clip_job.
-- Kolom `tier` di RETURNS TABLE bentrok sama kolom `profiles.tier`.
-- Solusi: qualify pakai alias `pr.` dan juga qualify insert ke jobs.

drop function if exists public.start_clip_job(text, text, text);

create or replace function public.start_clip_job(
  p_source_url text,
  p_source_kind text default 'url',
  p_source_storage_path text default null
)
returns table (
  job_id uuid,
  tier text,
  llm_preference text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  p_tier text;
  p_pref text;
  bal int;
  mq int;
  mu int;
  pending_count int;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (uid, 'free', 5, null)
  on conflict (user_id) do nothing;

  perform public._maybe_reset_monthly_quota(uid);

  select pr.tier, pr.credits_balance, pr.monthly_quota, pr.monthly_used, pr.llm_preference
    into p_tier, bal, mq, mu, p_pref
    from public.profiles pr
   where pr.user_id = uid
     for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  select count(*) into pending_count
    from public.jobs j
   where j.user_id = uid and j.status in ('pending', 'running');
  if pending_count >= 3 then
    raise exception 'TOO_MANY_ACTIVE_JOBS';
  end if;

  if p_tier in ('starter', 'pro') then
    if mu >= mq then
      raise exception 'MONTHLY_QUOTA_EXHAUSTED';
    end if;
  else
    if bal < 1 then
      raise exception 'INSUFFICIENT_CREDITS';
    end if;
  end if;

  insert into public.jobs (
    user_id, source_url, status, tier_used, source_kind, source_storage_path
  )
  values (
    uid, p_source_url, 'pending', p_tier, p_source_kind, p_source_storage_path
  )
  returning id into jid;

  if p_tier in ('starter', 'pro') then
    update public.profiles pr
       set monthly_used = pr.monthly_used + 1,
           updated_at = now()
     where pr.user_id = uid;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance - 1,
           updated_at = now()
     where pr.user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      -1,
      (select pr.credits_balance from public.profiles pr where pr.user_id = uid),
      'job_debit',
      'job',
      jid
    );
  end if;

  return query select jid, p_tier, p_pref;
end;
$$;

revoke all on function public.start_clip_job(text, text, text) from public;
grant execute on function public.start_clip_job(text, text, text) to authenticated;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 007_add_creator_tier.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- 007: Add "creator" tier (4-tier pricing structure).
-- Free â†’ Starter (Rp 49K, 30 job) â†’ Creator (Rp 129K, 90 job) â†’ Pro (Rp 299K, 250 job)

-- ---------------------------------------------------------------------------
-- 1. Extend CHECK constraint on profiles.tier to allow 'creator'
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_tier_check;
alter table public.profiles
  add constraint profiles_tier_check
  check (tier in ('free', 'starter', 'creator', 'pro'));

-- ---------------------------------------------------------------------------
-- 2. Extend CHECK on jobs.tier_used
-- ---------------------------------------------------------------------------
alter table public.jobs
  drop constraint if exists jobs_tier_used_check;
alter table public.jobs
  add constraint jobs_tier_used_check
  check (tier_used is null or tier_used in ('free', 'starter', 'creator', 'pro'));

-- ---------------------------------------------------------------------------
-- 3. Extend CHECK on subscription_requests.requested_tier
-- ---------------------------------------------------------------------------
alter table public.subscription_requests
  drop constraint if exists subscription_requests_requested_tier_check;
alter table public.subscription_requests
  add constraint subscription_requests_requested_tier_check
  check (requested_tier in ('starter', 'creator', 'pro'));

-- ---------------------------------------------------------------------------
-- 4. Update Pro quota from 500 â†’ 250 for existing Pro users
-- ---------------------------------------------------------------------------
update public.profiles
   set monthly_quota = 250,
       updated_at = now()
 where tier = 'pro'
   and monthly_quota = 500;

-- ---------------------------------------------------------------------------
-- 5. Replace start_clip_job with creator-aware version
--    (also incorporates the 006 fix for ambiguous column refs)
-- ---------------------------------------------------------------------------
drop function if exists public.start_clip_job(text, text, text);

create or replace function public.start_clip_job(
  p_source_url text,
  p_source_kind text default 'url',
  p_source_storage_path text default null
)
returns table (
  job_id uuid,
  tier text,
  llm_preference text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  p_tier text;
  p_pref text;
  bal int;
  mq int;
  mu int;
  pending_count int;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (uid, 'free', 5, null)
  on conflict (user_id) do nothing;

  perform public._maybe_reset_monthly_quota(uid);

  select pr.tier, pr.credits_balance, pr.monthly_quota, pr.monthly_used, pr.llm_preference
    into p_tier, bal, mq, mu, p_pref
    from public.profiles pr
   where pr.user_id = uid
     for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  select count(*) into pending_count
    from public.jobs j
   where j.user_id = uid and j.status in ('pending', 'running');
  if pending_count >= 3 then
    raise exception 'TOO_MANY_ACTIVE_JOBS';
  end if;

  if p_tier in ('starter', 'creator', 'pro') then
    if mu >= mq then
      raise exception 'MONTHLY_QUOTA_EXHAUSTED';
    end if;
  else
    if bal < 1 then
      raise exception 'INSUFFICIENT_CREDITS';
    end if;
  end if;

  insert into public.jobs (
    user_id, source_url, status, tier_used, source_kind, source_storage_path
  )
  values (
    uid, p_source_url, 'pending', p_tier, p_source_kind, p_source_storage_path
  )
  returning id into jid;

  if p_tier in ('starter', 'creator', 'pro') then
    update public.profiles pr
       set monthly_used = pr.monthly_used + 1,
           updated_at = now()
     where pr.user_id = uid;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance - 1,
           updated_at = now()
     where pr.user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      -1,
      (select pr.credits_balance from public.profiles pr where pr.user_id = uid),
      'job_debit',
      'job',
      jid
    );
  end if;

  return query select jid, p_tier, p_pref;
end;
$$;

revoke all on function public.start_clip_job(text, text, text) from public;
grant execute on function public.start_clip_job(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Update set_llm_preference: allow Creator + Pro (was Pro-only)
-- ---------------------------------------------------------------------------
create or replace function public.set_llm_preference(p_pref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p_tier text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_pref not in ('auto', 'groq', 'gemini', 'openai', 'anthropic') then
    raise exception 'INVALID_PREFERENCE';
  end if;
  select pr.tier into p_tier from public.profiles pr where pr.user_id = uid;
  if p_tier not in ('creator', 'pro') and p_pref <> 'auto' then
    raise exception 'PAID_TIER_REQUIRED';
  end if;
  update public.profiles pr
  set llm_preference = p_pref, updated_at = now()
  where pr.user_id = uid;
end;
$$;

revoke all on function public.set_llm_preference(text) from public;
grant execute on function public.set_llm_preference(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Update admin_review_subscription: support creator tier quota
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_subscription(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  adm boolean;
  r record;
  new_quota int;
  new_expires timestamptz;
  current_expires timestamptz;
begin
  select exists(
    select 1 from public.profiles pr
    where pr.user_id = auth.uid() and coalesce(pr.is_admin, false)
  ) into adm;

  if not adm then raise exception 'FORBIDDEN'; end if;

  select * into r from public.subscription_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;

  if p_approve then
    new_quota := case r.requested_tier
      when 'starter' then 30
      when 'creator' then 90
      when 'pro' then 250
      else 0
    end;

    select pr.plan_expires_at into current_expires
      from public.profiles pr where pr.user_id = r.user_id;
    if current_expires is not null and current_expires > now() then
      new_expires := current_expires + (r.months || ' months')::interval;
    else
      new_expires := now() + (r.months || ' months')::interval;
    end if;

    update public.profiles pr
    set tier = r.requested_tier,
        plan_expires_at = new_expires,
        monthly_quota = new_quota,
        monthly_used = 0,
        monthly_reset_at = now(),
        updated_at = now()
    where pr.user_id = r.user_id;

    update public.subscription_requests
    set status = 'approved',
        admin_note = p_admin_note,
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id;
  else
    update public.subscription_requests
    set status = 'rejected',
        admin_note = p_admin_note,
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id;
  end if;
end;
$$;

revoke all on function public.admin_review_subscription(uuid, boolean, text) from public;
grant execute on function public.admin_review_subscription(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Update refund_failed_job: creator is also a paid tier
-- ---------------------------------------------------------------------------
create or replace function public.refund_failed_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j record;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then return; end if;
  if j.refunded_at is not null then return; end if;
  if j.status not in ('failed', 'pending', 'running') then return; end if;

  if j.tier_used in ('starter', 'creator', 'pro') then
    update public.profiles pr
       set monthly_used = greatest(0, pr.monthly_used - 1),
           updated_at = now()
     where pr.user_id = j.user_id;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance + 1,
           updated_at = now()
     where pr.user_id = j.user_id;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      j.user_id,
      1,
      (select pr.credits_balance from public.profiles pr where pr.user_id = j.user_id),
      'job_failed_refund',
      'job',
      p_job_id
    );
  end if;

  update public.jobs set refunded_at = now(), updated_at = now() where id = p_job_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Update refund_pending_job similarly
-- ---------------------------------------------------------------------------
create or replace function public.refund_pending_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  j record;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into j from public.jobs
   where id = p_job_id and user_id = uid and status = 'pending'
     for update;
  if not found then raise exception 'NOT_FOUND_OR_NOT_PENDING'; end if;

  update public.jobs set status = 'failed', error_message = 'Dibatalkan pengguna', updated_at = now()
   where id = p_job_id;

  if j.tier_used in ('starter', 'creator', 'pro') then
    update public.profiles pr
       set monthly_used = greatest(0, pr.monthly_used - 1), updated_at = now()
     where pr.user_id = uid;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance + 1, updated_at = now()
     where pr.user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      1,
      (select pr.credits_balance from public.profiles pr where pr.user_id = uid),
      'job_cancelled_refund',
      'job',
      p_job_id
    );
  end if;
end;
$$;

revoke all on function public.refund_pending_job(uuid) from public;
grant execute on function public.refund_pending_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Update _maybe_reset_monthly_quota: handle creator tier expiry â†’ free
-- ---------------------------------------------------------------------------
drop function if exists public._maybe_reset_monthly_quota(uuid);
create or replace function public._maybe_reset_monthly_quota(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pr record;
begin
  select * into pr from public.profiles where user_id = p_uid for update;
  if not found then return; end if;

  if pr.tier in ('starter', 'creator', 'pro') then
    if pr.plan_expires_at is not null and pr.plan_expires_at < now() then
      update public.profiles
         set tier = 'free',
             monthly_quota = 0,
             monthly_used = 0,
             monthly_reset_at = null,
             plan_expires_at = null,
             updated_at = now()
       where user_id = p_uid;
      return;
    end if;

    if pr.monthly_reset_at is not null and pr.monthly_reset_at < now() then
      update public.profiles
         set monthly_used = 0,
             monthly_reset_at = now() + interval '30 days',
             updated_at = now()
       where user_id = p_uid;
    end if;
  end if;
end;
$$;

-- Fix admin Pro quota to 250
update public.profiles
   set monthly_quota = 250,
       updated_at = now()
 where is_admin = true and tier = 'pro' and monthly_quota <> 250;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 008_admin_billing_llm_model.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Admin: skip kuota/kredit + tampilkan beda billing di refund.
-- LLM: optional llm_model_id per provider (dipakai saat llm_preference = provider itu).

alter table public.jobs
  add column if not exists billing_debited boolean not null default true;

alter table public.profiles
  add column if not exists llm_model_id text;

comment on column public.jobs.billing_debited is
  'False = job admin/testing tanpa debit kuota/kredit (refund tidak mengembalikan apa pun).';

drop function if exists public.start_clip_job(text, text, text);

create or replace function public.start_clip_job(
  p_source_url text,
  p_source_kind text default 'url',
  p_source_storage_path text default null
)
returns table (
  job_id uuid,
  tier text,
  llm_preference text,
  llm_model_id text,
  worker_tier text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  p_tier text;
  p_pref text;
  p_model_id text;
  bal int;
  mq int;
  mu int;
  pending_count int;
  is_adm boolean := false;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (uid, 'free', 5, null)
  on conflict (user_id) do nothing;

  perform public._maybe_reset_monthly_quota(uid);

  select
    pr.tier,
    pr.credits_balance,
    pr.monthly_quota,
    pr.monthly_used,
    pr.llm_preference,
    pr.llm_model_id,
    coalesce(pr.is_admin, false)
  into p_tier, bal, mq, mu, p_pref, p_model_id, is_adm
  from public.profiles pr
  where pr.user_id = uid
  for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if not is_adm then
    select count(*) into pending_count
      from public.jobs j
     where j.user_id = uid and j.status in ('pending', 'running');
    if pending_count >= 3 then
      raise exception 'TOO_MANY_ACTIVE_JOBS';
    end if;
  end if;

  if not is_adm then
    if p_tier in ('starter', 'creator', 'pro') then
      if mu >= mq then
        raise exception 'MONTHLY_QUOTA_EXHAUSTED';
      end if;
    else
      if bal < 1 then
        raise exception 'INSUFFICIENT_CREDITS';
      end if;
    end if;
  end if;

  insert into public.jobs (
    user_id,
    source_url,
    status,
    tier_used,
    source_kind,
    source_storage_path,
    billing_debited
  )
  values (
    uid,
    p_source_url,
    'pending',
    p_tier,
    p_source_kind,
    p_source_storage_path,
    not is_adm
  )
  returning id into jid;

  if not is_adm then
    if p_tier in ('starter', 'creator', 'pro') then
      update public.profiles pr
         set monthly_used = pr.monthly_used + 1,
             updated_at = now()
       where pr.user_id = uid;
    else
      update public.profiles pr
         set credits_balance = pr.credits_balance - 1,
             updated_at = now()
       where pr.user_id = uid;

      insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
      values (
        uid,
        -1,
        (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
        'job_debit',
        'job',
        jid
      );
    end if;
  end if;

  return query
    select
      jid,
      p_tier,
      p_pref,
      p_model_id,
      (case when is_adm then 'pro' else p_tier end)::text;
end;
$$;

revoke all on function public.start_clip_job(text, text, text) from public;
grant execute on function public.start_clip_job(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- set_llm_preference: admin boleh pin provider; optional model id
-- ---------------------------------------------------------------------------
drop function if exists public.set_llm_preference(text);

-- Arg names p_1_pref / p_2_model_id: PostgREST binds JSON keys in alphabetical
-- order; (p_pref, p_model_id) resolves as (p_model_id, p_pref) and breaks RPC.
create or replace function public.set_llm_preference(
  p_1_pref text,
  p_2_model_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p_tier text;
  is_adm boolean := false;
  v_model text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_1_pref not in ('auto', 'groq', 'gemini', 'openai', 'anthropic') then
    raise exception 'INVALID_PREFERENCE';
  end if;

  select pr.tier, coalesce(pr.is_admin, false)
    into p_tier, is_adm
    from public.profiles pr
   where pr.user_id = uid;

  if p_tier not in ('creator', 'pro') and not is_adm and p_1_pref <> 'auto' then
    raise exception 'PAID_TIER_REQUIRED';
  end if;

  if p_1_pref = 'auto' then
    v_model := null;
  else
    v_model := nullif(trim(p_2_model_id), '');
  end if;

  update public.profiles pr
     set llm_preference = p_1_pref,
         llm_model_id = v_model,
         updated_at = now()
   where pr.user_id = uid;
end;
$$;

revoke all on function public.set_llm_preference(text, text) from public;
grant execute on function public.set_llm_preference(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_failed_job: jangan ubah kuota jika tidak pernah didebit
-- ---------------------------------------------------------------------------
create or replace function public.refund_failed_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j record;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then return; end if;
  if j.refunded_at is not null then return; end if;
  if j.status not in ('failed', 'pending', 'running') then return; end if;

  if coalesce(j.billing_debited, true) = false then
    update public.jobs set refunded_at = now(), updated_at = now() where id = p_job_id;
    return;
  end if;

  if j.tier_used in ('starter', 'creator', 'pro') then
    update public.profiles pr
       set monthly_used = greatest(0, pr.monthly_used - 1),
           updated_at = now()
     where pr.user_id = j.user_id;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance + 1,
           updated_at = now()
     where pr.user_id = j.user_id;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      j.user_id,
      1,
      (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = j.user_id),
      'job_failed_refund',
      'job',
      p_job_id
    );
  end if;

  update public.jobs set refunded_at = now(), updated_at = now() where id = p_job_id;
end;
$$;

revoke all on function public.refund_failed_job(uuid) from public;

-- ---------------------------------------------------------------------------
-- refund_pending_job
-- ---------------------------------------------------------------------------
create or replace function public.refund_pending_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  j record;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into j from public.jobs
   where id = p_job_id and user_id = uid and status = 'pending'
     for update;
  if not found then raise exception 'NOT_FOUND_OR_NOT_PENDING'; end if;

  update public.jobs set status = 'failed', error_message = 'Dibatalkan pengguna', updated_at = now()
   where id = p_job_id;

  if coalesce(j.billing_debited, true) = false then
    return;
  end if;

  if j.tier_used in ('starter', 'creator', 'pro') then
    update public.profiles pr
       set monthly_used = greatest(0, pr.monthly_used - 1), updated_at = now()
     where pr.user_id = uid;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance + 1, updated_at = now()
     where pr.user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      1,
      (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
      'job_cancelled_refund',
      'job',
      p_job_id
    );
  end if;
end;
$$;

revoke all on function public.refund_pending_job(uuid) from public;
grant execute on function public.refund_pending_job(uuid) to authenticated;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 009_admin_skip_plan_expiry_downgrade.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Jangan turunkan tier admin ke "free" saat plan_expires_at lewat (operator account).
-- Pulihkan admin yang sempat ter-downgrade oleh bug tersebut.

create or replace function public._maybe_reset_monthly_quota(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pr record;
begin
  select * into pr from public.profiles where user_id = p_uid for update;
  if not found then return; end if;

  if pr.tier in ('starter', 'creator', 'pro') then
    if pr.plan_expires_at is not null and pr.plan_expires_at < now() then
      -- Admin: jangan ubah tier/kuota billing; hapus tanggal kedaluwarsa agar tidak loop.
      if coalesce(pr.is_admin, false) then
        update public.profiles
           set plan_expires_at = null,
               updated_at = now()
         where user_id = p_uid;
        return;
      end if;

      update public.profiles
         set tier = 'free',
             monthly_quota = 0,
             monthly_used = 0,
             monthly_reset_at = null,
             plan_expires_at = null,
             updated_at = now()
       where user_id = p_uid;
      return;
    end if;

    if pr.monthly_reset_at is not null and pr.monthly_reset_at < now() then
      update public.profiles
         set monthly_used = 0,
             monthly_reset_at = now() + interval '30 days',
             updated_at = now()
       where user_id = p_uid;
    end if;
  end if;
end;
$$;

-- Akun admin yang sempat jatuh ke free karena bug expiry: pulihkan billing Pro operator.
update public.profiles pr
   set tier = 'pro',
       monthly_quota = 250,
       monthly_used = 0,
       plan_expires_at = null,
       updated_at = now()
 where coalesce(pr.is_admin, false)
   and pr.tier = 'free';



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 010_set_llm_preference_rpc_argnames.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Repair / idempotent: kolom llm_model_id + RPC set_llm_preference.
-- Jalankan jika error: column "llm_model_id" of relation "profiles" does not exist,
-- atau PostgREST tidak menemukan set_llm_preference dengan argumen yang benar.

alter table public.profiles
  add column if not exists llm_model_id text;

alter table public.jobs
  add column if not exists billing_debited boolean not null default true;

-- Arg names p_1_pref / p_2_model_id: PostgREST mengikat JSON keys urut alfabet;
-- (p_pref, p_model_id) jadi (p_model_id, p_pref) dan tidak cocok fungsi SQL.

drop function if exists public.set_llm_preference(text, text);
drop function if exists public.set_llm_preference(text);

create or replace function public.set_llm_preference(
  p_1_pref text,
  p_2_model_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p_tier text;
  is_adm boolean := false;
  v_model text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_1_pref not in ('auto', 'groq', 'gemini', 'openai', 'anthropic') then
    raise exception 'INVALID_PREFERENCE';
  end if;

  select pr.tier, coalesce(pr.is_admin, false)
    into p_tier, is_adm
    from public.profiles pr
   where pr.user_id = uid;

  if p_tier not in ('creator', 'pro') and not is_adm and p_1_pref <> 'auto' then
    raise exception 'PAID_TIER_REQUIRED';
  end if;

  if p_1_pref = 'auto' then
    v_model := null;
  else
    v_model := nullif(trim(p_2_model_id), '');
  end if;

  update public.profiles pr
     set llm_preference = p_1_pref,
         llm_model_id = v_model,
         updated_at = now()
   where pr.user_id = uid;
end;
$$;

revoke all on function public.set_llm_preference(text, text) from public;
grant execute on function public.set_llm_preference(text, text) to authenticated;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 011_llm_preference_by_subscription_tier.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Selaraskan pemilihan LLM dengan paket: Starter â†’ auto+groq+gemini;
-- Creator â†’ +openai; Pro â†’ semua; Free â†’ auto saja (kecuali admin).

create or replace function public.set_llm_preference(
  p_1_pref text,
  p_2_model_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p_tier text;
  is_adm boolean := false;
  v_model text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_1_pref not in ('auto', 'groq', 'gemini', 'openai', 'anthropic') then
    raise exception 'INVALID_PREFERENCE';
  end if;

  select pr.tier, coalesce(pr.is_admin, false)
    into p_tier, is_adm
    from public.profiles pr
   where pr.user_id = uid;

  if not is_adm and p_tier = 'free' and p_1_pref <> 'auto' then
    raise exception 'PAID_TIER_REQUIRED';
  end if;

  if not is_adm and p_tier = 'starter' and p_1_pref not in ('auto', 'groq', 'gemini') then
    raise exception 'LLM_PREF_NOT_ALLOWED_FOR_TIER';
  end if;

  if not is_adm and p_tier = 'creator' and p_1_pref not in ('auto', 'groq', 'gemini', 'openai') then
    raise exception 'LLM_PREF_NOT_ALLOWED_FOR_TIER';
  end if;

  if p_1_pref = 'auto' then
    v_model := null;
  else
    v_model := nullif(trim(p_2_model_id), '');
  end if;

  update public.profiles pr
     set llm_preference = p_1_pref,
         llm_model_id = v_model,
         updated_at = now()
   where pr.user_id = uid;
end;
$$;

revoke all on function public.set_llm_preference(text, text) from public;
grant execute on function public.set_llm_preference(text, text) to authenticated;

-- Bersihkan preferensi yang tidak valid setelah aturan baru
update public.profiles pr
   set llm_preference = 'auto',
       llm_model_id = null,
       updated_at = now()
 where pr.tier = 'starter'
   and pr.llm_preference is not null
   and pr.llm_preference not in ('auto', 'groq', 'gemini');

update public.profiles pr
   set llm_preference = 'auto',
       llm_model_id = null,
       updated_at = now()
 where pr.tier = 'creator'
   and pr.llm_preference is not null
   and pr.llm_preference not in ('auto', 'groq', 'gemini', 'openai');



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 012_llm_model_catalog_cache.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Cache hasil fetch daftar model dari Groq / Gemini / OpenAI(OpenRouter).
-- Diperbarui oleh cron atau admin; pengguna terautentikasi boleh baca (RLS).

create table if not exists public.llm_model_catalog_cache (
  provider text primary key
    check (provider in ('groq', 'gemini', 'openai')),
  models jsonb not null default '[]'::jsonb,
  fetch_error text,
  updated_at timestamptz not null default now(),
  last_success_at timestamptz
);

comment on table public.llm_model_catalog_cache is
  'Provider model ID list for dashboard hints; service role upserts via Next.js cron/admin.';

alter table public.llm_model_catalog_cache enable row level security;

create policy "llm_model_catalog_cache_select_authenticated"
  on public.llm_model_catalog_cache
  for select
  to authenticated
  using (true);



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 013_operator_llm_api_key_pool.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Stok API key LLM operator (terenkripsi app-side). Akses hanya lewat service role / server.

create table if not exists public.operator_llm_api_key_pool (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (provider in ('groq', 'gemini', 'openai', 'anthropic')),
  label text not null default '',
  key_hint text not null default '',
  secret_ciphertext text not null,
  sort_order int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists operator_llm_api_key_pool_provider_order_idx
  on public.operator_llm_api_key_pool (provider, sort_order, id);

comment on table public.operator_llm_api_key_pool is
  'Encrypted LLM API keys for operator rotation; decrypted only with API_KEY_POOL_MASTER_SECRET on server/worker.';

alter table public.operator_llm_api_key_pool enable row level security;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 014_openrouter_provider_split.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Pisahkan penyedia katalog / pool: tambah `openrouter` (selain `openai` resmi).

alter table public.operator_llm_api_key_pool
  drop constraint if exists operator_llm_api_key_pool_provider_check;

alter table public.operator_llm_api_key_pool
  add constraint operator_llm_api_key_pool_provider_check
  check (provider in ('groq', 'gemini', 'openai', 'anthropic', 'openrouter'));

alter table public.llm_model_catalog_cache
  drop constraint if exists llm_model_catalog_cache_provider_check;

alter table public.llm_model_catalog_cache
  add constraint llm_model_catalog_cache_provider_check
  check (provider in ('groq', 'gemini', 'openai', 'openrouter'));



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 015_tier_api_keys_and_watermark_prefs.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Stok API key per tier langganan + preferensi watermark (tier berbayar).

alter table public.operator_llm_api_key_pool
  add column if not exists applies_to_tier text
    check (applies_to_tier is null or applies_to_tier in ('free', 'starter', 'creator', 'pro'));

comment on column public.operator_llm_api_key_pool.applies_to_tier is
  'NULL = berlaku semua tier; selain itu key hanya dipakai job dengan tier_used yang cocok.';

create index if not exists operator_llm_api_key_pool_provider_tier_idx
  on public.operator_llm_api_key_pool (provider, applies_to_tier, sort_order);

alter table public.profiles
  add column if not exists watermark_paid_enabled boolean not null default false,
  add column if not exists watermark_custom_text text,
  add column if not exists watermark_position text not null default 'bottom_right'
    check (watermark_position in ('top_left', 'top_right', 'bottom_left', 'bottom_right', 'center'));

comment on column public.profiles.watermark_paid_enabled is
  'Starter+: aktifkan watermark kustom (teks + posisi). Free selalu watermark ringan operator.';
comment on column public.profiles.watermark_custom_text is 'Teks watermark untuk tier berbayar bila watermark_paid_enabled.';
comment on column public.profiles.watermark_position is 'Posisi drawtext ffmpeg untuk watermark berbayar.';

-- ---------------------------------------------------------------------------
-- start_clip_job: kembalikan preferensi watermark untuk worker env
-- ---------------------------------------------------------------------------
drop function if exists public.start_clip_job(text, text, text);

create or replace function public.start_clip_job(
  p_source_url text,
  p_source_kind text default 'url',
  p_source_storage_path text default null
)
returns table (
  job_id uuid,
  tier text,
  llm_preference text,
  llm_model_id text,
  worker_tier text,
  watermark_paid_enabled boolean,
  watermark_custom_text text,
  watermark_position text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  p_tier text;
  p_pref text;
  p_model_id text;
  bal int;
  mq int;
  mu int;
  pending_count int;
  is_adm boolean := false;
  p_wm_paid boolean := false;
  p_wm_text text := null;
  p_wm_pos text := 'bottom_right';
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (uid, 'free', 5, null)
  on conflict (user_id) do nothing;

  perform public._maybe_reset_monthly_quota(uid);

  select
    pr.tier,
    pr.credits_balance,
    pr.monthly_quota,
    pr.monthly_used,
    pr.llm_preference,
    pr.llm_model_id,
    coalesce(pr.is_admin, false),
    coalesce(pr.watermark_paid_enabled, false),
    nullif(trim(pr.watermark_custom_text), ''),
    coalesce(nullif(trim(pr.watermark_position), ''), 'bottom_right')
  into p_tier, bal, mq, mu, p_pref, p_model_id, is_adm, p_wm_paid, p_wm_text, p_wm_pos
  from public.profiles pr
  where pr.user_id = uid
  for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if not is_adm then
    select count(*) into pending_count
      from public.jobs j
     where j.user_id = uid and j.status in ('pending', 'running');
    if pending_count >= 3 then
      raise exception 'TOO_MANY_ACTIVE_JOBS';
    end if;
  end if;

  if not is_adm then
    if p_tier in ('starter', 'creator', 'pro') then
      if mu >= mq then
        raise exception 'MONTHLY_QUOTA_EXHAUSTED';
      end if;
    else
      if bal < 1 then
        raise exception 'INSUFFICIENT_CREDITS';
      end if;
    end if;
  end if;

  insert into public.jobs (
    user_id,
    source_url,
    status,
    tier_used,
    source_kind,
    source_storage_path,
    billing_debited
  )
  values (
    uid,
    p_source_url,
    'pending',
    p_tier,
    p_source_kind,
    p_source_storage_path,
    not is_adm
  )
  returning id into jid;

  if not is_adm then
    if p_tier in ('starter', 'creator', 'pro') then
      update public.profiles pr
         set monthly_used = pr.monthly_used + 1,
             updated_at = now()
       where pr.user_id = uid;
    else
      update public.profiles pr
         set credits_balance = pr.credits_balance - 1,
             updated_at = now()
       where pr.user_id = uid;

      insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
      values (
        uid,
        -1,
        (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
        'job_debit',
        'job',
        jid
      );
    end if;
  end if;

  return query
    select
      jid,
      p_tier,
      p_pref,
      p_model_id,
      (case when is_adm then 'pro' else p_tier end)::text,
      p_wm_paid,
      p_wm_text,
      p_wm_pos;
end;
$$;

revoke all on function public.start_clip_job(text, text, text) from public;
grant execute on function public.start_clip_job(text, text, text) to authenticated;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 016_set_watermark_preferences_rpc.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Preferensi watermark berbayar: update via RPC security definer (profiles tidak punya policy UPDATE untuk user).

create or replace function public.set_watermark_preferences(
  p_enabled boolean,
  p_custom_text text default null,
  p_position text default 'bottom_right'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p_tier text;
  is_adm boolean := false;
  v_pos text;
  v_text text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_pos := coalesce(nullif(trim(p_position), ''), 'bottom_right');
  if v_pos not in ('top_left', 'top_right', 'bottom_left', 'bottom_right', 'center') then
    raise exception 'INVALID_WATERMARK_POSITION';
  end if;

  select pr.tier, coalesce(pr.is_admin, false)
    into p_tier, is_adm
    from public.profiles pr
   where pr.user_id = uid;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if not is_adm and p_tier = 'free' then
    raise exception 'WATERMARK_PREFS_PAID_ONLY';
  end if;

  v_text := nullif(left(trim(coalesce(p_custom_text, '')), 120), '');

  if p_enabled and v_text is null then
    raise exception 'WATERMARK_TEXT_REQUIRED_WHEN_ENABLED';
  end if;

  update public.profiles pr
     set watermark_paid_enabled = p_enabled,
         watermark_custom_text = case when p_enabled then v_text else null end,
         watermark_position = case when p_enabled then v_pos else 'bottom_right' end,
         updated_at = now()
   where pr.user_id = uid;
end;
$$;

revoke all on function public.set_watermark_preferences(boolean, text, text) from public;
grant execute on function public.set_watermark_preferences(boolean, text, text) to authenticated;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 017_quota_credit_fallback_and_retention.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- 1) Job billing: tier berbayar bisa debit kredit bila kuota bulanan penuh.
-- 2) Bonus kredit saat subscription disetujui.
-- 3) Default retention purge 10 hari.

alter table public.jobs
  add column if not exists billing_debit_kind text
    check (billing_debit_kind is null or billing_debit_kind in ('monthly', 'credit'));

comment on column public.jobs.billing_debit_kind is
  'monthly = pakai kuota bulanan; credit = 1 kredit (tier berbayar saat kuota habis, atau free).';

-- ---------------------------------------------------------------------------
-- start_clip_job: paid tier â€” jika kuota habis tapi masih ada kredit, debit kredit.
-- ---------------------------------------------------------------------------
drop function if exists public.start_clip_job(text, text, text);

create or replace function public.start_clip_job(
  p_source_url text,
  p_source_kind text default 'url',
  p_source_storage_path text default null
)
returns table (
  job_id uuid,
  tier text,
  llm_preference text,
  llm_model_id text,
  worker_tier text,
  watermark_paid_enabled boolean,
  watermark_custom_text text,
  watermark_position text,
  used_credit_fallback boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  p_tier text;
  p_pref text;
  p_model_id text;
  bal int;
  mq int;
  mu int;
  pending_count int;
  is_adm boolean := false;
  p_wm_paid boolean := false;
  p_wm_text text := null;
  p_wm_pos text := 'bottom_right';
  debit_kind text := null;
  used_fb boolean := false;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (uid, 'free', 5, null)
  on conflict (user_id) do nothing;

  perform public._maybe_reset_monthly_quota(uid);

  select
    pr.tier,
    pr.credits_balance,
    pr.monthly_quota,
    pr.monthly_used,
    pr.llm_preference,
    pr.llm_model_id,
    coalesce(pr.is_admin, false),
    coalesce(pr.watermark_paid_enabled, false),
    nullif(trim(pr.watermark_custom_text), ''),
    coalesce(nullif(trim(pr.watermark_position), ''), 'bottom_right')
  into p_tier, bal, mq, mu, p_pref, p_model_id, is_adm, p_wm_paid, p_wm_text, p_wm_pos
  from public.profiles pr
  where pr.user_id = uid
  for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if not is_adm then
    select count(*) into pending_count
      from public.jobs j
     where j.user_id = uid and j.status in ('pending', 'running');
    if pending_count >= 3 then
      raise exception 'TOO_MANY_ACTIVE_JOBS';
    end if;
  end if;

  if not is_adm then
    if p_tier in ('starter', 'creator', 'pro') then
      if mu < mq then
        debit_kind := 'monthly';
      elsif bal >= 1 then
        debit_kind := 'credit';
        used_fb := true;
      else
        raise exception 'MONTHLY_QUOTA_EXHAUSTED';
      end if;
    else
      if bal < 1 then
        raise exception 'INSUFFICIENT_CREDITS';
      end if;
      debit_kind := 'credit';
    end if;
  end if;

  insert into public.jobs (
    user_id,
    source_url,
    status,
    tier_used,
    source_kind,
    source_storage_path,
    billing_debited,
    billing_debit_kind
  )
  values (
    uid,
    p_source_url,
    'pending',
    p_tier,
    p_source_kind,
    p_source_storage_path,
    not is_adm,
    case when is_adm then null else debit_kind end
  )
  returning id into jid;

  if not is_adm then
    if p_tier in ('starter', 'creator', 'pro') then
      if debit_kind = 'monthly' then
        update public.profiles pr
           set monthly_used = pr.monthly_used + 1,
               updated_at = now()
         where pr.user_id = uid;
      else
        update public.profiles pr
           set credits_balance = pr.credits_balance - 1,
               updated_at = now()
         where pr.user_id = uid;

        insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
        values (
          uid,
          -1,
          (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
          'job_debit_after_quota',
          'job',
          jid
        );
      end if;
    else
      update public.profiles pr
         set credits_balance = pr.credits_balance - 1,
             updated_at = now()
       where pr.user_id = uid;

      insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
      values (
        uid,
        -1,
        (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
        'job_debit',
        'job',
        jid
      );
    end if;
  end if;

  return query
    select
      jid,
      p_tier,
      p_pref,
      p_model_id,
      (case when is_adm then 'pro' else p_tier end)::text,
      p_wm_paid,
      p_wm_text,
      p_wm_pos,
      used_fb;
end;
$$;

revoke all on function public.start_clip_job(text, text, text) from public;
grant execute on function public.start_clip_job(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_failed_job
-- ---------------------------------------------------------------------------
create or replace function public.refund_failed_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j record;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then return; end if;
  if j.refunded_at is not null then return; end if;
  if j.status not in ('failed', 'pending', 'running') then return; end if;

  if coalesce(j.billing_debited, true) = false then
    update public.jobs set refunded_at = now(), updated_at = now() where id = p_job_id;
    return;
  end if;

  if j.tier_used in ('starter', 'creator', 'pro') then
    if coalesce(j.billing_debit_kind, 'monthly') = 'credit' then
      update public.profiles pr
         set credits_balance = pr.credits_balance + 1,
             updated_at = now()
       where pr.user_id = j.user_id;

      insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
      values (
        j.user_id,
        1,
        (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = j.user_id),
        'job_failed_refund',
        'job',
        p_job_id
      );
    else
      update public.profiles pr
         set monthly_used = greatest(0, pr.monthly_used - 1),
             updated_at = now()
       where pr.user_id = j.user_id;
    end if;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance + 1,
           updated_at = now()
     where pr.user_id = j.user_id;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      j.user_id,
      1,
      (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = j.user_id),
      'job_failed_refund',
      'job',
      p_job_id
    );
  end if;

  update public.jobs set refunded_at = now(), updated_at = now() where id = p_job_id;
end;
$$;

revoke all on function public.refund_failed_job(uuid) from public;

-- ---------------------------------------------------------------------------
-- refund_pending_job
-- ---------------------------------------------------------------------------
create or replace function public.refund_pending_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  j record;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into j from public.jobs
   where id = p_job_id and user_id = uid and status = 'pending'
     for update;
  if not found then raise exception 'NOT_FOUND_OR_NOT_PENDING'; end if;

  update public.jobs set status = 'failed', error_message = 'Dibatalkan pengguna', updated_at = now()
   where id = p_job_id;

  if coalesce(j.billing_debited, true) = false then
    return;
  end if;

  if j.tier_used in ('starter', 'creator', 'pro') then
    if coalesce(j.billing_debit_kind, 'monthly') = 'credit' then
      update public.profiles pr
         set credits_balance = pr.credits_balance + 1,
             updated_at = now()
       where pr.user_id = uid;

      insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
      values (
        uid,
        1,
        (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
        'job_cancelled_refund',
        'job',
        p_job_id
      );
    else
      update public.profiles pr
         set monthly_used = greatest(0, pr.monthly_used - 1), updated_at = now()
       where pr.user_id = uid;
    end if;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance + 1, updated_at = now()
     where pr.user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      1,
      (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
      'job_cancelled_refund',
      'job',
      p_job_id
    );
  end if;
end;
$$;

revoke all on function public.refund_pending_job(uuid) from public;
grant execute on function public.refund_pending_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_review_subscription: bonus kredit per tier saat disetujui
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_subscription(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  adm boolean;
  r record;
  new_quota int;
  new_expires timestamptz;
  current_expires timestamptz;
  bonus int := 0;
begin
  select exists(
    select 1 from public.profiles pr
    where pr.user_id = auth.uid() and coalesce(pr.is_admin, false)
  ) into adm;

  if not adm then raise exception 'FORBIDDEN'; end if;

  select * into r from public.subscription_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;

  if p_approve then
    new_quota := case r.requested_tier
      when 'starter' then 30
      when 'creator' then 90
      when 'pro' then 250
      else 0
    end;

    bonus := case r.requested_tier
      when 'starter' then 15
      when 'creator' then 35
      when 'pro' then 60
      else 0
    end;

    select pr.plan_expires_at into current_expires
      from public.profiles pr where pr.user_id = r.user_id;
    if current_expires is not null and current_expires > now() then
      new_expires := current_expires + (r.months || ' months')::interval;
    else
      new_expires := now() + (r.months || ' months')::interval;
    end if;

    update public.profiles pr
    set tier = r.requested_tier,
        plan_expires_at = new_expires,
        monthly_quota = new_quota,
        monthly_used = 0,
        monthly_reset_at = now(),
        credits_balance = pr.credits_balance + bonus,
        updated_at = now()
    where pr.user_id = r.user_id;

    if bonus > 0 then
      insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
      values (
        r.user_id,
        bonus,
        (select pr3.credits_balance from public.profiles pr3 where pr3.user_id = r.user_id),
        'subscription_bonus',
        'subscription_request',
        p_request_id
      );
    end if;

    update public.subscription_requests
    set status = 'approved',
        admin_note = p_admin_note,
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id;
  else
    update public.subscription_requests
    set status = 'rejected',
        admin_note = p_admin_note,
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id;
  end if;
end;
$$;

revoke all on function public.admin_review_subscription(uuid, boolean, text) from public;
grant execute on function public.admin_review_subscription(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- purge_old_jobs: default 10 hari (skrip Node mengharapkan job_id + path)
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_jobs(p_days int default 10)
returns table (job_id uuid, source_storage_path text, clips_storage_prefix text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with deleted as (
    delete from public.jobs
    where created_at < now() - (greatest(1, p_days) || ' days')::interval
    returning id, source_storage_path, clips_storage_prefix
  )
  select id, source_storage_path, clips_storage_prefix from deleted;
end;
$$;

revoke all on function public.purge_old_jobs(int) from public;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 018_password_lockout_and_subscription_bonus.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Lockout ganti password + bonus subscription (angka selaras web/lib/credits-pricing.ts).

alter table public.profiles
  add column if not exists password_change_failures smallint not null default 0
    check (password_change_failures >= 0 and password_change_failures <= 50),
  add column if not exists password_change_lockout_until timestamptz;

comment on column public.profiles.password_change_failures is
  'Kegagalan verifikasi password lama saat ganti password (via app).';
comment on column public.profiles.password_change_lockout_until is
  'Jika > now(), form ganti password dinonaktifkan â€” pakai reset email.';

-- Panggil setelah password lama salah (client verifikasi via signIn).
create or replace function public.touch_password_change_failure()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  nf int;
  lu timestamptz;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select pr.password_change_lockout_until
    into lu
    from public.profiles pr
   where pr.user_id = uid
   for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if lu is not null and lu <= now() then
    update public.profiles pr
       set password_change_failures = 0,
           password_change_lockout_until = null,
           updated_at = now()
     where pr.user_id = uid;
    lu := null;
  end if;

  if lu is not null and lu > now() then
    return json_build_object(
      'locked', true,
      'lockout_until', lu,
      'failures', (select pr2.password_change_failures from public.profiles pr2 where pr2.user_id = uid)
    );
  end if;

  update public.profiles pr
     set password_change_failures = pr.password_change_failures + 1,
         updated_at = now()
   where pr.user_id = uid
   returning pr.password_change_failures into nf;

  if nf >= 5 then
    update public.profiles pr
       set password_change_lockout_until = now() + interval '24 hours',
           updated_at = now()
     where pr.user_id = uid;
  end if;

  select pr.password_change_lockout_until, pr.password_change_failures
    into lu, nf
    from public.profiles pr
   where pr.user_id = uid;

  return json_build_object(
    'locked', lu is not null and lu > now(),
    'lockout_until', lu,
    'failures', nf
  );
end;
$$;

revoke all on function public.touch_password_change_failure() from public;
grant execute on function public.touch_password_change_failure() to authenticated;

-- Panggil setelah ganti password sukses atau setelah reset password dari email.
create or replace function public.clear_password_change_tracking()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  update public.profiles pr
     set password_change_failures = 0,
         password_change_lockout_until = null,
         updated_at = now()
   where pr.user_id = uid;
end;
$$;

revoke all on function public.clear_password_change_tracking() from public;
grant execute on function public.clear_password_change_tracking() to authenticated;

-- Bonus kredit approval â€” nilai selaras web/lib/credits-pricing.ts SUBSCRIPTION_APPROVAL_BONUS_CREDITS
create or replace function public.admin_review_subscription(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  adm boolean;
  r record;
  new_quota int;
  new_expires timestamptz;
  current_expires timestamptz;
  bonus int := 0;
begin
  select exists(
    select 1 from public.profiles pr
    where pr.user_id = auth.uid() and coalesce(pr.is_admin, false)
  ) into adm;

  if not adm then raise exception 'FORBIDDEN'; end if;

  select * into r from public.subscription_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;

  if p_approve then
    new_quota := case r.requested_tier
      when 'starter' then 30
      when 'creator' then 90
      when 'pro' then 250
      else 0
    end;

    bonus := case r.requested_tier
      when 'starter' then 16
      when 'creator' then 38
      when 'pro' then 72
      else 0
    end;

    select pr.plan_expires_at into current_expires
      from public.profiles pr where pr.user_id = r.user_id;
    if current_expires is not null and current_expires > now() then
      new_expires := current_expires + (r.months || ' months')::interval;
    else
      new_expires := now() + (r.months || ' months')::interval;
    end if;

    update public.profiles pr
    set tier = r.requested_tier,
        plan_expires_at = new_expires,
        monthly_quota = new_quota,
        monthly_used = 0,
        monthly_reset_at = now(),
        credits_balance = pr.credits_balance + bonus,
        updated_at = now()
    where pr.user_id = r.user_id;

    if bonus > 0 then
      insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
      values (
        r.user_id,
        bonus,
        (select pr3.credits_balance from public.profiles pr3 where pr3.user_id = r.user_id),
        'subscription_bonus',
        'subscription_request',
        p_request_id
      );
    end if;

    update public.subscription_requests
    set status = 'approved',
        admin_note = p_admin_note,
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id;
  else
    update public.subscription_requests
    set status = 'rejected',
        admin_note = p_admin_note,
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id;
  end if;
end;
$$;

revoke all on function public.admin_review_subscription(uuid, boolean, text) from public;
grant execute on function public.admin_review_subscription(uuid, boolean, text) to authenticated;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 019_subscription_bonus_align_tiers.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

    -- Selaras `web/lib/tiers.ts` bonusCreditsOnSubscription (Starter 12, Creator 30, Pro 52).

    create or replace function public.admin_review_subscription(
      p_request_id uuid,
      p_approve boolean,
      p_admin_note text default null
    )
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      adm boolean;
      r record;
      new_quota int;
      new_expires timestamptz;
      current_expires timestamptz;
      bonus int := 0;
    begin
      select exists(
        select 1 from public.profiles pr
        where pr.user_id = auth.uid() and coalesce(pr.is_admin, false)
      ) into adm;

      if not adm then raise exception 'FORBIDDEN'; end if;

      select * into r from public.subscription_requests where id = p_request_id for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      if r.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;

      if p_approve then
        new_quota := case r.requested_tier
          when 'starter' then 30
          when 'creator' then 90
          when 'pro' then 250
          else 0
        end;

        bonus := case r.requested_tier
          when 'starter' then 12
          when 'creator' then 30
          when 'pro' then 52
          else 0
        end;

        select pr.plan_expires_at into current_expires
          from public.profiles pr where pr.user_id = r.user_id;
        if current_expires is not null and current_expires > now() then
          new_expires := current_expires + (r.months || ' months')::interval;
        else
          new_expires := now() + (r.months || ' months')::interval;
        end if;

        update public.profiles pr
        set tier = r.requested_tier,
            plan_expires_at = new_expires,
            monthly_quota = new_quota,
            monthly_used = 0,
            monthly_reset_at = now(),
            credits_balance = pr.credits_balance + bonus,
            updated_at = now()
        where pr.user_id = r.user_id;

        if bonus > 0 then
          insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
          values (
            r.user_id,
            bonus,
            (select pr3.credits_balance from public.profiles pr3 where pr3.user_id = r.user_id),
            'subscription_bonus',
            'subscription_request',
            p_request_id
          );
        end if;

        update public.subscription_requests
        set status = 'approved',
            admin_note = p_admin_note,
            reviewed_at = now(),
            updated_at = now()
        where id = p_request_id;
      else
        update public.subscription_requests
        set status = 'rejected',
            admin_note = p_admin_note,
            reviewed_at = now(),
            updated_at = now()
        where id = p_request_id;
      end if;
    end;
    $$;

    revoke all on function public.admin_review_subscription(uuid, boolean, text) from public;
    grant execute on function public.admin_review_subscription(uuid, boolean, text) to authenticated;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 020_profiles_watermark_columns_if_missing.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Kolom watermark pada profiles diperlukan oleh start_clip_job (017+).
-- Jika migrasi 015 tidak pernah dijalankan, RPC gagal: "column pr.watermark_paid_enabled does not exist".

alter table public.profiles
  add column if not exists watermark_paid_enabled boolean not null default false;

alter table public.profiles
  add column if not exists watermark_custom_text text;

alter table public.profiles
  add column if not exists watermark_position text not null default 'bottom_right';

comment on column public.profiles.watermark_paid_enabled is
  'Starter+: aktifkan watermark kustom (teks + posisi). Free selalu watermark ringan operator.';
comment on column public.profiles.watermark_custom_text is
  'Teks watermark untuk tier berbayar bila watermark_paid_enabled.';
comment on column public.profiles.watermark_position is
  'Posisi drawtext ffmpeg untuk watermark berbayar; free memakai sudut bawah dari worker.';



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 021_llm_key_runtime_storage_monitoring.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Runtime status API key pool (cooldown, probe, health) + event ringan (retensi 10 hari)
-- + snapshot storage agregat + opsi profil bantuan teknis + RPC ukuran bucket (murah).

alter table public.operator_llm_api_key_pool
  add column if not exists health_status text not null default 'unknown'
    check (health_status in ('unknown', 'healthy', 'cooldown', 'degraded', 'error'));

alter table public.operator_llm_api_key_pool
  add column if not exists cooldown_until timestamptz;

alter table public.operator_llm_api_key_pool
  add column if not exists next_probe_at timestamptz;

alter table public.operator_llm_api_key_pool
  add column if not exists last_error text;

alter table public.operator_llm_api_key_pool
  add column if not exists probe_fail_streak int not null default 0;

alter table public.operator_llm_api_key_pool
  add column if not exists last_success_at timestamptz;

comment on column public.operator_llm_api_key_pool.health_status is
  'healthy = siap; cooldown = rate limit / backoff; degraded/error = probe gagal berulang.';
comment on column public.operator_llm_api_key_pool.next_probe_at is
  'Worker/cron probe sebelum menandai key siap lagi setelah cooldown.';

-- Event audit ringan (tanpa ciphertext); purge >10 hari via cron.
create table if not exists public.llm_key_limit_events (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid references public.operator_llm_api_key_pool (id) on delete set null,
  provider text not null,
  event_kind text not null,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists llm_key_limit_events_created_at_idx
  on public.llm_key_limit_events (created_at desc);

create index if not exists llm_key_limit_events_pool_idx
  on public.llm_key_limit_events (pool_id, created_at desc);

alter table public.llm_key_limit_events enable row level security;

comment on table public.llm_key_limit_events is
  'Event pool key (429, cooldown, probe). Retensi disarankan 10 hari â€” hapus lewat cron.';

-- Debounce email alert "provider tanpa key siap".
create table if not exists public.operator_provider_alert_sent (
  provider text primary key,
  last_sent_at timestamptz not null default now()
);

comment on table public.operator_provider_alert_sent is
  'Catatan waktu terakhir email alert per provider (hindari spam).';

alter table public.operator_provider_alert_sent enable row level security;

-- Snapshot agregat storage (tanpa path file / user).
create table if not exists public.platform_storage_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  bucket_bytes jsonb not null default '{}'::jsonb,
  total_bytes bigint not null default 0,
  worker_disk_bytes_est bigint,
  storage_cost_usd_est numeric(18, 8),
  notes text
);

create index if not exists platform_storage_snapshots_taken_at_idx
  on public.platform_storage_snapshots (taken_at desc);

alter table public.platform_storage_snapshots enable row level security;

comment on table public.platform_storage_snapshots is
  'Ringkasan byte per bucket + estimasi biaya; isi lewat cron service_role.';

-- Profil: izin agregat log saat bantuan teknis (detail tetap minimal / tanpa konten video).
alter table public.profiles
  add column if not exists support_logs_opt_in boolean not null default false;

comment on column public.profiles.support_logs_opt_in is
  'Jika true, operator boleh mengakses log/job terkait akun untuk bantuan teknis (user memilih).';

create or replace function public.set_support_logs_opt_in(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set support_logs_opt_in = p_enabled,
      updated_at = now()
  where user_id = auth.uid();
end;
$$;

revoke all on function public.set_support_logs_opt_in(boolean) from public;
grant execute on function public.set_support_logs_opt_in(boolean) to authenticated;

-- Agregat byte per bucket (satu query) â€” hanya service_role.
create or replace function public.operator_storage_bucket_bytes()
returns jsonb
language sql
security definer
set search_path = public, storage
stable
as $$
  select coalesce(
    jsonb_object_agg(name, to_jsonb(bytes)),
    '{}'::jsonb
  )
  from (
    select b.name::text as name,
           coalesce(sum((nullif(o.metadata->>'size', ''))::bigint), 0)::bigint as bytes
    from storage.objects o
    join storage.buckets b on b.id = o.bucket_id
    group by b.name
  ) sub;
$$;

revoke all on function public.operator_storage_bucket_bytes() from public;
grant execute on function public.operator_storage_bucket_bytes() to service_role;

-- Catatan: jangan buka SELECT RLS anon/authenticated pada `operator_llm_api_key_pool`
-- (ada secret_ciphertext). Admin UI memakai route API + service_role; polling/refetch
-- untuk status realtime tanpa membocorkan ciphertext ke browser.



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 022_ai_generator_jobs.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- AI generator jobs (phase 1 image + phase 2 video) with shared credits.

alter table public.jobs
  add column if not exists job_type text not null default 'clipper',
  add column if not exists ai_prompt text,
  add column if not exists ai_model text,
  add column if not exists ai_aspect_ratio text,
  add column if not exists ai_duration_sec int,
  add column if not exists billing_credits int not null default 1;

alter table public.jobs
  drop constraint if exists jobs_job_type_check;
alter table public.jobs
  add constraint jobs_job_type_check
  check (job_type in ('clipper', 'image_gen', 'video_gen'));

alter table public.jobs
  drop constraint if exists jobs_source_kind_check;
alter table public.jobs
  add constraint jobs_source_kind_check
  check (source_kind in ('url', 'upload', 'ai_image', 'ai_video'));

comment on column public.jobs.job_type is
  'clipper = clip extraction pipeline, image_gen = generate image asset, video_gen = generate video asset.';
comment on column public.jobs.billing_credits is
  'How many credits were debited when billing_debit_kind=credit (for refund symmetry).';

drop function if exists public.start_ai_job(text, text, text, text, int);
create or replace function public.start_ai_job(
  p_job_type text,
  p_prompt text,
  p_model text default null,
  p_aspect_ratio text default '1:1',
  p_duration_sec int default null
)
returns table (
  job_id uuid,
  tier text,
  worker_tier text,
  cost_credits int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  p_tier text;
  bal int;
  pending_count int;
  is_adm boolean := false;
  debit_credits int := 0;
  kind text := lower(coalesce(trim(p_job_type), ''));
  ar text := coalesce(nullif(trim(p_aspect_ratio), ''), '1:1');
  dur int := p_duration_sec;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if kind not in ('image_gen', 'video_gen') then
    raise exception 'INVALID_JOB_TYPE';
  end if;
  if coalesce(length(trim(p_prompt)), 0) < 3 then
    raise exception 'INVALID_PROMPT';
  end if;
  if ar not in ('1:1', '9:16', '16:9', '4:3', '3:4') then
    raise exception 'INVALID_ASPECT_RATIO';
  end if;

  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (uid, 'free', 5, null)
  on conflict (user_id) do nothing;

  select
    pr.tier,
    pr.credits_balance,
    coalesce(pr.is_admin, false)
  into p_tier, bal, is_adm
  from public.profiles pr
  where pr.user_id = uid
  for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if not is_adm then
    select count(*) into pending_count
    from public.jobs j
    where j.user_id = uid and j.status in ('pending', 'running');
    if pending_count >= 3 then
      raise exception 'TOO_MANY_ACTIVE_JOBS';
    end if;
  end if;

  debit_credits := case kind
    when 'image_gen' then 2
    when 'video_gen' then greatest(8, coalesce(dur, 4) * 2)
    else 0
  end;
  if dur is null then
    dur := case when kind = 'video_gen' then 4 else null end;
  end if;
  if kind = 'video_gen' and (dur < 2 or dur > 12) then
    raise exception 'INVALID_DURATION';
  end if;

  if not is_adm and bal < debit_credits then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into public.jobs (
    user_id,
    source_url,
    status,
    tier_used,
    source_kind,
    job_type,
    ai_prompt,
    ai_model,
    ai_aspect_ratio,
    ai_duration_sec,
    billing_debited,
    billing_debit_kind,
    billing_credits
  ) values (
    uid,
    case when kind = 'image_gen' then 'ai:image' else 'ai:video' end,
    'pending',
    p_tier,
    case when kind = 'image_gen' then 'ai_image' else 'ai_video' end,
    kind,
    trim(p_prompt),
    nullif(trim(p_model), ''),
    ar,
    dur,
    not is_adm,
    case when is_adm then null else 'credit' end,
    case when is_adm then 0 else debit_credits end
  )
  returning id into jid;

  if not is_adm then
    update public.profiles pr
    set credits_balance = pr.credits_balance - debit_credits,
        updated_at = now()
    where pr.user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      -debit_credits,
      (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
      case when kind = 'image_gen' then 'ai_image_job_debit' else 'ai_video_job_debit' end,
      'job',
      jid
    );
  end if;

  return query
    select
      jid,
      p_tier,
      (case when is_adm then 'pro' else p_tier end)::text,
      (case when is_adm then 0 else debit_credits end);
end;
$$;

revoke all on function public.start_ai_job(text, text, text, text, int) from public;
grant execute on function public.start_ai_job(text, text, text, text, int) to authenticated;

create or replace function public.refund_failed_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j record;
  refund_credits int;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then return; end if;
  if j.refunded_at is not null then return; end if;
  if j.status not in ('failed', 'pending', 'running') then return; end if;

  if coalesce(j.billing_debited, true) = false then
    update public.jobs set refunded_at = now(), updated_at = now() where id = p_job_id;
    return;
  end if;

  refund_credits := greatest(1, coalesce(j.billing_credits, 1));

  if j.tier_used in ('starter', 'creator', 'pro') then
    if coalesce(j.billing_debit_kind, 'monthly') = 'credit' then
      update public.profiles pr
         set credits_balance = pr.credits_balance + refund_credits,
             updated_at = now()
       where pr.user_id = j.user_id;

      insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
      values (
        j.user_id,
        refund_credits,
        (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = j.user_id),
        'job_failed_refund',
        'job',
        p_job_id
      );
    else
      update public.profiles pr
         set monthly_used = greatest(0, pr.monthly_used - 1),
             updated_at = now()
       where pr.user_id = j.user_id;
    end if;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance + refund_credits,
           updated_at = now()
     where pr.user_id = j.user_id;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      j.user_id,
      refund_credits,
      (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = j.user_id),
      'job_failed_refund',
      'job',
      p_job_id
    );
  end if;

  update public.jobs set refunded_at = now(), updated_at = now() where id = p_job_id;
end;
$$;

revoke all on function public.refund_failed_job(uuid) from public;

create or replace function public.refund_pending_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  j record;
  refund_credits int;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into j from public.jobs
   where id = p_job_id and user_id = uid and status = 'pending'
     for update;
  if not found then raise exception 'NOT_FOUND_OR_NOT_PENDING'; end if;

  update public.jobs set status = 'failed', error_message = 'Dibatalkan pengguna', updated_at = now()
   where id = p_job_id;

  if coalesce(j.billing_debited, true) = false then
    return;
  end if;

  refund_credits := greatest(1, coalesce(j.billing_credits, 1));

  if j.tier_used in ('starter', 'creator', 'pro') then
    if coalesce(j.billing_debit_kind, 'monthly') = 'credit' then
      update public.profiles pr
         set credits_balance = pr.credits_balance + refund_credits,
             updated_at = now()
       where pr.user_id = uid;

      insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
      values (
        uid,
        refund_credits,
        (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
        'job_cancelled_refund',
        'job',
        p_job_id
      );
    else
      update public.profiles pr
         set monthly_used = greatest(0, pr.monthly_used - 1), updated_at = now()
       where pr.user_id = uid;
    end if;
  else
    update public.profiles pr
       set credits_balance = pr.credits_balance + refund_credits, updated_at = now()
     where pr.user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      refund_credits,
      (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
      'job_cancelled_refund',
      'job',
      p_job_id
    );
  end if;
end;
$$;

revoke all on function public.refund_pending_job(uuid) from public;
grant execute on function public.refund_pending_job(uuid) to authenticated;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- SECTION: 023_ai_phase3_hardening.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Phase 3 hardening: idempotency + provider config + dynamic quote helper.

alter table public.jobs
  add column if not exists request_idempotency_key text,
  add column if not exists ai_provider_used text,
  add column if not exists ai_cost_breakdown jsonb;

create unique index if not exists jobs_user_jobtype_idem_uq
  on public.jobs (user_id, job_type, request_idempotency_key)
  where request_idempotency_key is not null;

create table if not exists public.ai_provider_config (
  provider text primary key,
  enabled boolean not null default true,
  priority smallint not null default 100,
  updated_at timestamptz not null default now()
);

insert into public.ai_provider_config(provider, enabled, priority)
values ('openrouter', true, 10), ('mock', true, 100)
on conflict (provider) do nothing;

alter table public.ai_provider_config enable row level security;

drop policy if exists ai_provider_config_select_admin on public.ai_provider_config;
create policy ai_provider_config_select_admin
  on public.ai_provider_config for select
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and coalesce(p.is_admin, false)
    )
  );

drop policy if exists ai_provider_config_update_admin on public.ai_provider_config;
create policy ai_provider_config_update_admin
  on public.ai_provider_config for update
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and coalesce(p.is_admin, false)
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and coalesce(p.is_admin, false)
    )
  );

create or replace function public.ai_quote_credits(
  p_job_type text,
  p_model text default null,
  p_aspect_ratio text default '1:1',
  p_duration_sec int default null,
  p_tier text default 'free'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text := lower(coalesce(trim(p_job_type), ''));
  ar text := coalesce(nullif(trim(p_aspect_ratio), ''), '1:1');
  model text := lower(coalesce(trim(p_model), 'fast'));
  dur int := greatest(2, least(12, coalesce(p_duration_sec, 4)));
  base_num numeric := 0;
  model_mul numeric := 1;
  ar_mul numeric := 1;
  tier_mul numeric := 1;
  out_num numeric;
begin
  if kind not in ('image_gen', 'video_gen') then
    raise exception 'INVALID_JOB_TYPE';
  end if;

  base_num := case when kind = 'image_gen' then 2 else greatest(8, dur * 2) end;

  if model like '%quality%' or model like '%pro%' then
    model_mul := 1.5;
  elsif model like '%cinematic%' then
    model_mul := 2;
  else
    model_mul := 1;
  end if;

  ar_mul := case ar
    when '9:16' then 1.15
    when '16:9' then 1.2
    when '4:3' then 1.08
    when '3:4' then 1.08
    else 1
  end;

  tier_mul := case coalesce(lower(p_tier), 'free')
    when 'pro' then 0.9
    when 'creator' then 0.95
    when 'starter' then 1
    else 1.2
  end;

  out_num := ceil(base_num * model_mul * ar_mul * tier_mul);
  return greatest(case when kind='image_gen' then 2 else 8 end, out_num::int);
end;
$$;

revoke all on function public.ai_quote_credits(text, text, text, int, text) from public;
grant execute on function public.ai_quote_credits(text, text, text, int, text) to authenticated;

drop function if exists public.start_ai_job(text, text, text, text, int);
drop function if exists public.start_ai_job(text, text, text, text, int, text);
create or replace function public.start_ai_job(
  p_job_type text,
  p_prompt text,
  p_model text default null,
  p_aspect_ratio text default '1:1',
  p_duration_sec int default null,
  p_idempotency_key text default null
)
returns table (
  job_id uuid,
  tier text,
  worker_tier text,
  cost_credits int,
  reused_existing boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jid uuid;
  existing_id uuid;
  p_tier text;
  bal int;
  pending_count int;
  is_adm boolean := false;
  debit_credits int := 0;
  kind text := lower(coalesce(trim(p_job_type), ''));
  ar text := coalesce(nullif(trim(p_aspect_ratio), ''), '1:1');
  dur int := p_duration_sec;
  idem text := nullif(trim(p_idempotency_key), '');
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if kind not in ('image_gen', 'video_gen') then
    raise exception 'INVALID_JOB_TYPE';
  end if;
  if coalesce(length(trim(p_prompt)), 0) < 3 then
    raise exception 'INVALID_PROMPT';
  end if;
  if ar not in ('1:1', '9:16', '16:9', '4:3', '3:4') then
    raise exception 'INVALID_ASPECT_RATIO';
  end if;

  if idem is not null then
    select j.id into existing_id
    from public.jobs j
    where j.user_id = uid
      and j.job_type = kind
      and j.request_idempotency_key = idem
    order by j.created_at desc
    limit 1;

    if existing_id is not null then
      select j.tier_used, coalesce(j.billing_credits, 0)
      into p_tier, debit_credits
      from public.jobs j
      where j.id = existing_id;

      return query
      select existing_id, p_tier, p_tier, debit_credits, true;
      return;
    end if;
  end if;

  insert into public.profiles (user_id, tier, credits_balance, onboarding_completed_at)
  values (uid, 'free', 5, null)
  on conflict (user_id) do nothing;

  select pr.tier, pr.credits_balance, coalesce(pr.is_admin, false)
  into p_tier, bal, is_adm
  from public.profiles pr
  where pr.user_id = uid
  for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if not is_adm then
    select count(*) into pending_count
    from public.jobs j
    where j.user_id = uid and j.status in ('pending', 'running');
    if pending_count >= 3 then
      raise exception 'TOO_MANY_ACTIVE_JOBS';
    end if;
  end if;

  if dur is null then
    dur := case when kind = 'video_gen' then 4 else null end;
  end if;
  if kind = 'video_gen' and (dur < 2 or dur > 12) then
    raise exception 'INVALID_DURATION';
  end if;

  debit_credits := public.ai_quote_credits(kind, p_model, ar, dur, p_tier);

  if not is_adm and bal < debit_credits then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into public.jobs (
    user_id, source_url, status, tier_used, source_kind, job_type,
    ai_prompt, ai_model, ai_aspect_ratio, ai_duration_sec,
    billing_debited, billing_debit_kind, billing_credits,
    request_idempotency_key
  ) values (
    uid,
    case when kind = 'image_gen' then 'ai:image' else 'ai:video' end,
    'pending',
    p_tier,
    case when kind = 'image_gen' then 'ai_image' else 'ai_video' end,
    kind,
    trim(p_prompt),
    nullif(trim(p_model), ''),
    ar,
    dur,
    not is_adm,
    case when is_adm then null else 'credit' end,
    case when is_adm then 0 else debit_credits end,
    idem
  ) returning id into jid;

  if not is_adm then
    update public.profiles pr
    set credits_balance = pr.credits_balance - debit_credits,
        updated_at = now()
    where pr.user_id = uid;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      uid,
      -debit_credits,
      (select pr2.credits_balance from public.profiles pr2 where pr2.user_id = uid),
      case when kind = 'image_gen' then 'ai_image_job_debit' else 'ai_video_job_debit' end,
      'job',
      jid
    );
  end if;

  return query
  select jid, p_tier, (case when is_adm then 'pro' else p_tier end)::text,
         (case when is_adm then 0 else debit_credits end), false;
end;
$$;

revoke all on function public.start_ai_job(text, text, text, text, int, text) from public;
grant execute on function public.start_ai_job(text, text, text, text, int, text) to authenticated;




-- =============================================================================
-- SELESAI — bootstrap schema & RPC selesai (001–023)
-- =============================================================================
-- Langkah aplikasi (di luar SQL ini):
-- 1) Supabase → Authentication → URL configuration: Site URL = https://domain-kamu
-- 2) Supabase → Authentication → Email templates / SMTP sesuai kebutuhan
-- 3) Bucket Storage `sources` / `clips` dibuat oleh migrasi (bagian 004) jika berjalan sukses
-- 4) Isi web/.env.local + root .env dengan URL & keys Supabase
--
-- Jadikan satu user admin (setelah user itu sudah signup):
--    Jalankan terpisah: supabase/scripts/promote_admin_by_email.sql
--
-- Catatan: migration 005 mem-promote otomatis hanya jika ada user dengan email
--          imadmin@verinusa.com — untuk domain lain pakai promote_admin_by_email.sql.
-- =============================================================================

