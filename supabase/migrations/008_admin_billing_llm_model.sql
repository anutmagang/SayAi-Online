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
