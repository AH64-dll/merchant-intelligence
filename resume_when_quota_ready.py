#!/usr/bin/env python3
"""Resume the merchant pipeline once both required providers have capacity."""

from __future__ import annotations
import os

import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/home/amr/Documents/project")
MAIN = Path("/tmp/chat-on-steroids-linux-version-/merchant_intelligence/main.py")
CONFIG = ROOT / "config.yaml"
LOG = ROOT / "logs" / "quota-supervisor.log"
POLL_SECONDS = 900
MAX_POLLS = 200            # hard ceiling on the wait (never poll forever)
MAX_UNPARSEABLE_POLLS = 3  # consecutive unreadable `omp usage` outputs -> abort


def log(message: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat()
    line = f"{stamp} {message}"
    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    print(line, flush=True)

def provider_capacity_available() -> tuple[bool, bool, str]:
    """Return (parsed, ready, reason).

    ``parsed`` is False when the `omp usage` output could not be interpreted
    (command failure, timeout, or a missing/unrecognised section). Callers MUST
    treat that as NOT ready: the old regex-only check failed OPEN, so any
    cosmetic or localized change to the output made both patterns miss and the
    pipeline was launched against an exhausted provider.
    """
    try:
        result = subprocess.run(
            ["omp", "usage"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        return False, False, "omp usage timed out after 60s"
    output = result.stdout + "\n" + result.stderr
    if result.returncode != 0:
        return False, False, f"omp usage failed (rc={result.returncode})"
    if not (re.search(r"Usage \(Google\)", output) and re.search(r"Openai Codex", output)):
        return False, False, (
            "omp usage output not understood (expected Google + Codex sections)"
        )
    google_exhausted = bool(
        re.search(r"Usage \(Google\).*?100\.0% used", output, re.S)
    )
    codex_exhausted = bool(
        re.search(r"Openai Codex.*?7 days.*?100\.0% used", output, re.S)
    )
    if google_exhausted or codex_exhausted:
        return True, False, f"google_exhausted={google_exhausted} codex_exhausted={codex_exhausted}"
    return True, True, "both required provider pools report capacity"


def main() -> int:
    log("started")
    polls = 0
    unparseable = 0
    while polls < MAX_POLLS:
        polls += 1
        parsed, ready, reason = provider_capacity_available()
        log(f"poll {polls}/{MAX_POLLS} parsed={parsed} capacity_ready={ready} {reason}")
        if not parsed:
            unparseable += 1
            if unparseable >= MAX_UNPARSEABLE_POLLS:
                log(
                    f"aborting: {unparseable} consecutive unreadable `omp usage` polls; "
                    "refusing to launch against a possibly exhausted provider"
                )
                return 3
            time.sleep(POLL_SECONDS)
            continue
        unparseable = 0
        if not ready:
            time.sleep(POLL_SECONDS)
            continue
        log("starting resumable merchant pipeline")
        pipeline_env = os.environ.copy()
        pipeline_env.update(
            {"PYTHONUNBUFFERED": "1", "PYTHONPATH": str(MAIN.parent)}
        )
        result = subprocess.run(
            [
                "python3",
                str(MAIN),
                "--config",
                str(CONFIG),
                "run",
                "--resume",
            ],
            cwd=ROOT,
            env=pipeline_env,
            check=False,
        )
        log(f"pipeline_exit={result.returncode}")
        return result.returncode
    log(f"aborting: reached MAX_POLLS={MAX_POLLS} without confirmed provider capacity")
    return 4


if __name__ == "__main__":
    raise SystemExit(main())
