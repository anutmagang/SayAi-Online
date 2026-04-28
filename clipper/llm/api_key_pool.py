"""Fetch encrypted operator API keys from Supabase + decrypt (matches web AES-256-GCM)."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, list[tuple[str | None, str]]]] = {}
_CACHE_TTL_SEC = 60.0


def _master_secret() -> str:
    return os.environ.get("API_KEY_POOL_MASTER_SECRET", "").strip()


_POOL_MASTER_MIN_LEN = 12  # keep in sync with web/lib/api-key-pool-crypto.ts


def _pool_http_configured() -> bool:
    m = _master_secret()
    return bool(
        os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
        and os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        and m
        and len(m) >= _POOL_MASTER_MIN_LEN
    )


def skip_pool_cooldown_filter() -> bool:
    """Dev: anggap semua key pool dapat dipakai (abaikan cooldown_until)."""
    v = os.environ.get("CLIPPER_SKIP_KEY_COOLDOWN", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _decrypt_payload(master: str, payload: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    parts = payload.split(".")
    if len(parts) != 2:
        raise ValueError("invalid ciphertext format")
    iv = base64.b64decode(parts[0])
    blob = base64.b64decode(parts[1])
    if len(blob) < 17:
        raise ValueError("ciphertext too short")
    key = hashlib.sha256(master.encode("utf-8")).digest()
    aes = AESGCM(key)
    plain = aes.decrypt(iv, blob, None)
    return plain.decode("utf-8")


def _parse_ts(val: Any) -> datetime | None:
    if val is None or not isinstance(val, str):
        return None
    s = val.strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _in_cooldown(row: dict[str, Any]) -> bool:
    cu = _parse_ts(row.get("cooldown_until"))
    if cu is None:
        return False
    return cu > datetime.now(timezone.utc)


def _rotation_offset(n: int) -> int:
    if n <= 0:
        return 0
    jid = os.environ.get("CLIPPER_JOB_ID", "").strip()
    if not jid:
        return 0
    h = hashlib.sha256(jid.encode("utf-8")).digest()
    return int.from_bytes(h[:4], "big") % n


def _fetch_pool_rows_once(
    url_base: str,
    key: str,
    provider: str,
    job_tier: str | None,
    select_cols: str,
) -> list[dict[str, Any]] | None:
    q = f"{select_cols}&provider=eq.{urllib.parse.quote(provider, safe='')}&enabled=eq.true"
    if job_tier is not None:
        t = urllib.parse.quote(job_tier, safe="")
        q += f"&or=(applies_to_tier.is.null,applies_to_tier.eq.{t})"
    url = f"{url_base}/rest/v1/operator_llm_api_key_pool?{q}"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        raw = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code == 400:
            return None
        log.warning("api key pool fetch HTTP %s: %s", e.code, e.reason)
        return []
    except Exception as e:  # noqa: BLE001
        log.warning("api key pool fetch failed: %s", e)
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return data


def _sort_pool_rows(data: list[dict[str, Any]], job_tier: str | None) -> list[dict[str, Any]]:
    if job_tier is None:
        return sorted(
            data,
            key=lambda r: (r.get("sort_order") or 0, str(r.get("id") or "")),
        )

    def _rank(row: dict[str, Any]) -> tuple[int, int, str]:
        at = row.get("applies_to_tier")
        if at is None or at == "":
            return (1, int(row.get("sort_order") or 0), str(row.get("id") or ""))
        if str(at) == job_tier:
            return (0, int(row.get("sort_order") or 0), str(row.get("id") or ""))
        return (2, int(row.get("sort_order") or 0), str(row.get("id") or ""))

    return sorted(data, key=_rank)


def _fetch_pool_rows(provider: str, job_tier: str | None) -> list[dict[str, Any]]:
    """job_tier None = semua baris (tanpa filter tier). String = filter (tier + NULL)."""
    url_base = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url_base or not key:
        return []

    sel_full = (
        "select=secret_ciphertext,sort_order,id,applies_to_tier,"
        "cooldown_until,health_status,next_probe_at"
    )
    sel_legacy = "select=secret_ciphertext,sort_order,id,applies_to_tier"

    raw_rows = _fetch_pool_rows_once(url_base, key, provider, job_tier, sel_full)
    if raw_rows is None:
        log.info(
            "api key pool: retrying without health columns "
            "(jalankan migrasi 021 jika ingin cooldown per key di DB)"
        )
        legacy = _fetch_pool_rows_once(url_base, key, provider, job_tier, sel_legacy)
        if legacy is None:
            return []
        data = legacy
    else:
        data = raw_rows

    return _sort_pool_rows(data, job_tier)


def list_pool_key_entries(provider: str, job_tier: str | None = "__job__") -> list[tuple[str | None, str]]:
    """Return [(pool_row_id|None, plaintext_key), ...] — rotasi stabil per CLIPPER_JOB_ID."""
    if not _pool_http_configured():
        return []
    if job_tier == "__job__":
        tier = os.environ.get("USER_TIER", "free").strip().lower()
        if tier not in ("free", "starter", "creator", "pro"):
            tier = "free"
        fetch_tier: str | None = tier
        cache_key = f"{provider}:job:{tier}"
    elif job_tier is None:
        fetch_tier = None
        cache_key = f"{provider}:all"
    else:
        fetch_tier = job_tier
        cache_key = f"{provider}:job:{fetch_tier}"

    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if cached and (now - cached[0]) < _CACHE_TTL_SEC:
        return list(cached[1])

    master = _master_secret()
    rows = _fetch_pool_rows(provider, fetch_tier)
    pool_entries: list[tuple[str | None, str]] = []
    for row in rows:
        blob = (row.get("secret_ciphertext") or "").strip()
        if not blob:
            continue
        if not skip_pool_cooldown_filter() and _in_cooldown(row):
            continue
        try:
            plain = _decrypt_payload(master, blob).strip()
        except Exception as e:  # noqa: BLE001
            log.warning("api key pool decrypt skip id=%s: %s", row.get("id"), e)
            continue
        if not plain:
            continue
        rid = row.get("id")
        pool_id = str(rid) if rid else None
        if not any(k == plain for _, k in pool_entries):
            pool_entries.append((pool_id, plain))

    off = _rotation_offset(len(pool_entries))
    rotated = pool_entries[off:] + pool_entries[:off] if pool_entries else []

    _CACHE[cache_key] = (now, rotated)
    return list(rotated)


def list_pool_keys(provider: str, job_tier: str | None = "__job__") -> list[str]:
    """Decrypt pool keys (urutan setelah filter cooldown + rotasi job)."""
    return [k for _, k in list_pool_key_entries(provider, job_tier)]


def invalidate_pool_cache(provider: str | None = None) -> None:
    if provider is None:
        _CACHE.clear()
        return
    for k in list(_CACHE):
        if k.startswith(f"{provider}:"):
            _CACHE.pop(k, None)


def resolve_key_entries(provider: str, env_var: str) -> list[tuple[str | None, str]]:
    """Pool entries dulu, lalu env (tanpa pool id)."""
    out: list[tuple[str | None, str]] = list(list_pool_key_entries(provider, "__job__"))
    env_val = os.environ.get(env_var, "").strip()
    if env_val and not any(k == env_val for _, k in out):
        out.append((None, env_val))
    return out


def resolve_key_chain(provider: str, env_var: str) -> list[str]:
    """Pool keys (prioritas tier job), lalu env."""
    return [k for _, k in resolve_key_entries(provider, env_var)]


def is_rate_limit_error(exc: BaseException) -> bool:
    """Heuristic across Groq / OpenAI / Anthropic / Google SDK exceptions."""
    if exc.__class__.__name__ in ("RateLimitError", "ResourceExhausted"):
        return True
    code = getattr(exc, "status_code", None)
    if code == 429:
        return True
    resp = getattr(exc, "response", None)
    if resp is not None:
        sc = getattr(resp, "status_code", None)
        if sc == 429:
            return True
    msg = str(exc).lower()
    if "429" in msg or "rate limit" in msg or "too many requests" in msg:
        return True
    if "resource exhausted" in msg or ("quota" in msg and "exceeded" in msg):
        return True
    return False
