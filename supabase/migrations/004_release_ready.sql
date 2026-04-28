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
  -- Kalau subscription expired → kuota jadi 0 (downgrade ke free).
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
-- purge_old_jobs: retention — hapus job + files >14 hari (dipanggil via cron)
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
