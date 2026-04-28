-- Preferensi watermark berbayar: update via RPC security definer (profiles tidak punya policy UPDATE untuk user).

create or replace function public.set_watermark_preferences(
  p_enabled boolean,
  p_custom_text text default null,
  p_position text default 'bottom_right'
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
  v_pos text;
  v_text text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_pos := coalesce(nullif(trim(p_position), ''), 'bottom_right');
  if v_pos not in ('top_left', 'top_right', 'bottom_left', 'bottom_right', 'center') then
    raise exception 'INVALID_WATERMARK_POSITION';
  end if;

  select pr.tier, coalesce(pr.is_admin, false)
    into p_tier, is_adm
    from public.profiles pr
   where pr.user_id = uid;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if not is_adm and p_tier = 'free' then
    raise exception 'WATERMARK_PREFS_PAID_ONLY';
  end if;

  v_text := nullif(left(trim(coalesce(p_custom_text, '')), 120), '');

  if p_enabled and v_text is null then
    raise exception 'WATERMARK_TEXT_REQUIRED_WHEN_ENABLED';
  end if;

  update public.profiles pr
     set watermark_paid_enabled = p_enabled,
         watermark_custom_text = case when p_enabled then v_text else null end,
         watermark_position = case when p_enabled then v_pos else 'bottom_right' end,
         updated_at = now()
   where pr.user_id = uid;
end;
$$;

revoke all on function public.set_watermark_preferences(boolean, text, text) from public;
grant execute on function public.set_watermark_preferences(boolean, text, text) to authenticated;
