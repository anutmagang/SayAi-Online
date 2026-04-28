#!/usr/bin/env python3
"""
Repeatable verification: syntax + imports + optional PATH binaries.

Covers Phase 1 core deps and Phase 3 optional deps (MediaPipe / OpenCV).

Usage (from repo root, with venv activated):
  python scripts/verify_phase1.py
"""

from __future__ import annotations

import compileall
import shutil
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    clipper_dir = root / "clipper"

    if not clipper_dir.is_dir():
        print("error: clipper/ package missing", file=sys.stderr)
        return 2

    if not compileall.compile_dir(str(clipper_dir), quiet=1):
        print("error: syntax check failed", file=sys.stderr)
        return 2

    sys.path.insert(0, str(root))
    try:
        import anthropic  # noqa: F401
        import faster_whisper  # noqa: F401
        import yt_dlp  # noqa: F401
    except ImportError as e:
        print(f"error: Python dependency missing ({e}). Run: pip install -r requirements.txt")
        return 1

    try:
        import cv2  # noqa: F401
        import mediapipe  # noqa: F401
    except ImportError as e:
        print(
            f"warning: Phase 3 deps missing ({e}); install requirements.txt for 9:16 + captions",
            file=sys.stderr,
        )

    try:
        from clipper.pipeline import run_pipeline  # noqa: F401
    except ImportError as e:
        print(f"error: clipper import failed ({e})", file=sys.stderr)
        return 1

    bins_ok = True
    for name in ("ffmpeg", "ffprobe", "yt-dlp"):
        if not shutil.which(name):
            print(f"warning: {name} not on PATH (needed for full pipeline run)")
            bins_ok = False

    print("verify: OK (syntax + core Python deps)")
    if not bins_ok:
        print("note: install system binaries or use Docker for end-to-end runs")
        return 0
    print("verify: ffmpeg/ffprobe/yt-dlp detected on PATH")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
