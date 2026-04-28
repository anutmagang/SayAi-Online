-- Stok API key LLM operator (terenkripsi app-side). Akses hanya lewat service role / server.

create table if not exists public.operator_llm_api_key_pool (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (provider in ('groq', 'gemini', 'openai', 'anthropic')),
  label text not null default '',
  key_hint text not null default '',
  secret_ciphertext text not null,
  sort_order int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists operator_llm_api_key_pool_provider_order_idx
  on public.operator_llm_api_key_pool (provider, sort_order, id);

comment on table public.operator_llm_api_key_pool is
  'Encrypted LLM API keys for operator rotation; decrypted only with API_KEY_POOL_MASTER_SECRET on server/worker.';

alter table public.operator_llm_api_key_pool enable row level security;
