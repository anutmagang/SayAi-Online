"""Optional Sentry integration for the Python pipeline.

Activated automatically when `SENTRY_DSN` is set in the environment. No-op
otherwise — we deliberately keep the import inside `_init()` so the sentry-sdk
dependency is optional at install time.
"""

from __future__ import annotations

import logging
import os

_initialised = False
log = logging.getLogger(__name__)


def init_sentry() -> None:
    """Call once at process startup (e.g. from `python -m clipper`)."""
    global _initialised
    if _initialised:
        return
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return
    try:
        import sentry_sdk  # type: ignore

        sentry_sdk.init(
            dsn=dsn,
            release=os.environ.get("FAI_CLIPPER_VERSION", "fai-clipper@dev"),
            environment=os.environ.get("SENTRY_ENV", "production"),
            traces_sample_rate=float(os.environ.get("SENTRY_TRACES_RATE", "0.0")),
            send_default_pii=False,
        )
        _initialised = True
        log.info("sentry initialised")
    except Exception as e:  # noqa: BLE001
        log.warning("sentry init failed: %s", e)
