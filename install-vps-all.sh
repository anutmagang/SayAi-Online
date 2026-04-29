#!/usr/bin/env bash
# Full automatic installer for Fai-Clipper on fresh Ubuntu/Debian VPS.
# Installs all dependencies, prepares env files, builds app, configures PM2,
# configures Nginx reverse proxy, and optionally enables HTTPS via Let's Encrypt.
#
# Usage examples:
#   sudo bash install-vps-all.sh --repo /opt/fai-clipper/app
#   sudo bash install-vps-all.sh --repo /opt/fai-clipper/app --clone "https://github.com/you/repo.git"
#   sudo bash install-vps-all.sh --repo /opt/fai-clipper/app --domain clip.example.com --email you@example.com
#   # NEXT_PUBLIC_SITE_URL (tautan email Supabase / redirect) — otomatis https://DOMAIN jika --public-url tidak diisi:
#   sudo bash install-vps-all.sh --repo /opt/fai-clipper/app --clone "https://github.com/you/repo.git" \
#     --domain sayai.online --email admin@sayai.online --public-url https://sayai.online
#   sudo bash install-vps-all.sh --repo /opt/fai-clipper/app --app-user ubuntu --skip-build
#   sudo bash install-vps-all.sh --repo /opt/fai-clipper/app --db-url "postgresql://..."
#
# After install: edit API keys only, then restart:
#   pm2 restart fai-clipper-web
#
# Jika nanti 502 / "upstream sent too big header" / port bentrok:
#   sudo bash /path/to/repo/scripts/vps-heal-proxy-pm2.sh

set -euo pipefail

REPO_DIR=""
CLONE_URL=""
SKIP_BUILD="0"
APP_USER="${SUDO_USER:-root}"
APP_PORT="3000"
DOMAIN=""
EMAIL=""
NGINX_SITE_NAME="fai-clipper"
ENABLE_SSL="1"
DB_URL=""
RUN_DB_MIGRATIONS="0"
# URL publik tanpa slash akhir (contoh https://sayai.online) → ditulis ke web/.env.local sebagai NEXT_PUBLIC_SITE_URL
PUBLIC_SITE_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_DIR="${2:-}"
      shift 2
      ;;
    --clone)
      CLONE_URL="${2:-}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD="1"
      shift
      ;;
    --app-user)
      APP_USER="${2:-}"
      shift 2
      ;;
    --port)
      APP_PORT="${2:-3000}"
      shift 2
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --no-ssl)
      ENABLE_SSL="0"
      shift
      ;;
    --db-url)
      DB_URL="${2:-}"
      RUN_DB_MIGRATIONS="1"
      shift 2
      ;;
    --public-url)
      PUBLIC_SITE_URL="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1"
      exit 2
      ;;
  esac
done

if [[ -z "${REPO_DIR}" ]]; then
  echo "ERROR: --repo is required (example: --repo /opt/fai-clipper/app)"
  exit 2
fi

log() {
  printf "\n[%s] %s\n" "$(date -Iseconds)" "$*"
}

need_root() {
  if [[ "${EUID:-0}" -ne 0 ]]; then
    echo "ERROR: run as root/sudo"
    exit 1
  fi
}

need_root

if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
    log "WARNING: distro '${ID:-unknown}' not officially tested. Continue."
  fi
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  echo "ERROR: user '${APP_USER}' does not exist. Create it first or use --app-user."
  exit 1
fi

run_as_app() {
  su - "${APP_USER}" -c "$*"
}

ensure_env_files_fallback() {
  log "init-env.sh not found, using fallback copy from *.example..."
  if [[ -f "${REPO_DIR}/.env.example" && ! -f "${REPO_DIR}/.env" ]]; then
    run_as_app "cp '${REPO_DIR}/.env.example' '${REPO_DIR}/.env'"
  fi
  if [[ -f "${REPO_DIR}/web/.env.local.example" && ! -f "${REPO_DIR}/web/.env.local" ]]; then
    run_as_app "cp '${REPO_DIR}/web/.env.local.example' '${REPO_DIR}/web/.env.local'"
  fi
}

upsert_env_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  touch "${file}"
  if grep -qE "^[[:space:]]*${key}=" "${file}"; then
    sed -i "s|^[[:space:]]*${key}=.*|${key}=${value}|g" "${file}"
  else
    printf "%s=%s\n" "${key}" "${value}" >> "${file}"
  fi
}

log "Installing OS dependencies..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential git curl wget unzip ca-certificates \
  python3 python3-venv python3-pip \
  postgresql-client \
  ffmpeg \
  nginx \
  certbot python3-certbot-nginx \
  fonts-dejavu-core \
  libglib2.0-0 libsm6 libxext6 libxrender1

if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v || true)"
else
  NODE_VER=""
fi
if [[ "${NODE_VER}" != v20* && "${NODE_VER}" != v22* ]]; then
  log "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  log "Node already present: ${NODE_VER}"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2 globally..."
  npm install -g pm2
fi

log "Installing yt-dlp binary..."
curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
  -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp

if [[ -n "${CLONE_URL}" && ! -f "${REPO_DIR}/requirements.txt" ]]; then
  log "Cloning repository..."
  mkdir -p "$(dirname "${REPO_DIR}")"
  git clone --depth 1 "${CLONE_URL}" "${REPO_DIR}"
fi

if [[ ! -f "${REPO_DIR}/requirements.txt" ]]; then
  echo "ERROR: ${REPO_DIR}/requirements.txt not found."
  echo "Set --repo to existing project root, or pass --clone."
  exit 1
fi

run_db_migrations() {
  if [[ "${RUN_DB_MIGRATIONS}" != "1" ]]; then
    return 0
  fi
  if [[ -z "${DB_URL}" ]]; then
    echo "ERROR: --db-url is required when DB migration is enabled."
    exit 1
  fi
  if [[ ! -d "${REPO_DIR}/supabase/migrations" ]]; then
    echo "ERROR: migration folder missing: ${REPO_DIR}/supabase/migrations"
    exit 1
  fi
  log "Running database migrations via psql..."
  local file=""
  local found_any="0"
  for file in "${REPO_DIR}"/supabase/migrations/*.sql; do
    [[ -e "${file}" ]] || continue
    found_any="1"
    log "Applying migration $(basename "${file}")"
    psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${file}"
  done
  if [[ "${found_any}" != "1" ]]; then
    echo "ERROR: no SQL migration files found."
    exit 1
  fi
  log "Database migrations completed."
}

log "Setting ownership to app user (${APP_USER})..."
chown -R "${APP_USER}:${APP_USER}" "${REPO_DIR}"

cd "${REPO_DIR}"

log "Creating Python virtualenv..."
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -U pip wheel
pip install -r requirements.txt

log "Initializing env files (.env and web/.env.local)..."
if [[ -f "${REPO_DIR}/scripts/init-env.sh" ]]; then
  chmod +x "${REPO_DIR}/scripts/init-env.sh"
  run_as_app "cd '${REPO_DIR}' && bash scripts/init-env.sh"
else
  ensure_env_files_fallback
fi
upsert_env_key "${REPO_DIR}/web/.env.local" "PORT" "${APP_PORT}"
# Domain publik untuk bundel Next (reset password, konsistensi origin)
if [[ -n "${PUBLIC_SITE_URL}" ]]; then
  PUBLIC_SITE_URL="${PUBLIC_SITE_URL%/}"
  upsert_env_key "${REPO_DIR}/web/.env.local" "NEXT_PUBLIC_SITE_URL" "${PUBLIC_SITE_URL}"
elif [[ -n "${DOMAIN}" ]]; then
  upsert_env_key "${REPO_DIR}/web/.env.local" "NEXT_PUBLIC_SITE_URL" "https://${DOMAIN}"
fi
chown -R "${APP_USER}:${APP_USER}" "${REPO_DIR}"

if [[ "${SKIP_BUILD}" != "1" ]]; then
  log "Installing web dependencies and building..."
  cd "${REPO_DIR}/web"
  run_as_app "cd '${REPO_DIR}/web' && npm ci"
  run_as_app "cd '${REPO_DIR}/web' && npm run build"
  cd ..
else
  log "Skipping web build (--skip-build)."
fi

deactivate || true

log "Configuring PM2 process..."
# Hapus semua proses PM2 user ini agar tidak ada duplikat port (EADDRINUSE).
run_as_app "pm2 delete all >/dev/null 2>&1 || true"
run_as_app "cd '${REPO_DIR}/web' && PORT='${APP_PORT}' pm2 start npm --name fai-clipper-web -- start"
run_as_app "pm2 save"
pm2 startup systemd -u "${APP_USER}" --hp "$(eval echo "~${APP_USER}")" >/tmp/pm2-startup.txt 2>/dev/null || true
if grep -q "sudo" /tmp/pm2-startup.txt; then
  # shellcheck disable=SC2046
  bash -lc "$(grep -Eo 'sudo .*$' /tmp/pm2-startup.txt | sed 's/^sudo //')"
fi
rm -f /tmp/pm2-startup.txt

log "Configuring Nginx reverse proxy..."
cat >"/etc/nginx/sites-available/${NGINX_SITE_NAME}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN:-_};
    # Hanya valid di level server/http — bukan di dalam location
    large_client_header_buffers 4 64k;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Header respons Next+Supabase besar → 502 bila buffer kecil
        proxy_buffer_size 128k;
        proxy_buffers 8 256k;
        proxy_busy_buffers_size 256k;
    }
}
EOF

ln -sfn "/etc/nginx/sites-available/${NGINX_SITE_NAME}" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
if [[ -e /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl enable nginx
systemctl restart nginx

if [[ "${ENABLE_SSL}" == "1" && -n "${DOMAIN}" && -n "${EMAIL}" ]]; then
  log "Enabling HTTPS with Let's Encrypt..."
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect
else
  log "Skipping SSL auto setup (set --domain and --email, and don't use --no-ssl)."
fi

run_db_migrations

cat <<EOF

========================================================
INSTALL FINISHED
========================================================
Repo: ${REPO_DIR}
User: ${APP_USER}
Port: ${APP_PORT}
Domain: ${DOMAIN:-not-set}

Manual steps left:
0) Supabase Dashboard → Authentication → URL configuration:
     Site URL = sama dengan NEXT_PUBLIC_SITE_URL di web/.env.local (mis. https://sayai.online).
     Redirect URLs: https://YOUR_DOMAIN/auth/callback (dan wildcard yang Anda pakai).

1) Edit API keys only:
   - ${REPO_DIR}/.env
   - ${REPO_DIR}/web/.env.local
   Minimal required:
   - GROQ_API_KEY
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY

2) Database migration:
   - $( [[ "${RUN_DB_MIGRATIONS}" == "1" ]] && echo "Sudah dijalankan otomatis via --db-url" || echo "Belum dijalankan (tambahkan --db-url untuk auto migration)" )

3) Restart app after editing keys:
   su - ${APP_USER} -c "pm2 restart fai-clipper-web && pm2 save"

4) Check status:
   systemctl status nginx
   su - ${APP_USER} -c "pm2 status"

5) Jika 502 Bad Gateway atau log nginx "upstream sent too big header" / PM2 EADDRINUSE:
   sudo bash ${REPO_DIR}/scripts/vps-heal-proxy-pm2.sh
========================================================
EOF

