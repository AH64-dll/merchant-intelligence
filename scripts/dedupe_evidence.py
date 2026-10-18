#!/usr/bin/env python3
"""Collapse multiple evidence rows that point at the same (merchant, canonical_url)
into a single row, keeping the highest-confidence observation. Other rows are
linked via duplicate_of and removed from the primary evidence set by setting
their `independent` flag to 0 (preserves provenance; the validator's
duplicate-evidence gate counts rows where the same canonical_url is cited
more than once by the same merchant — we resolve by marking them)."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "merchant_intelligence.db"


def main() -> int:
    con = sqlite3.connect(DB)
    cur = con.cursor()

    groups = cur.execute(
        """
        SELECT e.merchant_id, s.canonical_url, e.source_id, COUNT(*) AS c
        FROM evidence e JOIN sources s ON e.source_id = s.id
        GROUP BY e.merchant_id, s.canonical_url
        HAVING c > 1
        """
    ).fetchall()

    fixed = 0
    for merchant_id, canonical_url, source_id, count in groups:
        # pick keeper: highest confidence, then earliest captured
        keeper = cur.execute(
            """
            SELECT id FROM evidence
            WHERE merchant_id=? AND source_id=?
            ORDER BY confidence DESC, captured_at ASC
            LIMIT 1
            """,
            (merchant_id, source_id),
        ).fetchone()[0]
        # mark rest as duplicates of keeper (non-independent)
        cur.execute(
            """
            UPDATE evidence SET duplicate_of=?, independent=0
            WHERE merchant_id=? AND source_id=? AND id != ?
            """,
            (keeper, merchant_id, source_id, keeper),
        )
        fixed += cur.rowcount

    con.commit()
    print(f"flagged {fixed} duplicate evidence rows across {len(groups)} (merchant,url) groups")
    return 0


if __name__ == "__main__":
    sys.exit(main())
