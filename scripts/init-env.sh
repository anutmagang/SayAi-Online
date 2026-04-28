#!/usr/bin/env bash
# Siapkan .env dan web/.env.local secara otomatis dari *.example — tanpa perintah cp manual.
# - Jika file belum ada (atau kosong): salin penuh dari contoh.
# - Jika file sudah ada: tambahkan saja variabel dari contoh yang belum ada (nilai yang sudah Anda isi tidak dihapus).
# - Setelah itu: set path (CLIPPER_OUTPUT, CLIPPER_REPO_ROOT, PYTHON_BIN, font FFmpeg di Linux).
#
# Usage (dari root repo, tanpa sudo):
#   chmod +x scripts/init-env.sh
#   ./scripts/init-env.sh
#
# REPO_ROOT=/path/to/repo ./scripts/init-env.sh   # opsional

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

info() { printf '[init-env] %s\n' "$*"; }

merge_missing_keys_from_example() {
  local example="$1" target="$2"
  [[ -f "$example" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line// }" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      if ! grep -qE "^[[:space:]]*${key}=" "$target" 2>/dev/null; then
        echo "$line" >> "$target"
      fi
    fi
  done < "$example"
}

ensure_env_pair() {
  local file="$1" key="$2" val="$3"
  if grep -qE "^[[:space:]]*${key}=" "$file" 2>/dev/null; then
    sed -i "s#^[[:space:]]*${key}=.*#${key}=${val}#" "$file"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$file"
  fi
}

mkdir -p "${REPO_ROOT}/output"

# --- Root .env ---
if [[ ! -f .env ]] || [[ ! -s .env ]]; then
  cp .env.example .env
  info "Dibuat .env dari .env.example (lengkap)."
else
  merge_missing_keys_from_example .env.example .env
  info ".env sudah ada — variabel baru dari .env.example ditambahkan bila belum ada."
fi
chmod 600 .env 2>/dev/null || true

# Hindari bentrok dengan baris contoh yang masih berupa komentar #KEY=
sed -i '/^[[:space:]]*# CLIPPER_OUTPUT=/d' .env 2>/dev/null || true
sed -i '/^[[:space:]]*# FFMPEG_DRAW_TEXT_FONT=/d' .env 2>/dev/null || true

ensure_env_pair .env CLIPPER_OUTPUT "${REPO_ROOT}/output"

DEJAVU="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
if [[ -f "$DEJAVU" ]]; then
  ensure_env_pair .env FFMPEG_DRAW_TEXT_FONT "$DEJAVU"
elif [[ -f "/c/Windows/Fonts/arial.ttf" ]]; then
  ensure_env_pair .env FFMPEG_DRAW_TEXT_FONT "/c/Windows/Fonts/arial.ttf"
elif [[ -n "${WINDIR:-}" && -f "${WINDIR}/Fonts/arial.ttf" ]]; then
  ensure_env_pair .env FFMPEG_DRAW_TEXT_FONT "${WINDIR}/Fonts/arial.ttf"
fi

# --- web/.env.local ---
if [[ ! -f web/.env.local ]] || [[ ! -s web/.env.local ]]; then
  cp web/.env.local.example web/.env.local
  info "Dibuat web/.env.local dari web/.env.local.example (lengkap)."
else
  merge_missing_keys_from_example web/.env.local.example web/.env.local
  info "web/.env.local sudah ada — variabel baru dari contoh ditambahkan bila belum ada."
fi
chmod 600 web/.env.local 2>/dev/null || true

for _k in CLIPPER_OUTPUT CLIPPER_REPO_ROOT PYTHON_BIN FFMPEG_DRAW_TEXT_FONT; do
  sed -i "/^[[:space:]]*# ${_k}=/d" web/.env.local 2>/dev/null || true
done

PYBIN="python3"
if [[ -x "${REPO_ROOT}/.venv/bin/python" ]]; then
  PYBIN="${REPO_ROOT}/.venv/bin/python"
fi

ensure_env_pair web/.env.local CLIPPER_REPO_ROOT "$REPO_ROOT"
ensure_env_pair web/.env.local PYTHON_BIN "$PYBIN"
ensure_env_pair web/.env.local CLIPPER_OUTPUT "${REPO_ROOT}/output"

if [[ -f "$DEJAVU" ]]; then
  ensure_env_pair web/.env.local FFMPEG_DRAW_TEXT_FONT "$DEJAVU"
elif [[ -f "/c/Windows/Fonts/arial.ttf" ]]; then
  ensure_env_pair web/.env.local FFMPEG_DRAW_TEXT_FONT "/c/Windows/Fonts/arial.ttf"
fi

info "Selesai. Isi / edit hanya secret: GROQ_API_KEY (root .env), NEXT_PUBLIC_SUPABASE_* & SUPABASE_SERVICE_ROLE_KEY (web/.env.local)."
