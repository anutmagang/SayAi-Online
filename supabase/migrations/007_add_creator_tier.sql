-- 007: Add "creator" tier (4-tier pricing structure).
-- Free → Starter (Rp 49K, 30 job) → Creator (Rp 129K, 90 job) → Pro (Rp 299K, 250 job)

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
-- 4. Update Pro quota from 500 → 250 for existing Pro users
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
-- 10. Update _maybe_reset_monthly_quota: handle creator tier expiry → free
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
