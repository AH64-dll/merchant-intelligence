#!/usr/bin/env python3
"""Mark merchants listed in data/orchestrator/state/exhausted_merchants.txt
as state='UNVERIFIABLE_FOOTPRINT'. These are merchants that were researched
but produced zero (or insufficient) real online evidence. Idempotent."""

from __future__ import annotations

import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "merchant_intelligence.db"
EXH = ROOT / "data" / "orchestrator" / "state" / "exhausted_merchants.txt"


def main() -> int:
    ids = [l.strip() for l in EXH.read_text().splitlines() if l.strip()]
    con = sqlite3.connect(DB)
    cur = con.cursor()
    now = datetime.now(timezone.utc).isoformat()
    n = 0
    for mid in ids:
        cur.execute(
            "UPDATE merchants SET state='UNVERIFIABLE_FOOTPRINT', updated_at=? WHERE id=?",
            (now, mid),
        )
        n += cur.rowcount
    con.commit()
    print(f"flagged {n} merchants as UNVERIFIABLE_FOOTPRINT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
