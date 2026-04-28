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
