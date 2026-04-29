#!/usr/bin/env bash
# Satu perintah: perbaiki 502 "upstream sent too big header" + rapikan PM2 (satu proses di PORT).
# Jalankan di VPS sebagai root:
#   sudo bash scripts/vps-heal-proxy-pm2.sh
# Opsional:
#   sudo REPO_ROOT=/opt/fai-clipper/app APP_USER=ubuntu APP_PORT=3000 NGINX_SITE=fai-clipper bash scripts/vps-heal-proxy-pm2.sh

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/fai-clipper/app}"
APP_USER="${APP_USER:-ubuntu}"
APP_PORT="${APP_PORT:-3000}"
NGINX_SITE="${NGINX_SITE:-fai-clipper}"

need_root() {
  if [[ "${EUID:-0}" -ne 0 ]]; then
    echo "ERROR: jalankan dengan sudo"
    exit 1
  fi
}

log() { printf '[vps-heal] %s\n' "$*"; }

ensure_nginx_buffers() {
  local site_avail="/etc/nginx/sites-available/${NGINX_SITE}"
  if [[ ! -f "${site_avail}" ]]; then
    log "SKIP nginx: tidak ada ${site_avail} (sesuaikan NGINX_SITE=...)"
    return 0
  fi
  if grep -qE 'proxy_buffer_size[[:space:]]+128k' "${site_avail}"; then
    log "nginx: buffer besar sudah ada — lewati patch."
    return 0
  fi
  if ! grep -q 'proxy_set_header X-Forwarded-Proto' "${site_avail}"; then
    log "WARN: tidak menemukan baris X-Forwarded-Proto — patch manual mungkin diperlukan."
    return 0
  fi
  local tmp
  tmp="$(mktemp)"
  awk '
    /proxy_set_header X-Forwarded-Proto/ && !ins {
      print
      print "        proxy_buffer_size 128k;"
      print "        proxy_buffers 8 256k;"
      print "        proxy_busy_buffers_size 256k;"
      print "        large_client_header_buffers 4 64k;"
      ins = 1
      next
    }
    { print }
  ' "${site_avail}" > "${tmp}"
  mv "${tmp}" "${site_avail}"
  log "nginx: buffer proxy ditambahkan ke ${site_avail}"
  nginx -t
  systemctl reload nginx
  log "nginx: reload OK"
}

heal_pm2() {
  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    log "SKIP pm2: user ${APP_USER} tidak ada"
    return 0
  fi
  if [[ ! -d "${REPO_ROOT}/web" ]]; then
    log "SKIP pm2: tidak ada ${REPO_ROOT}/web"
    return 0
  fi
  su - "${APP_USER}" -c "pm2 delete all >/dev/null 2>&1 || true"
  su - "${APP_USER}" -c "cd '${REPO_ROOT}/web' && PORT='${APP_PORT}' pm2 start npm --name fai-clipper-web -- start"
  su - "${APP_USER}" -c "pm2 save"
  log "pm2: satu proses fai-clipper-web di port ${APP_PORT}"
}

need_root
ensure_nginx_buffers
heal_pm2
log "Selesai. Tes: curl -sS -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:${APP_PORT}/"
