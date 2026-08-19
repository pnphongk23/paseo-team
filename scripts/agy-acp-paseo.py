#!/usr/bin/env python3
"""Paseo launcher for agy-acp with a warm model cache.

Paseo spawns the ACP binary, reads session/new, then exits. agy-acp discovers
models asynchronously via `agy models` (~30s), so Paseo would see zero models
unless ~/.agy-acp/models.json is already populated.

This wrapper refreshes that cache when it is missing, empty, or older than
AGY_MODELS_TTL_SECONDS (default 4h), then execs agy-acp.
"""

from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
import time
from pathlib import Path


DEFAULT_TTL_SECONDS = 4 * 60 * 60
CACHE_DIR = Path.home() / ".agy-acp"
CACHE_FILE = CACHE_DIR / "models.json"
LOCK_FILE = CACHE_DIR / "models.lock"
DEFAULT_AGY = Path.home() / ".local/bin/agy"
DEFAULT_ACP = Path.home() / ".local/bin/agy-acp"


def parse_agy_models_stdout(stdout: str) -> list[dict[str, str]]:
    models: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in stdout.splitlines():
        line = raw.strip()
        if not line:
            continue
        lowered = line.lower()
        if lowered.startswith("fetching") or lowered.startswith("available"):
            continue
        if "\t" in line:
            slug, label = line.split("\t", 1)
        else:
            parts = line.split()
            slug, label = parts[0], " ".join(parts[1:])
        slug = slug.strip()
        label = label.strip() or slug
        if not slug or slug in seen or not slug[0].isalnum():
            continue
        if slug.lower() in {"fetching", "available", "model", "models"}:
            continue
        seen.add(slug)
        models.append({"value": slug, "name": label})
    return models


def cache_is_usable(path: Path, ttl_seconds: float, now: float | None = None) -> bool:
    if not path.is_file():
        return False
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    if not isinstance(payload, list) or len(payload) == 0:
        return False
    first = payload[0]
    if isinstance(first, str):
        ok = bool(first.strip())
    elif isinstance(first, dict) and first.get("value"):
        ok = True
    else:
        return False
    if not ok:
        return False
    age = (now if now is not None else time.time()) - path.stat().st_mtime
    return age < ttl_seconds


def refresh_models_cache(
    *,
    agy_bin: Path,
    cache_file: Path,
    timeout: float = 90,
) -> list[dict[str, str]]:
    result = subprocess.run(
        [str(agy_bin), "models"],
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"`agy models` failed ({result.returncode}): {result.stderr.strip()[:500]}"
        )
    models = parse_agy_models_stdout(result.stdout)
    if not models:
        raise RuntimeError("`agy models` returned no parseable model rows")
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache_file.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(models, indent=2) + "\n")
    tmp.replace(cache_file)
    return models


def ttl_from_env() -> float:
    raw = os.environ.get("AGY_MODELS_TTL_SECONDS", str(DEFAULT_TTL_SECONDS))
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError("AGY_MODELS_TTL_SECONDS must be a number") from exc
    if value <= 0:
        raise RuntimeError("AGY_MODELS_TTL_SECONDS must be greater than zero")
    return value


def ensure_warm_cache(agy_bin: Path, cache_file: Path, lock_file: Path, ttl: float) -> None:
    if cache_is_usable(cache_file, ttl):
        return
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_file, "a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        if cache_is_usable(cache_file, ttl):
            return
        refresh_models_cache(agy_bin=agy_bin, cache_file=cache_file)


def main(argv: list[str]) -> int:
    agy_bin = Path(os.environ.get("AGY_BIN", str(DEFAULT_AGY)))
    acp_bin = Path(os.environ.get("AGY_ACP_BIN", str(DEFAULT_ACP)))
    if not acp_bin.is_file():
        print(f"agy-acp binary not found: {acp_bin}", file=sys.stderr)
        return 1
    if not agy_bin.is_file():
        print(f"agy binary not found: {agy_bin}", file=sys.stderr)
        return 1
    try:
        ensure_warm_cache(agy_bin, CACHE_FILE, LOCK_FILE, ttl_from_env())
    except Exception as exc:
        if not cache_is_usable(CACHE_FILE, ttl_seconds=float("inf")):
            print(f"failed to refresh AGY model cache: {exc}", file=sys.stderr)
            return 1
        print(f"using stale AGY model cache after refresh error: {exc}", file=sys.stderr)
    os.execv(str(acp_bin), [str(acp_bin), *argv[1:]])
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
