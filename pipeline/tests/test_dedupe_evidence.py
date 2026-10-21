"""Tests for evidence deduplication and duplicate_of cycle prevention."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from dedupe_evidence import dedupe_evidence_in_db  # noqa: E402


def _create_test_db(db_path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute(
        """
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            url TEXT NOT NULL,
            canonical_url TEXT NOT NULL,
            platform TEXT NOT NULL,
            source_type TEXT NOT NULL,
            first_seen_at TEXT,
            last_seen_at TEXT
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE evidence (
            id TEXT PRIMARY KEY,
            merchant_id TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            claim_id TEXT,
            claim_type TEXT,
            sentiment TEXT,
            summary TEXT,
            quoted_excerpt TEXT,
            author_type TEXT,
            confidence REAL,
            reliability_band TEXT,
            published_at TEXT,
            captured_at TEXT,
            independent INTEGER NOT NULL DEFAULT 1,
            duplicate_of TEXT,
            verified INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (source_id) REFERENCES sources(id),
            FOREIGN KEY (duplicate_of) REFERENCES evidence(id)
        );
        """
    )
    con.commit()
    return con


def test_dedupe_collapses_same_merchant_and_url_to_single_root(tmp_path: Path):
    db_path = tmp_path / "test.db"
    con = _create_test_db(db_path)
    cur = con.cursor()

    cur.execute(
        "INSERT INTO sources (id, url, canonical_url, platform, source_type) "
        "VALUES (1, 'https://example.com/item', 'https://example.com/item', 'web', 'web')"
    )
    # Merchant 1 has 3 evidence rows for the same source URL
    cur.execute(
        "INSERT INTO evidence (id, merchant_id, source_id, confidence, captured_at, independent, duplicate_of) "
        "VALUES ('e1', 'm1', 1, 0.7, '2026-01-01T00:00:00Z', 1, NULL)"
    )
    cur.execute(
        "INSERT INTO evidence (id, merchant_id, source_id, confidence, captured_at, independent, duplicate_of) "
        "VALUES ('e2', 'm1', 1, 0.95, '2026-01-02T00:00:00Z', 1, NULL)"
    )
    cur.execute(
        "INSERT INTO evidence (id, merchant_id, source_id, confidence, captured_at, independent, duplicate_of) "
        "VALUES ('e3', 'm1', 1, 0.8, '2026-01-03T00:00:00Z', 1, NULL)"
    )
    con.commit()
    con.close()

    fixed = dedupe_evidence_in_db(db_path)
    assert fixed == 2

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT id, independent, duplicate_of FROM evidence ORDER BY id"
    ).fetchall()
    by_id = {r[0]: (r[1], r[2]) for r in rows}

    # e2 had highest confidence (0.95), so it should be keeper
    assert by_id["e2"] == (1, None)
    # e1 and e3 must point to e2 as duplicates
    assert by_id["e1"] == (0, "e2")
    assert by_id["e3"] == (0, "e2")
    con.close()


def test_dedupe_breaks_existing_cycles_and_normalizes(tmp_path: Path):
    db_path = tmp_path / "test_cycles.db"
    con = _create_test_db(db_path)
    cur = con.cursor()

    cur.execute(
        "INSERT INTO sources (id, url, canonical_url, platform, source_type) "
        "VALUES (1, 'https://example.com/item', 'https://example.com/item', 'web', 'web')"
    )
    # Pre-existing cycle: e1 -> e2, and e2 -> e1!
    cur.execute(
        "INSERT INTO evidence (id, merchant_id, source_id, confidence, captured_at, independent, duplicate_of) "
        "VALUES ('e1', 'm1', 1, 0.9, '2026-01-01T00:00:00Z', 0, 'e2')"
    )
    cur.execute(
        "INSERT INTO evidence (id, merchant_id, source_id, confidence, captured_at, independent, duplicate_of) "
        "VALUES ('e2', 'm1', 1, 0.8, '2026-01-02T00:00:00Z', 0, 'e1')"
    )
    con.commit()
    con.close()

    dedupe_evidence_in_db(db_path)

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT id, independent, duplicate_of FROM evidence ORDER BY id"
    ).fetchall()
    by_id = {r[0]: (r[1], r[2]) for r in rows}

    # Cycle must be broken: e1 is higher confidence, so e1 is root and e2 points to e1
    assert by_id["e1"] == (1, None)
    assert by_id["e2"] == (0, "e1")

    # Verify no cycle can be detected
    for eid, (_, parent) in by_id.items():
        seen = {eid}
        curr = parent
        while curr:
            assert curr not in seen, f"Cycle detected at {curr}"
            seen.add(curr)
            curr = by_id[curr][1] if curr in by_id else None
    con.close()


def test_dedupe_flattens_multi_hop_chains_and_is_idempotent(tmp_path: Path):
    db_path = tmp_path / "test_chains.db"
    con = _create_test_db(db_path)
    cur = con.cursor()

    cur.execute(
        "INSERT INTO sources (id, url, canonical_url, platform, source_type) "
        "VALUES (1, 'https://example.com/root', 'https://example.com/root', 'web', 'web'), "
        "       (2, 'https://example.com/child1', 'https://example.com/child1', 'web', 'web'), "
        "       (3, 'https://example.com/child2', 'https://example.com/child2', 'web', 'web')"
    )
    # Pre-existing chain: e3 -> e2 -> e1 (depth 2)
    cur.execute(
        "INSERT INTO evidence (id, merchant_id, source_id, confidence, captured_at, independent, duplicate_of) "
        "VALUES ('e1', 'm1', 1, 0.9, '2026-01-01T00:00:00Z', 1, NULL), "
        "       ('e2', 'm1', 2, 0.8, '2026-01-02T00:00:00Z', 0, 'e1'), "
        "       ('e3', 'm1', 3, 0.7, '2026-01-03T00:00:00Z', 0, 'e2')"
    )
    con.commit()
    con.close()

    dedupe_evidence_in_db(db_path)

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    by_id = dict(
        cur.execute(
            "SELECT id, duplicate_of FROM evidence WHERE duplicate_of IS NOT NULL"
        ).fetchall()
    )
    # Both e2 and e3 must point directly to root e1 (depth 1 only)
    assert by_id["e2"] == "e1"
    assert by_id["e3"] == "e1"
    con.close()

    # Re-running must be completely idempotent
    dedupe_evidence_in_db(db_path)
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    by_id_after = dict(
        cur.execute(
            "SELECT id, duplicate_of FROM evidence WHERE duplicate_of IS NOT NULL"
        ).fetchall()
    )
    assert by_id == by_id_after
    con.close()
