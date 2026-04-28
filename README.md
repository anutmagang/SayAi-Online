# Fai-Clipper

AI video-to-short-clip tool — tempel URL YouTube atau upload file, sistem akan
transkrip otomatis, AI pilih momen terbaik, render **9:16 (Shorts/Reels)** atau
**16:9 (konten horizontal)**, lalu hasil MP4 tinggal diunduh. Caption/hashtag untuk
posting dibuat AI dan ditampilkan di dashboard (bukan subtitle di dalam video).

Tech: **Next.js 14** dashboard · **Supabase** (auth + Postgres + Storage) ·
**Python** worker (yt-dlp + Groq Whisper / faster-whisper + LLM router +
ffmpeg + MediaPipe).

**Alur lengkap + diagram (Mermaid):** lihat [`docs/PROJECT_FLOW.md`](docs/PROJECT_FLOW.md).

---

## Highlights

- **Multi-LLM router** — Groq Llama 3.3 70B (free tier, default) with
automatic fallback to Gemini / OpenAI / Claude on the paid tiers. Creator and
Pro users can pin a specific vendor in Settings.
- **Groq Whisper Large v3 Turbo** for transcription across all tiers (≈30×
faster than CPU `faster-whisper`, free for reasonable volume). Falls back to
local Whisper if the Groq API fails or the audio exceeds 25 MB.
- **Download-only workflow.** No TikTok / Instagram integration. Users download
per-clip MP4 or a ZIP of all clips and upload manually wherever they like —
keeps the project free of platform OAuth approvals.
- **4-tier billing** (Free / Starter / Creator / Pro) with monthly quotas,
manual IDR top-up / subscription approval via an Admin panel. Payment gateway
(Midtrans, Stripe) can be bolted on later with no schema changes.
- **Supabase Storage** for source uploads (up to 2 GB per file) and clip
delivery (signed URLs, 1 h TTL). All buckets private.
- **Job retention** — a cron job (`web/scripts/purge-old-jobs.mjs`) deletes
database rows and storage objects older than `RETENTION_DAYS` (default 14).

---

## Pricing (default — customise in `web/lib/tiers.ts`)


| Tier          | Harga/bulan                | Kuota            | Durasi maks | LLM default                                 | Watermark |
| ------------- | -------------------------- | ---------------- | ----------- | ------------------------------------------- | --------- |
| **Free**      | Rp 0 (5 kredit onboarding) | 1 job per kredit | 1 jam       | Groq Llama 3.3 70B                          | ya        |
| **Starter**   | Rp 49.000                  | 30 job           | 2 jam       | Groq Llama 3.3 70B + Gemini Flash           | tidak     |
| **Creator** ⭐ | Rp 129.000                 | 90 job           | 2 jam       | Gemini 2.0 Flash + Groq                     | tidak     |
| **Pro**       | Rp 299.000                 | 250 job          | 2 jam       | Pilih sendiri: Claude / GPT-4o / Gemini Pro | tidak     |


1 job = 1 sesi rendering (hingga **20** klip per job dari dashboard; default 8).
Kredit / quota dipotong di awal. Job yang gagal akan direfund otomatis lewat
RPC `refund_failed_job`.

### Kunci API (operator SaaS)

Anda **bukan** minta end-user menyediakan key. Satu set key di server Anda untuk
semua pelanggan:


| Pendekatan               | Keterangan                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wajib minimal**        | `GROQ_API_KEY` — LLM + Whisper untuk Free dan fallback; satu akun Groq cukup untuk MVP.                                                                       |
| **Opsional bertahap**    | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — isi saat Anda siap buka fitur berbayar / routing Pro. Tanpa key, router otomatis skip provider itu. |
| **Satu key per layanan** | Tidak perlu “banyak key” sekaligus: satu project per vendor (1× Groq, 1× Google AI Studio, dst.) sudah standar.                                               |
| **Biaya & limit**        | Atur billing + tier dev (mis. Groq Dev) di konsol masing-masing; pantau usage di dashboard vendor.                                                            |
| **Rotasi / stok key**    | Set `API_KEY_POOL_MASTER_SECRET` (≥12 karakter, **sama persis** di `web/.env.local` + root `.env`). Jalankan migrasi `013_operator_llm_api_key_pool.sql`. Di **Admin → Stok API key LLM** tambahkan beberapa key per vendor (terenkripsi). Worker mencoba urutan `sort_order`; pada **rate limit (429 / quota)** otomatis lanjut ke key berikutnya; env `GROQ_API_KEY` dll. dipakai sebagai fallback setelah stok pool. |


---

## Local development

### 1. Prereqs

- Python ≥ 3.10 (tested on 3.11)
- Node.js ≥ 20
- `ffmpeg` and `yt-dlp` in `$PATH`
- A Supabase project (free tier is fine for local dev)

### 2. Clone & install

```bash
git clone <repo-url> fai-clipper
cd fai-clipper

# Python pipeline
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# File .env + web/.env.local (tanpa cp manual). Ulangi setelah venv bila PYTHON_BIN harus ke .venv.
chmod +x scripts/init-env.sh
./scripts/init-env.sh

# Web dashboard (isi secret di .env / web/.env.local dulu bila akan `npm run build` produksi)
cd web && npm install && cd ..
```

### 3. Configure env (hanya isi secret)

`./scripts/init-env.sh` sudah membuat file dari `*.example` dan mengisi path (`CLIPPER_REPO_ROOT`, `CLIPPER_OUTPUT`, `PYTHON_BIN`, font FFmpeg di Linux). **Anda hanya mengedit nilai API:**

Di VPS penuh, `sudo ./scripts/vps-bootstrap.sh` juga memanggil `init-env.sh` setelah venv dibuat.

**Minimum keys required:**

- `GROQ_API_KEY` — free at [https://console.groq.com](https://console.groq.com)
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` +
`SUPABASE_SERVICE_ROLE_KEY` — from Supabase Dashboard → Settings → API

### 4. Run migrations

In Supabase Dashboard → SQL Editor, run the files in order:

```
supabase/migrations/001_jobs.sql
supabase/migrations/002_phase4_monetization_analytics.sql
supabase/migrations/003_phase5_beta_social.sql
supabase/migrations/004_release_ready.sql
supabase/migrations/005_cleanup_and_admin.sql
```

Migration 005 promotes `imadmin@verinusa.com` to admin. Change that literal to
your own email before running if you self-host.

### 5. Start

```bash
cd web && npm run dev
# visit http://localhost:3000
```

Sign up, verify the email in Supabase Dashboard → Authentication, and you are
dropped into `/dashboard/welcome`. The background worker spawns per job via
`web/scripts/process-job.mjs` — no separate daemon required.

---

## Production deploy (Bluehost VPS, Ubuntu 22.04)

- **Instal dependensi otomatis (VPS Ubuntu/Debian baru):** jalankan
  [`scripts/vps-bootstrap.sh`](scripts/vps-bootstrap.sh) — panduan singkat
  [`deploy/VPS_BOOTSTRAP.md`](deploy/VPS_BOOTSTRAP.md) (ffmpeg, Python venv,
  Node 20, yt-dlp, `npm ci` + `build`). Env & migrasi Supabase tetap manual.
- **Nginx + PM2 + SSL + cron:** [`deploy/BLUEHOST.md`](deploy/BLUEHOST.md).

---

## Project structure

```
clipper/           Python package (CLI: `python -m clipper <url>`)
  pipeline.py      Full pipeline (download → transcribe → LLM → render)
  llm/             Provider abstractions (groq, gemini, openai, anthropic)
  transcribe.py    Groq Whisper + local fallback
  phase3_*.py      9:16 vertical reframe + karaoke captions
  events.py        POSTs progress rows to Supabase job_events
web/               Next.js 14 dashboard (App Router)
  app/             Pages + API routes
  lib/             Shared types, Supabase clients, tier catalog
  scripts/         Node workers (process-job, purge-old-jobs)
supabase/
  migrations/      Ordered SQL migrations
deploy/            Ops docs + docker helpers
```

---

## Legal

- Privacy policy → `[deploy/PRIVACY.md](deploy/PRIVACY.md)` (ID/EN)
- Terms of service → `[deploy/TERMS.md](deploy/TERMS.md)` (ID/EN)
- Attribution required for the underlying models (Llama 3.3 → Meta Llama
Community License; Gemini / GPT-4o / Claude → commercial APIs; Whisper →
Apache 2.0).

---

## License

MIT for the glue code in this repository. Third-party models and services
remain under their own licences.