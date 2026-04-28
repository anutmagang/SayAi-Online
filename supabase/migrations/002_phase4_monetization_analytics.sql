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
-- New signups → profile row
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
-- refund_pending_job: upload failed after debit — delete pending job + credit
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
-- ensure_user_profile — for /api/me before first job (RLS-safe)
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
