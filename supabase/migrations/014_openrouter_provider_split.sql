-- Pisahkan penyedia katalog / pool: tambah `openrouter` (selain `openai` resmi).

alter table public.operator_llm_api_key_pool
  drop constraint if exists operator_llm_api_key_pool_provider_check;

alter table public.operator_llm_api_key_pool
  add constraint operator_llm_api_key_pool_provider_check
  check (provider in ('groq', 'gemini', 'openai', 'anthropic', 'openrouter'));

alter table public.llm_model_catalog_cache
  drop constraint if exists llm_model_catalog_cache_provider_check;

alter table public.llm_model_catalog_cache
  add constraint llm_model_catalog_cache_provider_check
  check (provider in ('groq', 'gemini', 'openai', 'openrouter'));
