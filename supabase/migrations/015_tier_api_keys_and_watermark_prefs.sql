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
