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

