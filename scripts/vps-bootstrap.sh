#!/usr/bin/env bash
# Bootstrap Fai-Clipper on a fresh Ubuntu/Debian VPS: OS packages, Node 20,
# yt-dlp, Python venv + pip deps, Next.js build. File env diisi otomatis oleh
# scripts/init-env.sh (tanpa cp manual — hanya edit API key). Idempotent-ish.
#
# Usage (recommended — clone repo dulu, lalu dari root repo):
#   chmod +x scripts/vps-bootstrap.sh
#   sudo ./scripts/vps-bootstrap.sh
#
# Atau clone otomatis (set URL repo Anda):
#   curl -fsSL .../vps-bootstrap.sh | sudo -E bash -s
#   sudo CLONE_URL="https://github.com/you/AI-Video-Clipper.git" REPO_ROOT=/opt/fai-clipper/app ./scripts/vps-bootstrap.sh
#
# Env opsional:
#   REPO_ROOT=/path/to/repo     (default: parent folder script ini, atau /opt/fai-clipper/app jika --clone)
#   CLONE_URL=...               (git clone ke REPO_ROOT jika folder belum ada)
#   SKIP_PM2=1                  (jangan pasang pm2 global)
#   SKIP_NODE=1                 (skip Node install — pakai node yang sudah ada)
#   SKIP_APT=1                  (skip apt — hanya venv + npm; butuh root tidak wajib)

set -euo pipefail

# Saat `curl … | bash`, path skrip bisa tidak ada — pakai REPO_ROOT / CLONE_URL.
SCRIPT_DIR=""
if [[ "${BASH_SOURCE[0]:-}" == */* ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
DEFAULT_FROM_SCRIPT=""
[[ -n "$SCRIPT_DIR" ]] && DEFAULT_FROM_SCRIPT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="${REPO_ROOT:-}"
CLONE_URL="${CLONE_URL:-}"
SKIP_PM2="${SKIP_PM2:-0}"
SKIP_NODE="${SKIP_NODE:-0}"
SKIP_APT="${SKIP_APT:-0}"

log() { printf '\n[%s] %s\n' "$(date -Iseconds)" "$*"; }

if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
fi
if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" && "${SKIP_APT:-0}" != "1" ]]; then
  log "Peringatan: distro '${ID:-unknown}' — langkah apt belum diuji. Lanjut 10 detik… (Ctrl+C batal)"
  sleep 10
fi

need_sudo() {
  if [[ "${EUID:-0}" -ne 0 && "${SKIP_APT}" != "1" ]]; then
    log "Jalankan dengan sudo untuk apt install, contoh: sudo $0"
    exit 1
  fi
}

install_apt() {
  need_sudo
  log "apt: paket sistem (ffmpeg, python, build tools, font drawtext)…"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential git curl wget unzip ca-certificates \
    python3 python3-venv python3-pip \
    ffmpeg \
    fonts-dejavu-core \
    libglib2.0-0 libsm6 libxext6 libxrender1
}

install_node() {
  need_sudo
  if command -v node >/dev/null 2>&1 && [[ "$(node -v 2>/dev/null || true)" == v20* || "$(node -v 2>/dev/null || true)" == v22* ]]; then
    log "Node sudah ada: $(node -v) — lewati install NodeSource."
    return 0
  fi
  log "Node.js 20 LTS (NodeSource)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
}

install_ytdlp() {
  need_sudo
  log "yt-dlp binary → /usr/local/bin/yt-dlp"
  curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o /usr/local/bin/yt-dlp
  chmod a+rx /usr/local/bin/yt-dlp
}

install_pm2() {
  [[ "$SKIP_PM2" == "1" ]] && return 0
  need_sudo
  if command -v pm2 >/dev/null 2>&1; then
    log "pm2 sudah terpasang."
    return 0
  fi
  log "pm2 global…"
  npm install -g pm2
}

# File env: semua lewat scripts/init-env.sh (satu sumber kebenaran).

resolve_repo() {
  if [[ -n "${REPO_ROOT:-}" ]]; then
    echo "$REPO_ROOT"
    return
  fi
  if [[ -n "$DEFAULT_FROM_SCRIPT" && -f "$DEFAULT_FROM_SCRIPT/requirements.txt" ]]; then
    echo "$DEFAULT_FROM_SCRIPT"
    return
  fi
  echo "/opt/fai-clipper/app"
}

REPO_ROOT="$(resolve_repo)"

if [[ ! -f "$REPO_ROOT/requirements.txt" && -z "${CLONE_URL:-}" ]]; then
  log "ERROR: Tidak menemukan requirements.txt di REPO_ROOT=$REPO_ROOT"
  log "Clone repo dulu, atau jalankan: sudo CLONE_URL='https://…git' REPO_ROOT=$REPO_ROOT $0"
  exit 1
fi

if [[ -n "$CLONE_URL" ]]; then
  if [[ ! -f "$REPO_ROOT/requirements.txt" ]]; then
    log "git clone → $REPO_ROOT"
    mkdir -p "$(dirname "$REPO_ROOT")"
    if [[ ! -d "$REPO_ROOT/.git" ]]; then
      git clone --depth 1 "$CLONE_URL" "$REPO_ROOT"
    else
      log "Folder $REPO_ROOT sudah ada & berisi git — lewati clone."
    fi
  fi
fi

if [[ ! -f "$REPO_ROOT/requirements.txt" ]]; then
  log "ERROR: Masih tidak ada requirements.txt di $REPO_ROOT (periksa CLONE_URL / izin folder)."
  exit 1
fi

if [[ "$SKIP_APT" != "1" ]]; then
  install_apt
  if [[ "$SKIP_NODE" != "1" ]]; then
    install_node
  fi
  install_ytdlp
  install_pm2
else
  log "SKIP_APT=1 — melewati apt, node, yt-dlp, pm2."
fi

cd "$REPO_ROOT"
log "Python venv di $REPO_ROOT/.venv …"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck source=/dev/null
source .venv/bin/activate
pip install -U pip wheel
pip install -r requirements.txt

log "File .env & web/.env.local (scripts/init-env.sh — salin dari *.example + path + merge key baru)…"
export REPO_ROOT
chmod +x "$REPO_ROOT/scripts/init-env.sh" 2>/dev/null || true
bash "$REPO_ROOT/scripts/init-env.sh"

log "Next.js: npm ci + build …"
cd "$REPO_ROOT/web"
if [[ ! -f package.json ]]; then
  log "ERROR: web/package.json tidak ada."
  exit 1
fi
npm ci
npm run build

deactivate 2>/dev/null || true

log "Selesai instalasi teknis."
log "Lihat output init-env.sh di atas (CHECKLIST). Ringkas:"
log "  • Edit .env + web/.env.local — isi key wajib; opsional kosong atau #."
log "  • Migrasi SQL di Supabase. Produksi: pm2 (lihat deploy/VPS_BOOTSTRAP.md)."
log "Verifikasi: cd $REPO_ROOT && .venv/bin/python -m clipper --help"
