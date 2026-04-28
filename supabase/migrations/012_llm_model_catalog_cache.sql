-- Cache hasil fetch daftar model dari Groq / Gemini / OpenAI(OpenRouter).
-- Diperbarui oleh cron atau admin; pengguna terautentikasi boleh baca (RLS).

create table if not exists public.llm_model_catalog_cache (
  provider text primary key
    check (provider in ('groq', 'gemini', 'openai')),
  models jsonb not null default '[]'::jsonb,
  fetch_error text,
  updated_at timestamptz not null default now(),
  last_success_at timestamptz
);

comment on table public.llm_model_catalog_cache is
  'Provider model ID list for dashboard hints; service role upserts via Next.js cron/admin.';

alter table public.llm_model_catalog_cache enable row level security;

create policy "llm_model_catalog_cache_select_authenticated"
  on public.llm_model_catalog_cache
  for select
  to authenticated
  using (true);
