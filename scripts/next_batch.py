#!/usr/bin/env python3
"""Print the next batch of merchants needing enrichment (Phase 1) or, when
Phase 1 is complete, the count of new merchants still needed (Phase 2).

Output: JSON to stdout.

Usage:
  next_batch.py phase1 --size N   -> {"merchants":[...], "remaining_after":int}
  next_batch.py phase2 --size N   -> {"still_needed":int, "existing_names":[...]}
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "merchant_intelligence.db"
MIN_SRC = 3
TARGET = 700


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("phase", choices=["phase1", "phase2", "status"])
    p.add_argument("--size", type=int, default=5)
    args = p.parse_args()

    con = sqlite3.connect(DB)
    cur = con.cursor()

    if args.phase == "status":
        total = cur.execute("SELECT COUNT(*) FROM merchants").fetchone()[0]
        below = cur.execute(
            """SELECT COUNT(*) FROM (
                 SELECT m.id FROM merchants m
                 LEFT JOIN evidence e ON e.merchant_id=m.id AND e.independent=1
                 WHERE m.state != 'UNVERIFIABLE_FOOTPRINT'
                 GROUP BY m.id
                 HAVING COUNT(DISTINCT e.source_id) < ?
               )""",
            (MIN_SRC,),
        ).fetchone()[0]
        print(json.dumps({"total_merchants": total, "below_quota": below, "target": TARGET}))
        return 0

    if args.phase == "phase1":
        exhausted_file = ROOT / "data" / "orchestrator" / "state" / "exhausted_merchants.txt"
        exhausted: set[str] = set()
        if exhausted_file.exists():
            exhausted = {l.strip() for l in exhausted_file.read_text().splitlines() if l.strip()}
        all_rows = cur.execute(
            """
            SELECT m.id, m.canonical_name, m.normalized_name, m.category,
                   m.city, m.governorate,
                   COUNT(DISTINCT e.source_id) AS src
            FROM merchants m
            LEFT JOIN evidence e ON e.merchant_id = m.id AND e.independent = 1
            GROUP BY m.id
            HAVING src < ?
            ORDER BY src ASC, m.canonical_name
            """,
            (MIN_SRC,),
        ).fetchall()
        rows = [r for r in all_rows if r[0] not in exhausted][: args.size]
        if exhausted:
            placeholders = ",".join("?" for _ in exhausted)
            remaining_total = cur.execute(
                f"""SELECT COUNT(*) FROM (
                     SELECT m.id FROM merchants m
                     LEFT JOIN evidence e ON e.merchant_id=m.id AND e.independent=1
                     WHERE m.id NOT IN ({placeholders})
                     GROUP BY m.id
                     HAVING COUNT(DISTINCT e.source_id) < ?
                   )""",
                list(exhausted) + [MIN_SRC],
            ).fetchone()[0]
        else:
            remaining_total = len([r for r in all_rows if r[0] not in exhausted])
        merchants = [
            {
                "id": r[0],
                "canonical_name": r[1],
                "normalized_name": r[2],
                "category": r[3],
                "city": r[4],
                "governorate": r[5],
                "current_sources": r[6],
                "sources_needed": MIN_SRC - r[6],
            }
            for r in rows
        ]
        print(
            json.dumps(
                {
                    "phase": 1,
                    "batch_size": len(merchants),
                    "remaining_below_quota": remaining_total,
                    "merchants": merchants,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    # phase2
    exhausted_file = ROOT / "data" / "orchestrator" / "state" / "exhausted_merchants.txt"
    exhausted: set[str] = set()
    if exhausted_file.exists():
        exhausted = {l.strip() for l in exhausted_file.read_text().splitlines() if l.strip()}
    total = cur.execute("SELECT COUNT(*) FROM merchants").fetchone()[0]
    if exhausted:
        placeholders = ",".join("?" for _ in exhausted)
        below = cur.execute(
            f"""SELECT COUNT(*) FROM (
                 SELECT m.id FROM merchants m
                 LEFT JOIN evidence e ON e.merchant_id=m.id AND e.independent=1
                 WHERE m.id NOT IN ({placeholders})
                 GROUP BY m.id
                 HAVING COUNT(DISTINCT e.source_id) < ?
               )""",
            list(exhausted) + [MIN_SRC],
        ).fetchone()[0]
    else:
        below = cur.execute(
            """SELECT COUNT(*) FROM (
                 SELECT m.id FROM merchants m
                 LEFT JOIN evidence e ON e.merchant_id=m.id AND e.independent=1
                 GROUP BY m.id
                 HAVING COUNT(DISTINCT e.source_id) < ?
               )""",
            (MIN_SRC,),
        ).fetchone()[0]
    names = [
        r[0]
        for r in cur.execute("SELECT canonical_name FROM merchants ORDER BY canonical_name").fetchall()
    ]
    print(
        json.dumps(
            {
                "phase": 2,
                "phase1_done": below == 0,
                "total_merchants": total,
                "still_needed_to_700": max(TARGET - total, 0),
                "merchants_below_quota": below,
                "existing_merchant_names": names,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
