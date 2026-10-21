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

def dedupe_evidence_in_db(db_path: Path | str) -> int:
    con = sqlite3.connect(db_path)
    cur = con.cursor()

    groups = cur.execute(
        """
        SELECT e.merchant_id, s.canonical_url, COUNT(*) AS c
        FROM evidence e JOIN sources s ON e.source_id = s.id
        WHERE s.canonical_url IS NOT NULL AND trim(s.canonical_url) != ''
        GROUP BY e.merchant_id, s.canonical_url
        HAVING c > 1
        """
    ).fetchall()

    fixed = 0
    for merchant_id, canonical_url, count in groups:
        rows = cur.execute(
            """
            SELECT e.id, e.confidence, e.captured_at, e.independent, e.duplicate_of
            FROM evidence e JOIN sources s ON e.source_id = s.id
            WHERE e.merchant_id = ? AND s.canonical_url = ?
            ORDER BY e.independent DESC, e.confidence DESC, e.captured_at ASC, e.id ASC
            """,
            (merchant_id, canonical_url),
        ).fetchall()

        if len(rows) <= 1:
            continue

        keeper = rows[0][0]

        # Explicitly ensure keeper is root
        cur.execute(
            "UPDATE evidence SET duplicate_of = NULL, independent = 1 WHERE id = ?",
            (keeper,),
        )

        other_ids = [r[0] for r in rows[1:]]
        placeholders = ",".join("?" for _ in other_ids)
        cur.execute(
            f"UPDATE evidence SET duplicate_of = ?, independent = 0 WHERE id IN ({placeholders})",
            [keeper] + other_ids,
        )
        fixed += len(other_ids)

    # Global cycle detection, chain-flattening, and cross-merchant / dangling pointer cleanup
    dup_rows = cur.execute(
        "SELECT id, merchant_id, duplicate_of FROM evidence WHERE duplicate_of IS NOT NULL"
    ).fetchall()
    parent_map = {r[0]: r[2] for r in dup_rows}
    merchant_map = dict(cur.execute("SELECT id, merchant_id FROM evidence").fetchall())

    updates: list[tuple[str, str]] = []
    for child_id, parent_id in list(parent_map.items()):
        seen = {child_id}
        curr = parent_id
        cycle_detected = False
        while curr in parent_map:
            if curr in seen:
                cycle_detected = True
                break
            seen.add(curr)
            curr = parent_map[curr]

        if cycle_detected:
            # Break cycle immediately: reset child to independent root
            cur.execute(
                "UPDATE evidence SET duplicate_of = NULL, independent = 1 WHERE id = ?",
                (child_id,),
            )
            del parent_map[child_id]
        elif curr not in merchant_map or merchant_map.get(curr) != merchant_map.get(child_id):
            # Missing parent or cross-merchant root: clear pointer
            cur.execute(
                "UPDATE evidence SET duplicate_of = NULL, independent = 1 WHERE id = ?",
                (child_id,),
            )
            del parent_map[child_id]
        elif curr != parent_id:
            # Multi-hop duplicate: flatten directly to root
            updates.append((curr, child_id))

    if updates:
        cur.executemany("UPDATE evidence SET duplicate_of = ? WHERE id = ?", updates)

    con.commit()
    con.close()
    return fixed


def main() -> int:
    fixed = dedupe_evidence_in_db(DB)
    print(f"flagged {fixed} duplicate evidence rows")
    return 0

if __name__ == "__main__":
    sys.exit(main())
