-- Repair / idempotent: kolom llm_model_id + RPC set_llm_preference.
-- Jalankan jika error: column "llm_model_id" of relation "profiles" does not exist,
-- atau PostgREST tidak menemukan set_llm_preference dengan argumen yang benar.

alter table public.profiles
  add column if not exists llm_model_id text;

alter table public.jobs
  add column if not exists billing_debited boolean not null default true;

-- Arg names p_1_pref / p_2_model_id: PostgREST mengikat JSON keys urut alfabet;
-- (p_pref, p_model_id) jadi (p_model_id, p_pref) dan tidak cocok fungsi SQL.

drop function if exists public.set_llm_preference(text, text);
drop function if exists public.set_llm_preference(text);

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
