-- Jangan turunkan tier admin ke "free" saat plan_expires_at lewat (operator account).
-- Pulihkan admin yang sempat ter-downgrade oleh bug tersebut.

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
      -- Admin: jangan ubah tier/kuota billing; hapus tanggal kedaluwarsa agar tidak loop.
      if coalesce(pr.is_admin, false) then
        update public.profiles
           set plan_expires_at = null,
               updated_at = now()
         where user_id = p_uid;
        return;
      end if;

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

-- Akun admin yang sempat jatuh ke free karena bug expiry: pulihkan billing Pro operator.
update public.profiles pr
   set tier = 'pro',
       monthly_quota = 250,
       monthly_used = 0,
       plan_expires_at = null,
       updated_at = now()
 where coalesce(pr.is_admin, false)
   and pr.tier = 'free';
