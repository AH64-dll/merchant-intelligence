#!/usr/bin/env python3
"""Audit recent brief-generation sessions against the merchant_briefs table.

Joins analyst and verifier session transcripts to the merchants and
merchant_briefs tables by full UUID, prints per-merchant status, reason,
model, and duration for the last N sessions, and flags any outcome whose
status is neither drafted/fresh nor a recognized reason-bearing skip.
"""

import argparse
import glob
import json
import os
import re
import sqlite3
import sys
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "pipeline"))

from merchant_intel.omp.events import parse_jsonl  # noqa: E402

RECOGNIZED_SKIP_PREFIXES = (
    "merchant not found",
    "dry run: validated brief not written",
    "package json",  # covers "... exceeds argv-safe limit ..."
)

QUOTA_MARKERS = (
    "provider rate limit",
    "usage limit",
    "usage_limit",
    "resource_exhausted",
    "rate limit",
    "429",
)


def parse_session(path):
    """Return (merchant_id, final_assistant_summary) for one session file."""
    mid = None
    final = {"stop": None, "err": None, "text": ""}
    for line in open(path, errors="replace"):
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get("type") != "message":
            continue
        m = e["message"]
        role = m.get("role")
        c = m.get("content")
        if role == "user" and mid is None:
            txt = c if isinstance(c, str) else " ".join(
                x.get("text", "") for x in (c or []) if isinstance(x, dict)
            )
            mm = re.search(r"merchant_id=([0-9a-f-]{36})", txt)
            if mm:
                mid = mm.group(1)
        elif role == "assistant":
            if isinstance(c, list):
                text = " ".join(
                    x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text"
                )
            else:
                text = str(c or "")
            final = {
                "stop": m.get("stopReason"),
                "err": m.get("errorMessage"),
                "text": text.strip(),
            }
    return mid, final


def classify(final):
    """Map one assistant message to a status + flag."""
    err = final["err"] or ""
    text = final["text"]
    if err:
        blob = err.lower()
        if any(m in blob for m in QUOTA_MARKERS):
            return "QUOTA", False
        return "error", True
    if text.strip():
        return "drafted", False
    return "empty", True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--last", type=int, default=20, help="sessions per role to inspect")
    args = ap.parse_args()

    db = sqlite3.connect(
        f"file:{os.path.join(REPO, 'data', 'merchant_intelligence.db')}?mode=ro", uri=True
    )
    written = {r[0] for r in db.execute("SELECT merchant_id FROM merchant_briefs")}

    for kind in ("analyst", "verifier"):
        files = sorted(
            glob.glob(os.path.join(REPO, "data", "sessions", kind, "*.jsonl")),
            key=os.path.getmtime,
        )[-args.last:]
        print(f"== {kind} (last {len(files)}) ==")
        for f in files:
            mid, final = parse_session(f)
            ts = datetime.fromtimestamp(os.path.getmtime(f)).strftime("%H:%M:%S")
            status, flagged = classify(final)
            label = mid[:8] if mid else "??"
            detail = final["err"] or final["text"][:60].replace("\n", " ")
            mark = "  <-- FLAG" if flagged else ""
            print(f"{ts} | {label} | {status:8} | {detail}{mark}")
    db.close()


if __name__ == "__main__":
    main()
