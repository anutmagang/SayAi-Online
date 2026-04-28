-- Promote satu akun menjadi admin berdasarkan email (self-host / operator).
-- Jalankan di Supabase: SQL Editor → New query → paste → Run.
--
-- Sebelumnya: user harus sudah pernah signup (ada baris di auth.users).
-- Ganti email di bawah ke email akun admin kamu.

do $$
declare
  admin_email constant text := 'imadmin@say-ai.online';
  admin_uid uuid;
begin
  select id into admin_uid from auth.users where lower(email) = lower(admin_email);
  if admin_uid is null then
    raise exception 'Email % belum terdaftar. Daftar dulu lewat /signup, lalu jalankan script ini lagi.', admin_email;
  end if;

  insert into public.profiles (user_id, tier, credits_balance, is_admin, onboarding_completed_at)
  values (admin_uid, 'pro', 100, true, now())
  on conflict (user_id) do update
    set is_admin = true,
        tier = case when public.profiles.tier = 'free' then 'pro' else public.profiles.tier end,
        onboarding_completed_at = coalesce(public.profiles.onboarding_completed_at, now()),
        updated_at = now();
end$$;
