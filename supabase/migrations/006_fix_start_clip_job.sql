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
