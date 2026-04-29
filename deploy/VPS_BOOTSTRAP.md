# Setup VPS baru — satu skrip instal dependensi

## VPS dari nol (paling lengkap: Node, PM2, Nginx, SSL, build)

Dari **Ubuntu/Debian baru**, satu perintah (ganti URL git, domain, email, user):

```bash
# Repo publik: bisa unduh skrip mentah. Repo privat: git clone dulu, lalu jalankan file dari disk.
curl -fsSL -o /tmp/install-vps-all.sh "https://raw.githubusercontent.com/ANDA/AI-Video-Clipper/main/install-vps-all.sh"
sudo bash /tmp/install-vps-all.sh \
  --repo /opt/fai-clipper/app \
  --clone "https://github.com/ANDA/AI-Video-Clipper.git" \
  --app-user ubuntu \
  --domain sayai.online \
  --email admin@sayai.online \
  --public-url https://sayai.online

# Contoh jika repo sudah ada di /opt/fai-clipper/app (tanpa curl):
# sudo bash /opt/fai-clipper/app/install-vps-all.sh --repo /opt/fai-clipper/app --app-user ubuntu \
#   --domain sayai.online --email admin@sayai.online --public-url https://sayai.online
```

- **`--public-url`** (opsional): ditulis ke `web/.env.local` sebagai `NEXT_PUBLIC_SITE_URL` (tautan reset password & konsistensi domain). Jika dihilangkan tapi **`--domain`** diisi, skrip memakai `https://DOMAIN`.
- Setelah skrip selesai: isi **secret** di `.env` dan `web/.env.local` (Groq, Supabase), lalu **Supabase → Authentication → Site URL** = URL publik yang sama, dan **`pm2 restart fai-clipper-web`**.
- **Update kode** tanpa reinstall penuh (user yang sama dengan PM2):

```bash
cd /opt/fai-clipper/app && chmod +x scripts/vps-deploy-update.sh && ./scripts/vps-deploy-update.sh
```

---

Skrip **`scripts/vps-bootstrap.sh`** mengotomatiskan **paket OS + Python + build Next.js** dan memanggil **`scripts/init-env.sh`**, yang:

- Membuat **`.env`** dan **`web/.env.local`** dari `*.example` jika belum ada (atau file kosong); jika sudah ada, **hanya menambah** variabel dari contoh yang belum terdefinisi (nilai yang sudah Anda isi tidak dihapus).
- Mengatur **path**: `CLIPPER_OUTPUT`, `CLIPPER_REPO_ROOT`, `PYTHON_BIN` (prioritas `.venv/bin/python` jika ada), `FFMPEG_DRAW_TEXT_FONT` (Dejavu di Linux / Arial di Git Bash Windows).

**Tanpa perintah `cp .env.example` manual.** Yang tetap Anda isi: **API key & Supabase** serta **migrasi SQL** di dashboard.

Lokal / VPS ringan tanpa full bootstrap: jalankan saja `./scripts/init-env.sh` dari root repo.

## Prasyarat

- **Ubuntu 22.04 / 24.04** atau Debian 12 (distro lain: skrip akan peringati lalu lanjut).
- **sudo** / root untuk `apt`.
- **Git** repo ini sudah di-clone di server, *atau* set `CLONE_URL` (lihat bawah).

## Cara pakai (paling umum)

Sudah `git clone` repo ke misalnya `/opt/fai-clipper/app`:

```bash
cd /opt/fai-clipper/app
chmod +x scripts/vps-bootstrap.sh
sudo ./scripts/vps-bootstrap.sh
```

Skrip akan:

1. `apt install` — antara lain `ffmpeg`, `python3-venv`, `build-essential`, font Dejavu (untuk watermark drawtext), library tipis untuk OpenCV/MediaPipe.
2. **Node.js 20** (NodeSource) + **pm2** global (kecuali `SKIP_PM2=1`).
3. **yt-dlp** → `/usr/local/bin/yt-dlp`.
4. **`python3 -m venv .venv`** + `pip install -r requirements.txt`.
5. **`scripts/init-env.sh`**: membuat / melengkapi `.env` dan `web/.env.local` dari `*.example` + path (lihat atas).
6. **`cd web && npm ci && npm run build`**.

## Clone otomatis (repo belum ada di VPS)

Disarankan: **clone manual** satu baris, lalu jalankan skrip dari disk (paling andal):

```bash
sudo mkdir -p /opt/fai-clipper && sudo chown "$USER":"$USER" /opt/fai-clipper
git clone --depth 1 "https://github.com/ANDA/AI-Video-Clipper.git" /opt/fai-clipper/app
cd /opt/fai-clipper/app && chmod +x scripts/vps-bootstrap.sh && sudo ./scripts/vps-bootstrap.sh
```

Atau set `CLONE_URL` (skrip akan `git clone` ke `REPO_ROOT` bila belum ada isi):

```bash
sudo CLONE_URL="https://github.com/ANDA/AI-Video-Clipper.git" REPO_ROOT=/opt/fai-clipper/app ./scripts/vps-bootstrap.sh
```

(`./scripts/vps-bootstrap.sh` di sini = salinan skrip yang sudah Anda unduh/commit ke suatu path; untuk **hanya** `curl | bash` tanpa repo lokal, ekspor variabel lalu pipe — raw URL harus sesuai branch Anda.)

## Variabel lingkungan opsional

| Variabel | Fungsi |
|----------|--------|
| `REPO_ROOT` | Path root repo (default: direktori induk `scripts/`, atau `/opt/fai-clipper/app` bila dipakai dengan `--clone`). |
| `CLONE_URL` | URL git; clone ke `REPO_ROOT` jika belum ada `requirements.txt`. |
| `SKIP_APT=1` | Hanya jalankan venv + pip + `npm ci` / `build` (tanpa apt/node/yt-dlp/pm2). |
| `SKIP_NODE=1` | Lewati instal NodeSource (pakai Node yang sudah terpasang). |
| `SKIP_PM2=1` | Jangan `npm install -g pm2`. |

## Setelah skrip sukses

1. **Edit API & Supabase** (skrip sudah membuat file jika belum ada):
   - **`.env`**: setidaknya `GROQ_API_KEY=` … (dan kunci vendor opsional).
   - **`web/.env.local`**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (wajib untuk dashboard). Path repo & Python biasanya sudah terisi oleh bootstrap.
2. Migrasi database: urutan file di `supabase/migrations/` (sama seperti README).
3. Jalankan web: dev `cd web && npm run dev`, produksi **PM2 + Nginx** mengikuti [`deploy/BLUEHOST.md`](BLUEHOST.md).

Skrip **tidak** mengonfigurasi Nginx, SSL, atau systemd — itu tetap satu kali setup infra mengikuti panduan deploy Anda.
