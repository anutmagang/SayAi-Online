-- Kolom watermark pada profiles diperlukan oleh start_clip_job (017+).
-- Jika migrasi 015 tidak pernah dijalankan, RPC gagal: "column pr.watermark_paid_enabled does not exist".

alter table public.profiles
  add column if not exists watermark_paid_enabled boolean not null default false;

alter table public.profiles
  add column if not exists watermark_custom_text text;

alter table public.profiles
  add column if not exists watermark_position text not null default 'bottom_right';

comment on column public.profiles.watermark_paid_enabled is
  'Starter+: aktifkan watermark kustom (teks + posisi). Free selalu watermark ringan operator.';
comment on column public.profiles.watermark_custom_text is
  'Teks watermark untuk tier berbayar bila watermark_paid_enabled.';
comment on column public.profiles.watermark_position is
  'Posisi drawtext ffmpeg untuk watermark berbayar; free memakai sudut bawah dari worker.';
