"""Migration and write-contract tests for the v3 and v4 schemas.

Builds real v2 fixtures with the pre-migration schema (git history is the
specification of v2: UNIQUE(kind, normalized_value) identifiers, unversioned
analysis payloads, mixed-offset timestamps, chained duplicate_of pointers)
and asserts the v3 migration preserves, normalizes, and canonicalizes without
losing a single row. The v4 fixtures are degraded from the live schema and
cover every source locator that has no browser-openable URL.
"""

import json
import sqlite3
from pathlib import Path

import pytest

from merchant_intel.database import SCHEMA_VERSION, Database
from merchant_intel.ingest import ingest_evidence, resolve_merchant
from merchant_intel.normalize import canonicalize_eg_phone
from merchant_intel.schemas import EvidenceItem, MerchantCandidate, Identifiers
from merchant_intel.sources import ACCESS_KINDS

V2_IDENTIFIER_SCHEMA = """
CREATE TABLE merchant_identifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    UNIQUE(kind, normalized_value),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE INDEX IF NOT EXISTS idx_identifier_lookup ON merchant_identifiers(kind, normalized_value);
"""


def _v2_fixture(path: Path) -> None:
    """Create a minimal but structurally faithful v2 database."""
    db = Database(path)
    conn = db._conn
    # Degrade the table back to the v2 shape.
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("DROP TABLE merchant_identifiers")
    conn.executescript(V2_IDENTIFIER_SCHEMA)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("DELETE FROM schema_version")
    conn.execute("INSERT INTO schema_version(version) VALUES (2)")
    db.close()


def _insert_v2_rows(path: Path) -> None:
    """Populate the v2 fixture with rows the migration must preserve."""
    conn = sqlite3.connect(path)
    conn.execute(
        """INSERT INTO merchants
           (id, canonical_name, normalized_name, category, city, governorate,
            identity_confidence, state, first_seen_round, created_at, updated_at)
           VALUES ('m1', 'Alpha', 'alpha', 'x', 'Cairo', '', 0.5, 'INSUFFICIENT_DATA', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00')"""
    )
    conn.execute(
        """INSERT INTO merchants
           (id, canonical_name, normalized_name, category, city, governorate,
            identity_confidence, state, first_seen_round, created_at, updated_at)
           VALUES ('m2', 'Beta', 'beta', 'x', 'Giza', '', 0.5, 'INSUFFICIENT_DATA', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00')"""
    )
    # Identifiers: one shared normalized phone across two merchants is
    # impossible under v2; the fixture keeps the v2-legal rows.
    conn.execute(
        "INSERT INTO merchant_identifiers (id, merchant_id, kind, value, normalized_value, confidence)"
        " VALUES (11, 'm1', 'phone', '+201001234567', '+201001234567', 0.7)"
    )
    conn.execute(
        "INSERT INTO merchant_identifiers (id, merchant_id, kind, value, normalized_value, confidence)"
        " VALUES (12, 'm2', 'website', 'https://beta.test', 'https://beta.test', 0.7)"
    )
    # Analyses: one already versioned, one unversioned, one unparseable.
    conn.execute(
        """INSERT INTO merchant_analyses (run_id, merchant_id, round_no, payload_json, created_at)
           VALUES ('r1', 'm1', 1, ?, '2026-01-01T00:00:00')""",
        (json.dumps({"merchant_name": "Alpha", "identity_confidence": 0.6}),),
    )
    conn.execute(
        """INSERT INTO merchant_analyses (run_id, merchant_id, round_no, payload_json, created_at)
           VALUES ('r1', 'm2', 1, ?, '2026-01-01T00:00:00')""",
        (json.dumps({"merchant_name": "Beta", "payload_version": 1}),),
    )
    # Sources and evidence with mixed timestamp formats and a duplicate chain:
    # e2 duplicates e1, e3 duplicates e2 (chain), e4 duplicates e1 across
    # merchants (cross-merchant root, must be preserved as-is).
    conn.execute(
        "INSERT INTO sources (id, url, canonical_url, platform, source_type, first_seen_at, last_seen_at)"
        " VALUES (1, 'https://s.test/1', 'https://s.test/1', 'web', 'news', '2026-01-01T00:00:00', '2026-01-01T00:00:00')"
    )
    evidence_rows = [
        # id, merchant, published_at, captured_at, duplicate_of, fingerprint, content_fp
        ("e1", "m1", None, "2026-01-02T03:04:05", None, "fp1", "cfp1"),
        ("e2", "m1", "2026-01-02T03:04:05+00:00", "2026-01-02T03:04:05.123456+00:00", "e1", "fp2", "cfp2"),
        ("e3", "m1", "2026-01-02T03:04:05Z", "2026-01-02T03:04:05Z", "e2", "fp3", "cfp3"),
        ("e4", "m2", None, "2026-01-02T03:04:05", "e1", "fp4", "cfp4"),
    ]
    for eid, merchant, published, captured, dup, fp, cfp in evidence_rows:
        conn.execute(
            """INSERT INTO evidence
               (id, merchant_id, source_id, claim_type, sentiment, summary, confidence,
                reliability_band, published_at, captured_at, fingerprint,
                content_fingerprint, independent, duplicate_of, round_no, raw_json)
               VALUES (?, ?, 1, 'other', 'neutral', 'summary', 0.5, 'weak',
                       ?, ?, ?, ?, 0, ?, 1, '{}')""",
            (eid, merchant, published, captured, fp, cfp, dup),
        )
    conn.commit()
    conn.close()


def test_v2_migrates_to_v3_preserving_rows_and_backfills(tmp_path):
    path = tmp_path / "fixture.db"
    _v2_fixture(path)
    _insert_v2_rows(path)
    before = sqlite3.connect(path)
    pre_counts = {
        table: before.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in (
            "merchants",
            "merchant_identifiers",
            "merchant_analyses",
            "evidence",
            "merchant_links",
        )
    }
    pre_identifiers = before.execute(
        "SELECT id, merchant_id, kind, value, normalized_value, confidence"
        " FROM merchant_identifiers ORDER BY id"
    ).fetchall()
    before.close()

    db = Database(path)
    assert SCHEMA_VERSION == 4
    assert db.query_one("SELECT MAX(version) AS v FROM schema_version")["v"] == 4
    after_counts = {
        table: db.query_one(f"SELECT COUNT(*) AS c FROM {table}")["c"]
        for table in pre_counts
    }
    assert after_counts == pre_counts
    post_identifiers = [
        tuple(row)
        for row in db.query(
            "SELECT id, merchant_id, kind, value, normalized_value, confidence"
            " FROM merchant_identifiers ORDER BY id"
        )
    ]
    assert post_identifiers == pre_identifiers

    # Payload backfill: every analysis row now carries payload_version=1 and
    # the already-versioned row is untouched.
    payloads = [
        json.loads(row["payload_json"])
        for row in db.query("SELECT payload_json FROM merchant_analyses ORDER BY id")
    ]
    assert all(payload.get("payload_version") == 1 for payload in payloads)
    assert payloads[0]["merchant_name"] == "Alpha"
    assert payloads[1]["merchant_name"] == "Beta"

    # Timestamp normalization: offset-less values become explicit UTC, already
    # offset-aware values normalize to +00:00 (Z folds to +00:00).
    rows = {
        row["id"]: row
        for row in db.query("SELECT id, published_at, captured_at FROM evidence")
    }
    assert rows["e1"]["captured_at"] == "2026-01-02T03:04:05+00:00"
    assert rows["e1"]["published_at"] is None
    assert rows["e2"]["published_at"] == "2026-01-02T03:04:05+00:00"
    assert rows["e2"]["captured_at"] == "2026-01-02T03:04:05.123456+00:00"
    assert rows["e3"]["published_at"] == "2026-01-02T03:04:05+00:00"
    assert rows["e3"]["captured_at"] == "2026-01-02T03:04:05+00:00"

    # Duplicate chains canonicalize to the root; the cross-merchant duplicate
    # (e4 -> e1) is preserved as an explicit root, not reassigned.
    pointers = {
        row["id"]: row["duplicate_of"]
        for row in db.query("SELECT id, duplicate_of FROM evidence")
    }
    assert pointers["e2"] == "e1"
    assert pointers["e3"] == "e1"
    assert pointers["e4"] == "e1"
    assert pointers["e1"] is None
    db.close()


def test_many_owner_identifiers_accepted_across_merchants_and_unique_per_merchant(tmp_path):
    db = Database(tmp_path / "mi.db")
    phone = "+201001234567"
    first = resolve_merchant(
        db,
        MerchantCandidate(
            canonical_name="Branch One",
            city="Cairo",
            identifiers=Identifiers(phones=[phone]),
        ),
        1,
    )
    second = resolve_merchant(
        db,
        MerchantCandidate(
            canonical_name="Branch Two",
            city="Giza",
            identifiers=Identifiers(websites=["https://branch-two.test"]),
        ),
        1,
    )
    # A candidate carrying both owners' identifiers matches two merchants;
    # the name/city do not match either, so a separate merchant is created
    # and every matched owner is linked.
    third = resolve_merchant(
        db,
        MerchantCandidate(
            canonical_name="Shared Desk",
            city="Alex",
            identifiers=Identifiers(phones=[phone], websites=["https://branch-two.test"]),
        ),
        1,
    )
    assert len({first, second, third}) == 3
    phone_owners = [
        row["merchant_id"]
        for row in db.query(
            "SELECT merchant_id FROM merchant_identifiers WHERE kind='phone' AND normalized_value=?",
            (phone,),
        )
    ]
    assert sorted(phone_owners) == sorted([first, third])
    website_owners = [
        row["merchant_id"]
        for row in db.query(
            "SELECT merchant_id FROM merchant_identifiers WHERE kind='website' AND normalized_value='https://branch-two.test'"
        )
    ]
    assert sorted(website_owners) == sorted([second, third])
    relations = {
        row["relation"] for row in db.query("SELECT relation FROM merchant_links")
    }
    assert "identifier_collision" in relations
    # The same identifier remains rejected twice for one merchant.
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            """INSERT INTO merchant_identifiers
               (merchant_id, kind, value, normalized_value, confidence)
               VALUES (?, 'phone', ?, ?, 0.5)""",
            (first, phone, phone),
        )
    db.close()


def test_single_owner_candidate_merges_and_records_collision_links(tmp_path):
    db = Database(tmp_path / "mi.db")
    phone = "+201111222333"
    owner = resolve_merchant(
        db,
        MerchantCandidate(
            canonical_name="Solo Store",
            city="Cairo",
            identifiers=Identifiers(phones=[phone]),
        ),
        1,
    )
    other = resolve_merchant(
        db,
        MerchantCandidate(
            canonical_name="Second Store",
            city="Giza",
            identifiers=Identifiers(websites=["https://second.test"]),
        ),
        1,
    )
    # A candidate holding the owner's phone and another merchant's website
    # resolves to a new merchant linked to both owners.
    mixed = resolve_merchant(
        db,
        MerchantCandidate(
            canonical_name="Third Store",
            city="Alex",
            identifiers=Identifiers(phones=[phone], websites=["https://second.test"]),
        ),
        1,
    )
    assert mixed not in {owner, other}
    links = db.query("SELECT relation FROM merchant_links")
    assert all(row["relation"] == "identifier_collision" for row in links)
    assert len(links) == 2
    db.close()


def test_duplicate_cycle_rolls_back_migration(tmp_path):
    path = tmp_path / "cyclic.db"
    _v2_fixture(path)
    conn = sqlite3.connect(path)
    conn.execute(
        """INSERT INTO merchants
           (id, canonical_name, normalized_name, category, city, governorate,
            identity_confidence, state, first_seen_round, created_at, updated_at)
           VALUES ('m1', 'Alpha', 'alpha', 'x', 'Cairo', '', 0.5, 'INSUFFICIENT_DATA', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00')"""
    )
    conn.execute(
        "INSERT INTO sources (id, url, canonical_url, platform, source_type, first_seen_at, last_seen_at)"
        " VALUES (1, 'https://s.test/1', 'https://s.test/1', 'web', 'news', '2026-01-01T00:00:00', '2026-01-01T00:00:00')"
    )
    for eid, dup in (("e1", "e2"), ("e2", "e1")):
        conn.execute(
            """INSERT INTO evidence
               (id, merchant_id, source_id, claim_type, sentiment, summary, confidence,
                reliability_band, published_at, captured_at, fingerprint,
                content_fingerprint, independent, duplicate_of, round_no, raw_json)
               VALUES (?, 'm1', 1, 'other', 'neutral', 'summary', 0.5, 'weak',
                       NULL, '2026-01-02T03:04:05', ?, ?, 0, ?, 1, '{}')""",
            (eid, f"fp-{eid}", f"cfp-{eid}", dup),
        )
    conn.commit()
    snapshot = path.read_bytes()

    with pytest.raises(sqlite3.DatabaseError, match="cycle"):
        Database(path)

    # Byte-for-byte rollback: no migration artifacts survive.
    assert path.read_bytes() == snapshot
    conn = sqlite3.connect(path)
    assert conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] == 2
    conn.close()


def test_missing_duplicate_parent_rolls_back_migration(tmp_path):
    path = tmp_path / "orphan-dup.db"
    _v2_fixture(path)
    conn = sqlite3.connect(path)
    conn.execute(
        """INSERT INTO merchants
           (id, canonical_name, normalized_name, category, city, governorate,
            identity_confidence, state, first_seen_round, created_at, updated_at)
           VALUES ('m1', 'Alpha', 'alpha', 'x', 'Cairo', '', 0.5, 'INSUFFICIENT_DATA', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00')"""
    )
    conn.execute(
        "INSERT INTO sources (id, url, canonical_url, platform, source_type, first_seen_at, last_seen_at)"
        " VALUES (1, 'https://s.test/1', 'https://s.test/1', 'web', 'news', '2026-01-01T00:00:00', '2026-01-01T00:00:00')"
    )
    conn.execute(
        """INSERT INTO evidence
           (id, merchant_id, source_id, claim_type, sentiment, summary, confidence,
            reliability_band, published_at, captured_at, fingerprint,
            content_fingerprint, independent, duplicate_of, round_no, raw_json)
           VALUES ('e1', 'm1', 1, 'other', 'neutral', 'summary', 0.5, 'weak',
                   NULL, '2026-01-02T03:04:05', 'fp1', 'cfp1', 0, 'missing-root', 1, '{}')"""
    )
    conn.commit()
    snapshot = path.read_bytes()
    with pytest.raises(sqlite3.DatabaseError, match="missing"):
        Database(path)
    assert path.read_bytes() == snapshot
    conn = sqlite3.connect(path)
    assert conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] == 2
    conn.close()


def test_naive_datetimes_written_as_utc_and_aware_converted(tmp_path):
    from datetime import datetime, timedelta, timezone

    db = Database(tmp_path / "mi.db")
    merchant = resolve_merchant(
        db,
        MerchantCandidate(canonical_name="Clock Shop", city="Cairo"),
        1,
    )
    naive = EvidenceItem(
        source_url="https://t.test/naive",
        source_platform="web",
        claim_type="successful_purchase",
        summary="Naive timestamps normalize to UTC.",
        sentiment="neutral",
        confidence=0.5,
        captured_at=datetime(2026, 1, 1, 12, 30, 0),
        published_at=datetime(2025, 6, 1),
    )
    aware = EvidenceItem(
        source_url="https://t.test/aware",
        source_platform="web",
        claim_type="successful_purchase",
        summary="Aware timestamps convert to UTC.",
        sentiment="neutral",
        confidence=0.5,
        captured_at=datetime(2026, 1, 1, 15, 30, 0, tzinfo=timezone(timedelta(hours=3))),
    )
    first, _ = ingest_evidence(db, merchant, naive, agent_run_id="a", round_no=1)
    second, _ = ingest_evidence(db, merchant, aware, agent_run_id="a", round_no=1)
    rows = {row["id"]: row for row in db.query("SELECT id, captured_at, published_at FROM evidence")}
    assert rows[first]["captured_at"] == "2026-01-01T12:30:00+00:00"
    assert rows[first]["published_at"] == "2025-06-01T00:00:00+00:00"
    assert rows[second]["captured_at"] == "2026-01-01T12:30:00+00:00"
    assert rows[second]["published_at"] is None
    db.close()


def test_evidence_duplicate_write_resolves_to_chain_root(tmp_path):
    db = Database(tmp_path / "mi.db")
    merchant = resolve_merchant(
        db,
        MerchantCandidate(canonical_name="Repost Palace", city="Cairo"),
        1,
    )

    def _evidence(url: str) -> EvidenceItem:
        return EvidenceItem(
            source_url=url,
            source_platform="web",
            claim_type="other",
            summary="Same content reposted across three pages.",
            sentiment="neutral",
            confidence=0.5,
        )

    root, root_independent = ingest_evidence(
        db, merchant, _evidence("https://r.test/1"), agent_run_id="a", round_no=1
    )
    mid, mid_independent = ingest_evidence(
        db, merchant, _evidence("https://r.test/2"), agent_run_id="a", round_no=1
    )
    leaf, leaf_independent = ingest_evidence(
        db, merchant, _evidence("https://r.test/3"), agent_run_id="a", round_no=1
    )
    assert (root_independent, mid_independent, leaf_independent) == (True, False, False)
    pointers = {
        row["id"]: row["duplicate_of"]
        for row in db.query("SELECT id, duplicate_of FROM evidence")
    }
    assert pointers[mid] == root
    assert pointers[leaf] == root  # leaf skips the mid duplicate, points to root
    assert pointers[root] is None
    db.close()


def test_foreign_and_malformed_phones_rejected(tmp_path):
    assert canonicalize_eg_phone("+971501234567") is None
    assert canonicalize_eg_phone("971501234567") is None
    assert canonicalize_eg_phone("4915123456789") is None
    assert canonicalize_eg_phone("12345678") is None
    assert canonicalize_eg_phone("0100123456") is None
    assert canonicalize_eg_phone("+2010012345678") is None
    assert canonicalize_eg_phone("") is None
    # Valid Egyptian shapes still canonicalize.
    assert canonicalize_eg_phone("+201001234567") == "+201001234567"
    assert canonicalize_eg_phone("01001234567") == "+201001234567"
    assert canonicalize_eg_phone("0223456789") == "+20223456789"
    assert canonicalize_eg_phone("+20223456789") == "+20223456789"


def test_payload_version_enforced_on_new_analyses(tmp_path):
    import pydantic

    from merchant_intel.schemas import MerchantAnalysis

    analysis = MerchantAnalysis(merchant_name="Versioned")
    assert analysis.payload_version == 1
    assert MerchantAnalysis.model_validate({"payload_version": 1}).payload_version == 1
    with pytest.raises(pydantic.ValidationError):
        MerchantAnalysis.model_validate({"payload_version": 2})
    with pytest.raises(pydantic.ValidationError):
        MerchantAnalysis.model_validate({"payload_version": "x"})


# Every non-clean locator in data/merchant_intelligence.db, copied verbatim
# (ids kept), plus two synthetic shapes: one clean web URL and one URL scheme
# the classifier must reject. canonical_url is deliberately mangled for
# id 1203 -- the real row is 'https://whois:turbo-computer.com' -- because
# classification reads ``url`` only.
V4_SOURCE_FIXTURES = [
    # id, url, canonical_url, expected (web_url, locator_note, access_kind)
    (1, "https://s.test/1", "https://s.test/1", ("https://s.test/1", "", "web")),
    (
        1081,
        "whois://fitandfix.com (Verisign registry output)",
        "whois://fitandfix.com (verisign registry output)",
        (None, "fitandfix.com (Verisign registry output)", "whois"),
    ),
    (
        1119,
        "whois://ecc-alex.com",
        "whois://ecc-alex.com",
        (None, "ecc-alex.com", "whois"),
    ),
    (
        1129,
        "whois://elmhnds.com",
        "whois://elmhnds.com",
        (None, "elmhnds.com", "whois"),
    ),
    (
        1203,
        "whois:turbo-computer.com",
        "https://whois:turbo-computer.com",
        (None, "turbo-computer.com", "whois"),
    ),
    (
        1442,
        "https://whois.verisign-grs.com/ (record: highendstore.net)",
        "https://whois.verisign-grs.com/ (record: highendstore.net)",
        ("https://whois.verisign-grs.com/", "(record: highendstore.net)", "web"),
    ),
    (
        1456,
        "https://www.cpa.gov.eg (site-restricted query: راية / Raya / Rayashop)",
        "https://www.cpa.gov.eg (site-restricted query: راية / raya / rayashop)",
        (
            "https://www.cpa.gov.eg",
            "(site-restricted query: راية / Raya / Rayashop)",
            "web",
        ),
    ),
    (
        1457,
        "https://whois.verisign-grs.com/ (record: elfergany.com)",
        "https://whois.verisign-grs.com/ (record: elfergany.com)",
        ("https://whois.verisign-grs.com/", "(record: elfergany.com)", "web"),
    ),
    (
        1466,
        "https://cpa.gov.eg (site-restricted query: iGenius / آي جينيوس)",
        "https://cpa.gov.eg (site-restricted query: igenius / آي جينيوس)",
        (
            "https://cpa.gov.eg",
            "(site-restricted query: iGenius / آي جينيوس)",
            "web",
        ),
    ),
    (
        1559,
        "https://cpa.gov.eg/ar-eg/قضايا-وأحكام/PgrID/628/PageID/1"
        " … PageID/7 (plus CategoryID/20 view)",
        "https://cpa.gov.eg/ar-eg/قضايا-وأحكام/PgrID/628/PageID/1"
        " … PageID/7 (plus categoryid/20 view)",
        (
            "https://cpa.gov.eg/ar-eg/قضايا-وأحكام/PgrID/628/PageID/1",
            "… PageID/7 (plus CategoryID/20 view)",
            "web",
        ),
    ),
    (
        1567,
        "https://fixawy.com/ar/contact (also /ar/help, /ar, /en, /en/contact, /en/help)",
        "https://fixawy.com/ar/contact (also /ar/help, /ar, /en, /en/contact, /en/help)",
        (
            "https://fixawy.com/ar/contact",
            "(also /ar/help, /ar, /en, /en/contact, /en/help)",
            "web",
        ),
    ),
    (
        2000,
        "javascript:alert(1)",
        "javascript:alert(1)",
        (None, "javascript:alert(1)", "unknown"),
    ),
]


def _v3_fixture(path: Path) -> None:
    """Create a v4 database and degrade it back to the v3 shape."""
    db = Database(path)
    conn = db._conn
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("DROP TABLE merchant_briefs")
    conn.execute("DROP TABLE source_link_checks")
    for column in ("web_url", "source_label", "locator_note", "access_kind"):
        conn.execute(f"ALTER TABLE sources DROP COLUMN {column}")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("DELETE FROM schema_version")
    conn.execute("INSERT INTO schema_version(version) VALUES (3)")
    db.close()


def _insert_v3_sources(path: Path) -> None:
    """Insert the locator fixtures the v4 migration must classify."""
    conn = sqlite3.connect(path)
    for source_id, url, canonical_url, _expected in V4_SOURCE_FIXTURES:
        conn.execute(
            "INSERT INTO sources (id, url, canonical_url, platform, source_type,"
            " first_seen_at, last_seen_at)"
            " VALUES (?, ?, ?, 'web', 'other', '2026-01-01T00:00:00',"
            " '2026-01-01T00:00:00')",
            (source_id, url, canonical_url),
        )
    conn.commit()
    conn.close()


def test_migrate_v3_to_v4_classifies_locators_and_preserves_raw_urls(tmp_path):
    path = tmp_path / "v3.db"
    _v3_fixture(path)
    _insert_v3_sources(path)

    before = sqlite3.connect(path)
    pre_rows = before.execute(
        "SELECT id, url, canonical_url FROM sources ORDER BY id"
    ).fetchall()
    assert before.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE name IN"
        " ('source_link_checks', 'merchant_briefs')"
    ).fetchone()[0] == 0
    before.close()

    db = Database(path)
    assert SCHEMA_VERSION == 4
    assert db.query_one("SELECT MAX(version) AS v FROM schema_version")["v"] == 4

    # No source row is deleted, merged, or rewritten: url and canonical_url
    # stay byte-identical, including the mangled canonical form of id 1203.
    assert [
        (row["id"], row["url"], row["canonical_url"])
        for row in db.query("SELECT id, url, canonical_url FROM sources ORDER BY id")
    ] == pre_rows

    classified = {
        row["id"]: (row["web_url"], row["locator_note"], row["access_kind"])
        for row in db.query(
            "SELECT id, web_url, locator_note, access_kind FROM sources"
        )
    }
    for source_id, url, _canonical_url, expected in V4_SOURCE_FIXTURES:
        assert classified[source_id] == expected, url
    assert {kind for _id, (_web, _note, kind) in classified.items()} <= set(ACCESS_KINDS)
    # source_label is never invented by the migration.
    assert {row["source_label"] for row in db.query("SELECT source_label FROM sources")} == {""}

    columns = {
        table: [row["name"] for row in db.query(f"PRAGMA table_info({table})")]
        for table in ("source_link_checks", "merchant_briefs")
    }
    assert columns["source_link_checks"] == [
        "source_id",
        "status",
        "checked_at",
        "final_url",
        "http_status",
        "detail",
    ]
    assert columns["merchant_briefs"] == [
        "merchant_id",
        "evidence_set_hash",
        "payload_json",
        "generated_at",
        "model",
        "reviewed_at",
    ]
    assert db.query_one(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index'"
        " AND name='idx_link_checks_status'"
    )["c"] == 1
    db.close()


def test_v4_migration_does_not_rerun_on_reopen(tmp_path):
    """Open, close, reopen: the backfill lands once and is not recomputed."""
    path = tmp_path / "v4.db"
    _v3_fixture(path)
    conn = sqlite3.connect(path)
    conn.execute(
        "INSERT INTO sources (url, canonical_url, platform, source_type,"
        " first_seen_at, last_seen_at) VALUES"
        " ('whois://elmhnds.com', 'whois://elmhnds.com', 'web', 'registry',"
        " '2026-01-01T00:00:00', '2026-01-01T00:00:00')"
    )
    conn.commit()
    conn.close()

    first = Database(path)
    expected = ("whois://elmhnds.com", None, "elmhnds.com", "whois")
    assert tuple(
        first.query_one("SELECT url, web_url, locator_note, access_kind FROM sources")
    ) == expected
    first.close()

    reopened = Database(path)
    assert reopened.query_one("SELECT MAX(version) AS v FROM schema_version")["v"] == 4
    assert tuple(
        reopened.query_one(
            "SELECT url, web_url, locator_note, access_kind FROM sources"
        )
    ) == expected
    reopened.close()
