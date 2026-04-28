-- 1) Job billing: tier berbayar bisa debit kredit bila kuota bulanan penuh.
-- 2) Bonus kredit saat subscription disetujui.
-- 3) Default retention purge 10 hari.

alter table public.jobs
  add column if not exists billing_debit_kind text
    check (billing_debit_kind is null or billing_debit_kind in ('monthly', 'credit'));

comment on column public.jobs.billing_debit_kind is
  'monthly = pakai kuota bulanan; credit = 1 kredit (tier berbayar saat kuota habis, atau free).';

-- ---------------------------------------------------------------------------
-- start_clip_job: paid tier — jika kuota habis tapi masih ada kredit, debit kredit.
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
