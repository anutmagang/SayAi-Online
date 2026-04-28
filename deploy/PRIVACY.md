# Kebijakan Privasi · Privacy Policy — Fai-Clipper

_Versi 1.0 · berlaku sejak 23 April 2026._

---

## Bahasa Indonesia

**Operator:** Verinusa (kontak: hello@verinusa.com).
Website: [https://fai.verinusa.com](https://fai.verinusa.com).

### 1. Data yang kami proses

| Kategori | Contoh | Sumber | Tujuan |
|---|---|---|---|
| Identitas akun | email, tanggal daftar, status verifikasi email | pendaftaran di Supabase | login, komunikasi layanan |
| Metadata pembayaran | nominal, tanggal transfer, no referensi bank, catatan | input manual saat top-up / upgrade | verifikasi pembayaran |
| Konten yang Anda kirim | URL video, file video yang di-upload, hasil klip | pemakaian layanan | memproses & mengirim ulang hasilnya kepada Anda |
| Telemetri teknis | job log, error message, kode HTTP, durasi job | otomatis | debug, optimasi, fraud prevention |

Kami tidak menyimpan nomor kartu / data rekening lengkap. Pembayaran saat ini
diproses manual via transfer bank; ketika integrasi Midtrans / Stripe aktif,
data kartu ditangani sepenuhnya oleh payment processor, bukan oleh kami.

### 2. Berapa lama data disimpan

- **Source video & klip:** 14 hari sejak job selesai, lalu dihapus otomatis
  dari Supabase Storage oleh cron `purge_old_jobs`. Silakan download dulu
  sebelum itu.
- **Metadata job** (timestamp, durasi, tier, provider AI): 12 bulan, untuk
  audit penggunaan & dispute.
- **Akun:** selama akun aktif. Jika akun dihapus, seluruh data terkait
  ikut terhapus (ON DELETE CASCADE) dalam 14 hari.
- **Catatan top-up / subscription:** 5 tahun demi compliance pajak Indonesia.

### 3. Pihak ketiga

Kami mengirim data ke layanan berikut hanya sebatas yang diperlukan untuk
menjalankan fitur:

- **Supabase** — auth + database + storage (data center Singapura / US).
- **Groq** — transcription & LLM default. Audio pendek (< 25 MB) dikirim per
  request.
- **Google AI (Gemini)** — opsional untuk tier Starter & Pro.
- **OpenAI / Anthropic** — opsional untuk tier Pro.
- **Sentry** — error reporting (tanpa konten video / transkrip).

Vendor tersebut memiliki kebijakan privasinya masing-masing. Kami tidak
menjual data Anda ke pihak ketiga untuk tujuan iklan.

### 4. Hak Anda

Sesuai UU PDP 27/2022, Anda berhak:

- meminta salinan data yang kami simpan tentang Anda,
- memperbaiki data yang salah,
- menghapus akun & data Anda,
- menolak pemrosesan tertentu.

Kirim permintaan ke **hello@verinusa.com** dari email akun Anda. Kami balas
maksimal 14 hari kerja.

### 5. Keamanan

- Seluruh traffic HTTPS (Let's Encrypt).
- Storage bucket private; akses file lewat signed URL TTL 1 jam.
- RLS Supabase aktif di seluruh tabel.
- Service-role key hanya dipakai server, tidak pernah dikirim ke browser.

### 6. Perubahan kebijakan

Perubahan material akan diumumkan via email minimal 14 hari sebelum berlaku.

---

## English

**Operator:** Verinusa (contact: hello@verinusa.com).
Website: [https://fai.verinusa.com](https://fai.verinusa.com).

### 1. Data we process

| Category | Examples | Source | Purpose |
|---|---|---|---|
| Account identity | email, signup date, email verification status | Supabase signup | login, service communication |
| Payment metadata | amount, date, bank reference, notes | manual entry during top-up / upgrade | payment verification |
| User-submitted content | source URLs, uploaded video files, generated clips | product usage | process and deliver results back to you |
| Technical telemetry | job logs, error messages, HTTP codes, durations | automatic | debugging, optimisation, abuse prevention |

We do not store full card / bank account numbers. Payments are currently
handled manually via bank transfer; once Midtrans / Stripe integration lands,
card data is handled by the processor, not us.

### 2. Retention

- **Source videos & clips:** 14 days after the job finishes, then auto-deleted
  from Supabase Storage by the `purge_old_jobs` cron. Download before then.
- **Job metadata** (timestamps, duration, tier, provider): 12 months, for
  audit & dispute handling.
- **Account:** as long as the account is active. Deletion cascades within 14
  days.
- **Billing records:** 5 years, per Indonesian tax requirements.

### 3. Third parties

We send data to the following services only to the extent required to run the
feature:

- **Supabase** — auth + database + storage (SG / US region).
- **Groq** — default transcription & LLM; short audio (< 25 MB) sent per request.
- **Google AI (Gemini)** — optional for Starter & Pro tier.
- **OpenAI / Anthropic** — optional for Pro tier.
- **Sentry** — error telemetry (no video / transcript content attached).

We do not sell your data to advertisers.

### 4. Your rights

Per Indonesia's PDP Law 27/2022 (and GDPR-style practice), you may:

- request a copy of the data we hold on you,
- request corrections,
- delete your account and its data,
- object to specific processing.

Email **hello@verinusa.com** from your account email. We reply within 14
working days.

### 5. Security

- All traffic over HTTPS (Let's Encrypt).
- Storage buckets are private; files served via 1-hour signed URLs.
- Row-level security (RLS) enforced on every table.
- Service-role keys live server-side only, never reach the browser.

### 6. Changes

Material changes are announced at least 14 days before they take effect.
