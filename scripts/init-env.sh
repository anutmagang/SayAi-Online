#!/usr/bin/env bash
# Siapkan .env dan web/.env.local secara otomatis dari *.example — tanpa perintah cp manual.
# - Jika file belum ada (atau kosong): salin penuh dari contoh.
# - Jika file sudah ada: tambahkan saja variabel dari contoh yang belum ada (nilai yang sudah Anda isi tidak dihapus).
# - Setelah itu: set path (CLIPPER_OUTPUT, CLIPPER_REPO_ROOT, PYTHON_BIN, font FFmpeg di Linux).
# - Folder secrets/ untuk cookie YouTube server (opsional); isi manual — tidak di-commit (gitignore).
#
# Yang WAJIB Anda isi setelah skrip ini: lihat pesan "CHECKLIST" di akhir output.
# Yang opsional: biarkan kosong, atau tambahkan # di depan baris di .env / web/.env.local untuk menonaktifkan.
#
# Usage (dari root repo, tanpa sudo):
#   chmod +x scripts/init-env.sh
#   ./scripts/init-env.sh
#
# REPO_ROOT=/path/to/repo ./scripts/init-env.sh   # opsional
# VPS penuh (nginx+ssl+pm2): install-vps-all.sh — juga memanggil init-env ini.

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
mkdir -p "${REPO_ROOT}/secrets"
chmod 700 "${REPO_ROOT}/secrets" 2>/dev/null || true
if [[ ! -f "${REPO_ROOT}/secrets/README.txt" ]]; then
  cat >"${REPO_ROOT}/secrets/README.txt" <<'EOF'
Folder ini untuk file sensitif yang TIDAK di-commit (secrets/ di .gitignore).
Letakkan youtube-cookies.txt (format Netscape, dari youtube.com sudah login) di sini
agar worker memakai cookie server-wide — atau gunakan Pengaturan → Cookie YouTube per user.
Lihat .env.example bagian YTDLP_COOKIES / deploy/VPS_BOOTSTRAP.md.
EOF
  chmod 600 "${REPO_ROOT}/secrets/README.txt" 2>/dev/null || true
fi

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

info "Selesai."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CHECKLIST — isi manual (otomatis sisanya sudah dari *.example + path)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  WAJIB (dashboard + job pipeline jalan):"
echo "    • ${REPO_ROOT}/.env              → GROQ_API_KEY=..."
echo "    • ${REPO_ROOT}/web/.env.local    → NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY"
echo "  Supabase Dashboard → Authentication → Site URL = sama dengan NEXT_PUBLIC_SITE_URL (produksi)."
echo ""
echo "  OPSIONAL (kosongkan atau # komentar baris = nonaktif):"
echo "    • Provider LLM lain (.env + web/.env.local): GEMINI_, OPENAI_, OPENROUTER_, ANTHROPIC_…"
echo "    • YouTube dari VPS: secrets/youtube-cookies.txt atau YTDLP_COOKIES — lihat .env.example"
echo "    • Turnstile, Sentry, CRON_SECRET, Resend — lihat komentar di web/.env.local.example"
echo ""
echo "  Ulangi skrip ini setelah git pull jika ada variabel baru di *.example (merge aman)."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
