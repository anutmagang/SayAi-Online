from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from clipper.observability import init_sentry
from clipper.pipeline import run_pipeline


def main(argv: list[str] | None = None) -> int:
    init_sentry()
    default_output = Path(
        os.environ.get("CLIPPER_OUTPUT", "output").strip() or "output"
    )

    parser = argparse.ArgumentParser(
        description="Clipper: download or local file → Whisper → Claude → FFmpeg clips",
    )
    parser.add_argument(
        "url",
        nargs="?",
        default=None,
        help="Video page URL (YouTube, etc.) — mutually exclusive with --input",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Local video/audio file path (mutually exclusive with URL)",
    )
    parser.add_argument(
        "--job-id",
        type=str,
        default=None,
        help="Optional UUID folder name under output (for dashboard jobs)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=default_output,
        help="Root output directory (default: $CLIPPER_OUTPUT or ./output)",
    )
    args = parser.parse_args(argv)

    if bool(args.url) == bool(args.input):
        print(
            "error: provide either a URL positional argument or --input path (not both)",
            file=sys.stderr,
        )
        return 2

    try:
        job = run_pipeline(
            url=args.url,
            input_file=args.input,
            output_root=args.output,
            job_id=args.job_id,
        )
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    print(str(job.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
