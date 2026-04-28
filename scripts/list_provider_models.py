"""One-off: list Groq + Gemini models from keys in .env (never print keys)."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    load_env_file(root / ".env")
    load_env_file(root / "web" / ".env.local")

    out: dict = {"groq": [], "gemini": []}

    gk = os.environ.get("GROQ_API_KEY", "").strip()
    if gk:
        try:
            req = urllib.request.Request(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {gk}"},
            )
            raw = urllib.request.urlopen(req, timeout=45).read().decode()
            data = json.loads(raw)
        except Exception as e:  # noqa: BLE001
            out["groq"] = {"error": str(e)}
        else:
            for m in sorted(data.get("data", []), key=lambda x: x.get("id", "")):
                mid = m.get("id") or ""
                if not mid:
                    continue
                out["groq"].append(
                    {
                        "id": mid,
                        "owned_by": m.get("owned_by"),
                        "context_window": m.get("context_window"),
                    }
                )
    else:
        out["groq"] = "NO_GROQ_API_KEY"

    gm = os.environ.get("GEMINI_API_KEY", "").strip()
    if gm:
        try:
            q = urllib.parse.quote(gm, safe="")
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={q}"
            raw = urllib.request.urlopen(url, timeout=45).read().decode()
            data = json.loads(raw)
        except Exception as e:  # noqa: BLE001
            out["gemini"] = {"error": str(e)}
        else:
            for m in data.get("models", []) or []:
                name = m.get("name", "")
                if "embed" in name.lower():
                    continue
                methods = m.get("supportedGenerationMethods") or []
                if "generateContent" not in methods:
                    continue
                short = name.split("/")[-1] if "/" in name else name
                out["gemini"].append(
                    {
                        "id": short,
                        "displayName": m.get("displayName"),
                        "description": (m.get("description") or "")[:200],
                    }
                )
            out["gemini"].sort(key=lambda x: x["id"])
    else:
        out["gemini"] = "NO_GEMINI_API_KEY"

    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
