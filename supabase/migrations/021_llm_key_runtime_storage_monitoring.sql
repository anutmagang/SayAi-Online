-- Runtime status API key pool (cooldown, probe, health) + event ringan (retensi 10 hari)
-- + snapshot storage agregat + opsi profil bantuan teknis + RPC ukuran bucket (murah).

alter table public.operator_llm_api_key_pool
  add column if not exists health_status text not null default 'unknown'
    check (health_status in ('unknown', 'healthy', 'cooldown', 'degraded', 'error'));

alter table public.operator_llm_api_key_pool
  add column if not exists cooldown_until timestamptz;

alter table public.operator_llm_api_key_pool
  add column if not exists next_probe_at timestamptz;

alter table public.operator_llm_api_key_pool
  add column if not exists last_error text;

alter table public.operator_llm_api_key_pool
  add column if not exists probe_fail_streak int not null default 0;

alter table public.operator_llm_api_key_pool
  add column if not exists last_success_at timestamptz;

comment on column public.operator_llm_api_key_pool.health_status is
  'healthy = siap; cooldown = rate limit / backoff; degraded/error = probe gagal berulang.';
comment on column public.operator_llm_api_key_pool.next_probe_at is
  'Worker/cron probe sebelum menandai key siap lagi setelah cooldown.';

-- Event audit ringan (tanpa ciphertext); purge >10 hari via cron.
create table if not exists public.llm_key_limit_events (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid references public.operator_llm_api_key_pool (id) on delete set null,
  provider text not null,
  event_kind text not null,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists llm_key_limit_events_created_at_idx
  on public.llm_key_limit_events (created_at desc);

create index if not exists llm_key_limit_events_pool_idx
  on public.llm_key_limit_events (pool_id, created_at desc);

alter table public.llm_key_limit_events enable row level security;

comment on table public.llm_key_limit_events is
  'Event pool key (429, cooldown, probe). Retensi disarankan 10 hari — hapus lewat cron.';

-- Debounce email alert "provider tanpa key siap".
create table if not exists public.operator_provider_alert_sent (
  provider text primary key,
  last_sent_at timestamptz not null default now()
);

comment on table public.operator_provider_alert_sent is
  'Catatan waktu terakhir email alert per provider (hindari spam).';

alter table public.operator_provider_alert_sent enable row level security;

-- Snapshot agregat storage (tanpa path file / user).
create table if not exists public.platform_storage_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  bucket_bytes jsonb not null default '{}'::jsonb,
  total_bytes bigint not null default 0,
  worker_disk_bytes_est bigint,
  storage_cost_usd_est numeric(18, 8),
  notes text
);

create index if not exists platform_storage_snapshots_taken_at_idx
  on public.platform_storage_snapshots (taken_at desc);

alter table public.platform_storage_snapshots enable row level security;

comment on table public.platform_storage_snapshots is
  'Ringkasan byte per bucket + estimasi biaya; isi lewat cron service_role.';

-- Profil: izin agregat log saat bantuan teknis (detail tetap minimal / tanpa konten video).
alter table public.profiles
  add column if not exists support_logs_opt_in boolean not null default false;

comment on column public.profiles.support_logs_opt_in is
  'Jika true, operator boleh mengakses log/job terkait akun untuk bantuan teknis (user memilih).';

create or replace function public.set_support_logs_opt_in(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set support_logs_opt_in = p_enabled,
      updated_at = now()
  where user_id = auth.uid();
end;
$$;

revoke all on function public.set_support_logs_opt_in(boolean) from public;
grant execute on function public.set_support_logs_opt_in(boolean) to authenticated;

-- Agregat byte per bucket (satu query) — hanya service_role.
create or replace function public.operator_storage_bucket_bytes()
returns jsonb
language sql
security definer
set search_path = public, storage
stable
as $$
  select coalesce(
    jsonb_object_agg(name, to_jsonb(bytes)),
    '{}'::jsonb
  )
  from (
    select b.name::text as name,
           coalesce(sum((nullif(o.metadata->>'size', ''))::bigint), 0)::bigint as bytes
    from storage.objects o
    join storage.buckets b on b.id = o.bucket_id
    group by b.name
  ) sub;
$$;

revoke all on function public.operator_storage_bucket_bytes() from public;
grant execute on function public.operator_storage_bucket_bytes() to service_role;

-- Catatan: jangan buka SELECT RLS anon/authenticated pada `operator_llm_api_key_pool`
-- (ada secret_ciphertext). Admin UI memakai route API + service_role; polling/refetch
-- untuk status realtime tanpa membocorkan ciphertext ke browser.
