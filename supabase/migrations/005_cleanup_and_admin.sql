-- Fai-Clipper release cleanup:
-- 1) drop leftover beta-only artefacts (100-user cap, beta stats)
-- 2) promote the operator account to admin (imadmin@verinusa.com)
-- 3) add a convenience is-admin check function for RLS
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Drop beta enrollment stats (no more public user cap)
-- ---------------------------------------------------------------------------
drop function if exists public.beta_enrollment_stats();

-- ---------------------------------------------------------------------------
-- Promote operator to admin.
-- Works on existing or future signup: creates a profile row if missing, then
-- sets is_admin = true. Change the email literal below for self-hosting.
-- ---------------------------------------------------------------------------
do $$
declare
  admin_email constant text := 'imadmin@verinusa.com';
  admin_uid uuid;
begin
  select id into admin_uid from auth.users where lower(email) = lower(admin_email);
  if admin_uid is null then
    raise notice 'Admin email % not found in auth.users (signup dulu, lalu jalankan migrasi ulang).', admin_email;
    return;
  end if;

  insert into public.profiles (user_id, tier, credits_balance, is_admin, onboarding_completed_at)
  values (admin_uid, 'pro', 100, true, now())
  on conflict (user_id) do update
    set is_admin = true,
        tier = case when public.profiles.tier = 'free' then 'pro' else public.profiles.tier end,
        onboarding_completed_at = coalesce(public.profiles.onboarding_completed_at, now()),
        updated_at = now();
end$$;

-- ---------------------------------------------------------------------------
-- is_admin() helper — use in future RLS policies to avoid subquery repetition.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where user_id = uid), false);
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_failed_job: dipanggil worker (service role) saat job gagal system error.
-- Sama logika dengan refund_pending_job tapi tanpa auth.uid() check — karena
-- worker pakai service role, bukan user session. Aman: argumen p_job_id
-- diverifikasi exists + belum pernah di-refund (ditandai refunded_at).
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists refunded_at timestamptz;

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

  if j.tier_used in ('starter', 'pro') then
    update public.profiles
    set monthly_used = greatest(0, monthly_used - 1), updated_at = now()
    where user_id = j.user_id;
  else
    update public.profiles
    set credits_balance = credits_balance + 1, updated_at = now()
    where user_id = j.user_id;

    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (
      j.user_id,
      1,
      (select credits_balance from public.profiles where user_id = j.user_id),
      'job_failed_refund',
      'job',
      p_job_id
    );
  end if;

  update public.jobs set refunded_at = now(), updated_at = now() where id = p_job_id;
end;
$$;

revoke all on function public.refund_failed_job(uuid) from public;
-- No grant to authenticated — service role only.
