-- Lockout ganti password + bonus subscription (angka selaras web/lib/credits-pricing.ts).

alter table public.profiles
  add column if not exists password_change_failures smallint not null default 0
    check (password_change_failures >= 0 and password_change_failures <= 50),
  add column if not exists password_change_lockout_until timestamptz;

comment on column public.profiles.password_change_failures is
  'Kegagalan verifikasi password lama saat ganti password (via app).';
comment on column public.profiles.password_change_lockout_until is
  'Jika > now(), form ganti password dinonaktifkan — pakai reset email.';

-- Panggil setelah password lama salah (client verifikasi via signIn).
create or replace function public.touch_password_change_failure()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  nf int;
  lu timestamptz;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select pr.password_change_lockout_until
    into lu
    from public.profiles pr
   where pr.user_id = uid
   for update;

  if not found then
    raise exception 'NO_PROFILE';
  end if;

  if lu is not null and lu <= now() then
    update public.profiles pr
       set password_change_failures = 0,
           password_change_lockout_until = null,
           updated_at = now()
     where pr.user_id = uid;
    lu := null;
  end if;

  if lu is not null and lu > now() then
    return json_build_object(
      'locked', true,
      'lockout_until', lu,
      'failures', (select pr2.password_change_failures from public.profiles pr2 where pr2.user_id = uid)
    );
  end if;

  update public.profiles pr
     set password_change_failures = pr.password_change_failures + 1,
         updated_at = now()
   where pr.user_id = uid
   returning pr.password_change_failures into nf;

  if nf >= 5 then
    update public.profiles pr
       set password_change_lockout_until = now() + interval '24 hours',
           updated_at = now()
     where pr.user_id = uid;
  end if;

  select pr.password_change_lockout_until, pr.password_change_failures
    into lu, nf
    from public.profiles pr
   where pr.user_id = uid;

  return json_build_object(
    'locked', lu is not null and lu > now(),
    'lockout_until', lu,
    'failures', nf
  );
end;
$$;

revoke all on function public.touch_password_change_failure() from public;
grant execute on function public.touch_password_change_failure() to authenticated;

-- Panggil setelah ganti password sukses atau setelah reset password dari email.
create or replace function public.clear_password_change_tracking()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  update public.profiles pr
     set password_change_failures = 0,
         password_change_lockout_until = null,
         updated_at = now()
   where pr.user_id = uid;
end;
$$;

revoke all on function public.clear_password_change_tracking() from public;
grant execute on function public.clear_password_change_tracking() to authenticated;

-- Bonus kredit approval — nilai selaras web/lib/credits-pricing.ts SUBSCRIPTION_APPROVAL_BONUS_CREDITS
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
      when 'starter' then 16
      when 'creator' then 38
      when 'pro' then 72
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
