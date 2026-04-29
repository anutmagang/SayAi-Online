-- Cookie YouTube per user (Netscape cookies.txt) untuk yt-dlp — private bucket + kolom profil.

alter table public.profiles
  add column if not exists youtube_cookies_uploaded_at timestamptz null;

comment on column public.profiles.youtube_cookies_uploaded_at is
  'Terisi saat user mengunggah youtube-cookies.txt lewat dashboard; worker memakai file di Storage.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'youtube_cookies',
  'youtube_cookies',
  false,
  524288,
  array['text/plain', 'application/octet-stream']::text[]
)
on conflict (id) do nothing;

drop policy if exists "youtube_cookies_insert_own" on storage.objects;
create policy "youtube_cookies_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'youtube_cookies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "youtube_cookies_select_own" on storage.objects;
create policy "youtube_cookies_select_own"
  on storage.objects for select
  using (
    bucket_id = 'youtube_cookies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "youtube_cookies_update_own" on storage.objects;
create policy "youtube_cookies_update_own"
  on storage.objects for update
  using (
    bucket_id = 'youtube_cookies'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'youtube_cookies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "youtube_cookies_delete_own" on storage.objects;
create policy "youtube_cookies_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'youtube_cookies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
