"""Emit progress events back to the web dashboard.

The worker script sets `JOB_EVENTS_URL` + `JOB_EVENTS_TOKEN` + `CLIPPER_JOB_ID` +
`CLIPPER_USER_ID` in the child env. This module POSTs to the Supabase REST
endpoint `/rest/v1/job_events` with the service-role token so the row bypasses
RLS. Failures here are intentionally swallowed — progress is best-effort.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from clipper.config import Settings

log = logging.getLogger(__name__)


def emit(
    settings: Settings,
    *,
    phase: str,
    message: str = "",
    progress: float | None = None,
) -> None:
    """Fire-and-forget. Never raises."""
    if not settings.job_events_url or not settings.job_id or not settings.user_id:
        log.info("progress: phase=%s message=%s", phase, message)
        return
    try:
        body = {
            "job_id": settings.job_id,
            "user_id": settings.user_id,
            "phase": phase,
            "message": (message or "")[:500],
        }
        if progress is not None:
            body["progress"] = round(max(0.0, min(100.0, float(progress))), 2)
        req = urllib.request.Request(
            settings.job_events_url,
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "apikey": settings.job_events_token,
                "Authorization": f"Bearer {settings.job_events_token}",
                "Prefer": "return=minimal",
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except urllib.error.URLError as e:
        log.warning("job_events post failed: %s", e)
    except Exception as e:  # noqa: BLE001
        log.warning("job_events unexpected error: %s", e)
