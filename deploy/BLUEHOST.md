# Bluehost VPS deployment guide — Fai-Clipper

Tested on Ubuntu 22.04, 4 GB RAM / 2 vCPU / 100 GB SSD (Bluehost Standard VPS).
The pipeline is CPU-bound — more vCPU = shorter render times.

---

## 0. DNS

Point your subdomain (e.g. `fai.verinusa.com`) to the VPS IP (A record).

## 1. OS packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential git curl wget unzip \
  python3 python3-venv python3-pip \
  ffmpeg \
  nginx certbot python3-certbot-nginx \
  redis-server

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# yt-dlp (binary, keeps itself updated via `--update`)
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

## 2. Create app user & clone

```bash
sudo adduser --system --group --home /opt/fai-clipper fai
sudo -iu fai

git clone <repo-url> /opt/fai-clipper/app
cd /opt/fai-clipper/app

python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt

chmod +x scripts/init-env.sh
./scripts/init-env.sh
# Wajib isi secret di .env dan web/.env.local SEBELUM npm build (NEXT_PUBLIC_* di-embed saat build).
#   GROQ_API_KEY, NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, MAX_UPLOAD_MB, opsional Sentry
chmod 600 .env web/.env.local

cd web
npm ci
npm run build
cd ..
```

## 3. Env (ringkas)

`./scripts/init-env.sh` sudah dijalankan di langkah 2. Jika menambah variabel baru dari upstream, jalankan lagi `./scripts/init-env.sh` (hanya menambah key yang belum ada). Setelah **`scripts/vps-bootstrap.sh`**, env juga diurus otomatis.

## 4. Run migrations

Paste each file in order into Supabase Dashboard → SQL Editor:

1. `supabase/migrations/001_jobs.sql`
2. `supabase/migrations/002_phase4_monetization_analytics.sql`
3. `supabase/migrations/003_phase5_beta_social.sql`
4. `supabase/migrations/004_release_ready.sql`
5. `supabase/migrations/005_cleanup_and_admin.sql` *(sesuaikan email admin)*

## 5. PM2 process

```bash
cd /opt/fai-clipper/app/web
pm2 start npm --name fai-clipper-web -- start
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u fai --hp /opt/fai-clipper
```

## 6. Nginx + HTTPS

```nginx
# /etc/nginx/sites-available/fai-clipper
server {
  server_name fai.verinusa.com;
  client_max_body_size 10m;  # signed upload goes direct to Supabase, not through us
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/fai-clipper /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d fai.verinusa.com
```

Update Supabase → Auth → URL configuration:
- Site URL: `https://fai.verinusa.com`
- Redirect URLs: `https://fai.verinusa.com/auth/callback`

## 7. Retention cron

```bash
crontab -u fai -e
```

Add:

```
0 3 * * * /usr/bin/node /opt/fai-clipper/app/web/scripts/purge-old-jobs.mjs >> /opt/fai-clipper/retention.log 2>&1
```

## 8. Smoke test

```bash
# as fai
cd /opt/fai-clipper/app
source .venv/bin/activate
python -m clipper "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --job-id 00000000-0000-0000-0000-000000000001 -o /tmp/fai-smoke
ls /tmp/fai-smoke/00000000-0000-0000-0000-000000000001/clips/
```

Expected: several `clip_XX.mp4` files + `clips.json`.

## 9. Updating

```bash
sudo -iu fai
cd /opt/fai-clipper/app
git pull
source .venv/bin/activate && pip install -r requirements.txt
cd web && npm ci && npm run build
pm2 restart fai-clipper-web
```

---

## Scaling notes

- 4 vCPU / 8 GB RAM handles ≈ 20–30 concurrent Free-tier jobs comfortably
  thanks to Groq Whisper doing the heavy lifting remotely.
- If you grow: move ffmpeg to a dedicated render worker by running
  `process-job.mjs` on a separate box (it pulls state from Supabase and writes
  back — no coordination needed).
- Storage: Supabase free tier is 1 GB — budget for the paid plan once you
  cross ~30 active users.
