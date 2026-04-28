-- Selaraskan pemilihan LLM dengan paket: Starter → auto+groq+gemini;
-- Creator → +openai; Pro → semua; Free → auto saja (kecuali admin).

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

  if not is_adm and p_tier = 'free' and p_1_pref <> 'auto' then
    raise exception 'PAID_TIER_REQUIRED';
  end if;

  if not is_adm and p_tier = 'starter' and p_1_pref not in ('auto', 'groq', 'gemini') then
    raise exception 'LLM_PREF_NOT_ALLOWED_FOR_TIER';
  end if;

  if not is_adm and p_tier = 'creator' and p_1_pref not in ('auto', 'groq', 'gemini', 'openai') then
    raise exception 'LLM_PREF_NOT_ALLOWED_FOR_TIER';
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

-- Bersihkan preferensi yang tidak valid setelah aturan baru
update public.profiles pr
   set llm_preference = 'auto',
       llm_model_id = null,
       updated_at = now()
 where pr.tier = 'starter'
   and pr.llm_preference is not null
   and pr.llm_preference not in ('auto', 'groq', 'gemini');

update public.profiles pr
   set llm_preference = 'auto',
       llm_model_id = null,
       updated_at = now()
 where pr.tier = 'creator'
   and pr.llm_preference is not null
   and pr.llm_preference not in ('auto', 'groq', 'gemini', 'openai');
