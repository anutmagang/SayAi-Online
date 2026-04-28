#!/usr/bin/env bash
# Install ffmpeg + ffprobe on a fresh Linux VPS (run once at provision time).
#
# Ubuntu / Debian:
#   sudo bash scripts/install-system-deps.sh
#
# From cloud-init / Terraform / SSH bootstrap:
#   curl -fsSL https://raw.githubusercontent.com/.../install-system-deps.sh | sudo bash
#   (host the script in your repo or gist when you go private)
#
# Notes:
# - On Debian/Ubuntu/RHEL-family, the "ffmpeg" package includes ffprobe.
# - For reproducible deploys, prefer the Dockerfile in the repo root instead.

set -euo pipefail

need_sudo() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Re-run with sudo, e.g.: sudo bash $0" >&2
    exit 1
  fi
}

need_sudo

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends ffmpeg ca-certificates
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y ffmpeg ca-certificates
elif command -v yum >/dev/null 2>&1; then
  yum install -y ffmpeg ca-certificates
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache ffmpeg ca-certificates
else
  echo "No supported package manager (apt-get, dnf, yum, apk). Install ffmpeg manually." >&2
  exit 1
fi

command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
echo "OK: $(command -v ffmpeg)  |  $(command -v ffprobe)"
