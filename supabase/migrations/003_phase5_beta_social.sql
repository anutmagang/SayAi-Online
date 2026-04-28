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
-- Social OAuth tokens — no RLS policies for authenticated (service role only)
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
