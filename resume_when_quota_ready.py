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
def log(message: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat()
    line = f"{stamp} {message}"
    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    print(line, flush=True)

def provider_capacity_available() -> tuple[bool, str]:
    result = subprocess.run(
        ["omp", "usage"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    output = result.stdout + "\n" + result.stderr
    if result.returncode != 0:
        return False, "omp usage failed"
    google_exhausted = bool(
        re.search(r"Usage \(Google\).*?100\.0% used", output, re.S)
    )
    codex_exhausted = bool(
        re.search(r"Openai Codex.*?7 days.*?100\.0% used", output, re.S)
    )
    if google_exhausted or codex_exhausted:
        return False, f"google_exhausted={google_exhausted} codex_exhausted={codex_exhausted}"
    return True, "both required provider pools report capacity"


def main() -> int:
    log("started")
    while True:
        ready, reason = provider_capacity_available()
        log(f"capacity_ready={ready} {reason}")
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


if __name__ == "__main__":
    raise SystemExit(main())
