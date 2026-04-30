#!/usr/bin/env bash
# Pembaruan rutin di VPS: git pull, sync Python deps, npm ci + build, PM2 restart.
# Jalankan sebagai user yang memiliki repo DAN menjalankan PM2 (biasanya bukan root).
#
# Usage:
#   cd /opt/fai-clipper/app && chmod +x scripts/vps-deploy-update.sh && ./scripts/vps-deploy-update.sh
#
# Env opsional:
#   REPO_ROOT=/opt/fai-clipper/app   (default: direktori induk skrip ini)
#   PM2_NAME=fai-clipper-web         (default di bawah)
#   SKIP_PIP=1                     — lewati pip install (hanya git + npm + pm2)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PM2_NAME="${PM2_NAME:-fai-clipper-web}"
SKIP_PIP="${SKIP_PIP:-0}"

log() { printf '\n[%s] %s\n' "$(date -Iseconds)" "$*"; }

if [[ ! -f "$REPO_ROOT/requirements.txt" ]]; then
  echo "ERROR: REPO_ROOT=$REPO_ROOT tidak terlihat seperti root repo (requirements.txt hilang)."
  exit 1
fi

cd "$REPO_ROOT"
log "git pull (ff-only)…"
git pull --ff-only

if [[ -f "$REPO_ROOT/scripts/init-env.sh" ]]; then
  chmod +x "$REPO_ROOT/scripts/init-env.sh" 2>/dev/null || true
  log "init-env.sh — merge key baru dari .env.example / web/.env.local.example (nilai lama tetap)…"
  bash "$REPO_ROOT/scripts/init-env.sh"
fi

if [[ "$SKIP_PIP" != "1" ]]; then
  log "Python venv + pip install -r requirements.txt…"
  if [[ ! -d .venv ]]; then
    python3 -m venv .venv
  fi
  # shellcheck source=/dev/null
  source .venv/bin/activate
  pip install -q -U pip wheel
  pip install -q -r requirements.txt
  deactivate || true
else
  log "SKIP_PIP=1 — melewati pip."
fi

log "Next.js: npm ci + build…"
cd "$REPO_ROOT/web"
npm ci
npm run build

log "PM2 restart ${PM2_NAME}…"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME"
else
  log "Proses PM2 '${PM2_NAME}' tidak ada — coba: cd web && pm2 start npm --name ${PM2_NAME} -- start"
  exit 1
fi
pm2 save

log "Selesai. Cek: pm2 logs ${PM2_NAME} --lines 40"
