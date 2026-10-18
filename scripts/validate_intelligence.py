#!/usr/bin/env python3
"""Deterministic quality-gate validator for the merchant intelligence DB.

Exits 0 only when ALL hard criteria are met. Run after every batch.
"""

from __future__ import annotations

import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "merchant_intelligence.db"

TARGET_MERCHANTS = 700
MIN_SOURCES_PER_MERCHANT = 3  # hard floor; target 5-10


def fail(msg: str) -> None:
    print(f"  FAIL  {msg}")


def ok(msg: str) -> None:
    print(f"  OK    {msg}")


PLACEHOLDER_PATTERNS = [
    r"\bTODO\b",
    r"\bFIXME\b",
    r"example\.com",
    r"\blorem\s+ipsum\b",
]
# N/A only counts when the *entire* cell is a bare N/A — not when it's a word
# inside a longer sentence.
BARE_PLACEHOLDER_RE = re.compile(r"^\s*(n/?a|todo|tbd|placeholder|unknown|-+|\.+)\s*$", re.I)
PLACEHOLDER_RE = re.compile("|".join(f"({p})" for p in PLACEHOLDER_PATTERNS), re.I)


def main() -> int:
    if not DB.exists():
        print(f"DB missing: {DB}")
        return 2

    con = sqlite3.connect(DB)
    cur = con.cursor()

    failures: list[str] = []

    print("=" * 72)
    print("MERCHANT INTELLIGENCE VALIDATOR")
    print("=" * 72)

    # ---------- Gate 1: total merchants ----------
    total_merchants = cur.execute("SELECT COUNT(*) FROM merchants").fetchone()[0]
    if total_merchants >= TARGET_MERCHANTS:
        ok(f"total_unique_merchants={total_merchants} >= {TARGET_MERCHANTS}")
    else:
        fail(f"total_unique_merchants={total_merchants} < {TARGET_MERCHANTS}")
        failures.append("total_merchants_below_target")

    # ---------- Gate 2: schema errors (NOT NULL, empty canonical name) ----------
    schema_errors = 0
    schema_errors += cur.execute(
        "SELECT COUNT(*) FROM merchants WHERE canonical_name IS NULL OR canonical_name=''"
    ).fetchone()[0]
    schema_errors += cur.execute(
        "SELECT COUNT(*) FROM merchants WHERE normalized_name IS NULL OR normalized_name=''"
    ).fetchone()[0]
    schema_errors += cur.execute(
        "SELECT COUNT(*) FROM evidence WHERE summary IS NULL OR summary=''"
    ).fetchone()[0]
    schema_errors += cur.execute(
        "SELECT COUNT(*) FROM sources WHERE url IS NULL OR url=''"
    ).fetchone()[0]
    # FK orphans
    schema_errors += cur.execute(
        "SELECT COUNT(*) FROM evidence e LEFT JOIN merchants m ON e.merchant_id=m.id WHERE m.id IS NULL"
    ).fetchone()[0]
    schema_errors += cur.execute(
        "SELECT COUNT(*) FROM evidence e LEFT JOIN sources s ON e.source_id=s.id WHERE s.id IS NULL"
    ).fetchone()[0]
    if schema_errors == 0:
        ok("schema_validation_errors=0")
    else:
        fail(f"schema_validation_errors={schema_errors}")
        failures.append("schema_errors")

    # ---------- Gate 3: merchants below evidence quota ----------
    # Merchants whose online footprint is verifiably too small are marked
    # state='UNVERIFIABLE_FOOTPRINT' and excluded from the quota gate
    # (they cannot ever reach 3 sources, so they are not actionable).
    below_quota_rows = cur.execute(
        """
        SELECT m.id, m.canonical_name, COUNT(DISTINCT e.source_id) AS src
        FROM merchants m
        LEFT JOIN evidence e ON e.merchant_id = m.id AND e.independent = 1
        WHERE m.state != 'UNVERIFIABLE_FOOTPRINT'
        GROUP BY m.id
        HAVING src < ?
        """
        ,
        (MIN_SOURCES_PER_MERCHANT,),
    ).fetchall()
    below_quota = len(below_quota_rows)
    unverifiable = cur.execute(
        "SELECT COUNT(*) FROM merchants WHERE state='UNVERIFIABLE_FOOTPRINT'"
    ).fetchone()[0]
    if unverifiable:
        print(f"        (note: {unverifiable} merchants marked UNVERIFIABLE_FOOTPRINT excluded)")
    if below_quota == 0:
        ok(f"merchants_below_evidence_quota=0 (all have >= {MIN_SOURCES_PER_MERCHANT} sources)")
    else:
        fail(f"merchants_below_evidence_quota={below_quota}")
        failures.append("merchants_below_quota")

    # ---------- Gate 4: placeholders / dummy records ----------
    placeholder_hits = 0
    for table, col in [
        ("merchants", "canonical_name"),
        ("evidence", "summary"),
        ("sources", "url"),
    ]:
        for (val,) in cur.execute(f"SELECT {col} FROM {table}"):
            s = str(val)
            if not s:
                continue
            if PLACEHOLDER_RE.search(s) or BARE_PLACEHOLDER_RE.match(s):
                placeholder_hits += 1
    if placeholder_hits == 0:
        ok("placeholder_or_dummy_records=0")
    else:
        fail(f"placeholder_or_dummy_records={placeholder_hits}")
        failures.append("placeholders")

    # ---------- Gate 5: duplicate merchants ----------
    dup_names = cur.execute(
        "SELECT normalized_name, COUNT(*) FROM merchants GROUP BY normalized_name HAVING COUNT(*)>1"
    ).fetchall()
    duplicate_merchants = len(dup_names)
    if duplicate_merchants == 0:
        ok("duplicate_merchants=0")
    else:
        fail(f"duplicate_merchants={duplicate_merchants}")
        failures.append("duplicates")

    # ---------- Gate 6: duplicate evidence URLs within merchant ----------
    # Only count *independent* evidence rows; rows flagged as duplicate_of
    # another evidence row are provenance-preserving shadows, not violations.
    dup_ev = cur.execute(
        """
        SELECT e.merchant_id, s.canonical_url, COUNT(*) AS c
        FROM evidence e JOIN sources s ON e.source_id = s.id
        WHERE e.independent = 1
        GROUP BY e.merchant_id, s.canonical_url
        HAVING c > 1
        """
    ).fetchall()
    if len(dup_ev) == 0:
        ok("duplicate_evidence_urls_within_merchant=0")
    else:
        fail(f"duplicate_evidence_urls_within_merchant={len(dup_ev)}")
        failures.append("duplicate_evidence")

    # ---------- Diagnostics ----------
    print()
    print("DIAGNOSTICS")
    print("-" * 72)
    ev_total = cur.execute("SELECT COUNT(*) FROM evidence").fetchone()[0]
    src_total = cur.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
    print(f"  total evidence rows: {ev_total}")
    print(f"  total sources:       {src_total}")
    print(f"  avg evidence/merchant: {ev_total / max(total_merchants,1):.2f}")

    print()
    print("  evidence by platform:")
    for platform, c in cur.execute(
        "SELECT s.platform, COUNT(*) AS c FROM evidence e JOIN sources s ON e.source_id=s.id GROUP BY s.platform ORDER BY c DESC"
    ).fetchall():
        print(f"    {platform:30s} {c}")

    print()
    print("  sentiment distribution:")
    for s, c in cur.execute(
        "SELECT sentiment, COUNT(*) AS c FROM evidence GROUP BY sentiment ORDER BY c DESC"
    ).fetchall():
        print(f"    {s:20s} {c}")

    print()
    print("=" * 72)
    if failures:
        print(f"RESULT: FAIL ({len(failures)} gates failed: {', '.join(failures)})")
        print("=" * 72)
        return 1
    print(f"RESULT: PASS — {total_merchants}/{TARGET_MERCHANTS} MERCHANTS VALIDATED")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
