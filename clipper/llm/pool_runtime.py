"""Update operator_llm_api_key_pool + llm_key_limit_events via Supabase REST (service role)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger(__name__)


def skip_pool_runtime_side_effects() -> bool:
    """Dev / uji: jangan PATCH pool saat 429 (set CLIPPER_SKIP_KEY_COOLDOWN=1)."""
    v = os.environ.get("CLIPPER_SKIP_KEY_COOLDOWN", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _cooldown_seconds() -> int:
    raw = os.environ.get("API_KEY_COOLDOWN_SEC", "").strip()
    try:
        n = int(raw) if raw else 120
    except ValueError:
        n = 120
    return max(30, min(n, 3600))


def _utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _service_headers() -> dict[str, str] | None:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        return None
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=minimal",
    }


def _rest_patch(table: str, row_id: str, body: dict[str, Any]) -> bool:
    h = _service_headers()
    if not h:
        return False
    base = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip().rstrip("/")
    url = f"{base}/rest/v1/{table}?id=eq.{row_id}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers=h,
        method="PATCH",
    )
    try:
        urllib.request.urlopen(req, timeout=20)
        return True
    except urllib.error.HTTPError as e:
        log.warning("pool_runtime PATCH HTTP %s: %s", e.code, e.reason)
    except Exception as e:  # noqa: BLE001
        log.warning("pool_runtime PATCH failed: %s", e)
    return False


def _rest_insert(table: str, row: dict[str, Any]) -> bool:
    h = _service_headers()
    if not h:
        return False
    base = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip().rstrip("/")
    url = f"{base}/rest/v1/{table}"
    req = urllib.request.Request(
        url,
        data=json.dumps(row).encode("utf-8"),
        headers=h,
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=20)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("pool_runtime INSERT failed: %s", e)
    return False


def report_key_rate_limited(pool_id: str, provider: str, detail: str) -> None:
    if skip_pool_runtime_side_effects():
        return
    from clipper.llm.api_key_pool import invalidate_pool_cache
    now = datetime.now(timezone.utc)
    sec = _cooldown_seconds()
    until = now + timedelta(seconds=sec)
    msg = (detail or "")[:480]
    _rest_patch(
        "operator_llm_api_key_pool",
        pool_id,
        {
            "health_status": "cooldown",
            "cooldown_until": _utc_iso(until),
            "next_probe_at": _utc_iso(until),
            "last_error": msg or "rate_limited",
        },
    )
    _rest_insert(
        "llm_key_limit_events",
        {
            "pool_id": pool_id,
            "provider": provider,
            "event_kind": "rate_limit",
            "message": msg,
        },
    )
    invalidate_pool_cache(provider)


def report_key_probe_failed(pool_id: str, provider: str, detail: str, backoff_sec: int) -> None:
    if skip_pool_runtime_side_effects():
        return
    from clipper.llm.api_key_pool import invalidate_pool_cache
    now = datetime.now(timezone.utc)
    until = now + timedelta(seconds=max(60, min(backoff_sec, 7200)))
    msg = (detail or "")[:480]
    _rest_patch(
        "operator_llm_api_key_pool",
        pool_id,
        {
            "health_status": "error",
            "cooldown_until": _utc_iso(until),
            "next_probe_at": _utc_iso(until),
            "last_error": msg or "probe_failed",
        },
    )
    _rest_insert(
        "llm_key_limit_events",
        {
            "pool_id": pool_id,
            "provider": provider,
            "event_kind": "probe_fail",
            "message": msg,
        },
    )
    invalidate_pool_cache(provider)


def report_key_success(pool_id: str, provider: str) -> None:
    if skip_pool_runtime_side_effects():
        return
    from clipper.llm.api_key_pool import invalidate_pool_cache

    now = _utc_iso(datetime.now(timezone.utc))
    _rest_patch(
        "operator_llm_api_key_pool",
        pool_id,
        {
            "health_status": "healthy",
            "cooldown_until": None,
            "next_probe_at": None,
            "last_error": None,
            "probe_fail_streak": 0,
            "last_success_at": now,
        },
    )
    invalidate_pool_cache(provider)
