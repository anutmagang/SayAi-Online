from __future__ import annotations

import json
import subprocess
from pathlib import Path


def ffprobe_video_size(video_path: Path) -> tuple[int, int]:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json",
        str(video_path),
    ]
    out = subprocess.check_output(cmd, text=True, timeout=60)
    data = json.loads(out)
    streams = data.get("streams") or []
    if not streams:
        raise RuntimeError(f"No video stream in {video_path}")
    w = int(streams[0]["width"])
    h = int(streams[0]["height"])
    return w, h


def ffprobe_duration_seconds(video_path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        str(video_path),
    ]
    out = subprocess.check_output(cmd, text=True, timeout=60)
    data = json.loads(out)
    return float(data["format"]["duration"])
