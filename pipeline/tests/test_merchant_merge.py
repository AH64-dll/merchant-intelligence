from __future__ import annotations

import json
import sqlite3
import uuid

import pytest

from merchant_intel.database import Database
from merchant_intel.merchant_merge import MergeGroup, merge_sellers
from merchant_intel.normalize import canonicalize_name


def _merchant(
    db: Database,
    merchant_id: str,
    name: str,
    *,
    city: str = "Cairo",
    confidence: float = 0.5,
) -> None:
    db.execute(
        """INSERT INTO merchants
               (id,canonical_name,normalized_name,category,city,governorate,
                identity_confidence,state,first_seen_round,created_at,updated_at)
           VALUES (?,?,?,?,?,'Cairo',?,'VERIFIED_MODERATE_CONFIDENCE',2,
                   '2026-01-02T00:00:00+00:00','2026-01-03T00:00:00+00:00')""",
        (merchant_id, name, canonicalize_name(name), "retail", city, confidence),
    )


def _run(db: Database) -> None:
    db.execute(
        """INSERT INTO pipeline_runs
               (id,started_at,updated_at,status,stage,config_json)
           VALUES ('run','2026-01-01T00:00:00+00:00','2026-01-01T00:00:00+00:00',
                   'complete','done','{}')"""
    )


def _evidence(
    db: Database,
    merchant_id: str,
    evidence_id: str,
    url: str,
    summary: str,
    *,
    claim_id: str | None = None,
    claim_owner: str | None = None,
    claim_type: str = "customer_experience",
) -> str:
    source = db.execute(
        """INSERT INTO sources
               (url,canonical_url,platform,source_type,first_seen_at,last_seen_at)
           VALUES (?,?,'forum','community','2026-01-01T00:00:00+00:00',
                   '2026-01-01T00:00:00+00:00')""",
        (url, url),
    ).lastrowid
    claim_id = claim_id or f"claim-{evidence_id}"
    if db.query_one("SELECT 1 FROM claims WHERE id=?", (claim_id,)) is None:
        db.execute(
            """INSERT INTO claims
                   (id,merchant_id,claim_type,sentiment,summary,normalized_text,fingerprint,
                    independent_source_count,mention_count,created_at,updated_at)
               VALUES (?,?,?,'positive',?,?,?,1,1,
                       '2026-01-01T00:00:00+00:00','2026-01-01T00:00:00+00:00')""",
            (
                claim_id,
                claim_owner or merchant_id,
                claim_type,
                summary,
                canonicalize_name(summary),
                f"old-{claim_id}",
            ),
        )
    db.execute(
        """INSERT INTO evidence
               (id,merchant_id,source_id,claim_id,claim_type,sentiment,summary,
                quoted_excerpt,author_type,transaction_evidence,confidence,reliability_band,
                language,published_at,captured_at,fingerprint,content_fingerprint,
                independent,duplicate_of,round_no,verified,raw_json)
           VALUES (?,?,?,?,?,'positive',?,'quote','customer',1,0.8,'strong','en',
                   '2026-01-01T00:00:00+00:00','2026-01-02T00:00:00+00:00',
                   ?,?,1,NULL,1,1,'{}')""",
        (
            evidence_id,
            merchant_id,
            source,
            claim_id,
            claim_type,
            summary,
            f"old-exact-{evidence_id}",
            f"old-content-{evidence_id}",
        ),
    )
    db.execute(
        "INSERT INTO claim_evidence(claim_id,evidence_id) VALUES (?,?)",
        (claim_id, evidence_id),
    )
    return claim_id


def _fixture(tmp_path) -> tuple[Database, tuple[MergeGroup, ...], dict[str, str]]:
    db = Database(tmp_path / "merchants.db")
    _run(db)
    _merchant(db, "target", "Chain", confidence=0.6)
    _merchant(db, "source", "Chain", city="Alexandria", confidence=0.9)
    _merchant(db, "other", "Other")
    manifest = (MergeGroup("target", ("source",)),)
    return db, manifest, {"target": "Chain", "source": "Chain"}


def _apply(db: Database, manifest, names, **kwargs):
    return merge_sellers(
        db,
        apply=True,
        manifest=manifest,
        expected_names=names,
        delta_rename=None,
        **kwargs,
    )


def test_dry_run_performs_no_writes(tmp_path) -> None:
    db, manifest, names = _fixture(tmp_path)
    before = db.query_one("SELECT COUNT(*) AS n FROM merchants")["n"]
    report = merge_sellers(
        db,
        manifest=manifest,
        expected_names=names,
        delta_rename=None,
    )
    assert report["mode"] == "dry-run"
    assert db.query_one("SELECT COUNT(*) AS n FROM merchants")["n"] == before
    assert db.query_one("SELECT canonical_name FROM merchants WHERE id='source'") is not None
    db.close()


def test_unknown_or_mismatched_manifest_is_rejected_without_writes(tmp_path) -> None:
    db, manifest, names = _fixture(tmp_path)
    with pytest.raises(ValueError, match="missing"):
        _apply(db, (MergeGroup("target", ("missing",)),), names)
    with pytest.raises(ValueError, match="canonical names changed"):
        _apply(db, manifest, {**names, "source": "Changed"})
    assert db.query_one("SELECT COUNT(*) AS n FROM merchants")["n"] == 3
    db.close()


def test_merge_conserves_owned_rows_and_rewrites_links(tmp_path) -> None:
    db, manifest, names = _fixture(tmp_path)
    db.execute(
        "INSERT INTO merchant_aliases(merchant_id,alias,normalized_alias) VALUES ('source','Chain Alexandria','chain alexandria')"
    )
    db.execute(
        """INSERT INTO merchant_identifiers(merchant_id,kind,value,normalized_value,confidence)
           VALUES ('target','phone','low','+201000000000',0.4),
                  ('source','phone','high','+201000000000',0.9)"""
    )
    claim_id = _evidence(db, "source", "e-source", "https://source.example", "source report")
    db.execute(
        """INSERT INTO verification_tasks
               (id,run_id,merchant_id,title,instruction,claim_ids_json,created_at,updated_at)
           VALUES ('task','run','source','check','check',?,
                   '2026-01-01T00:00:00+00:00','2026-01-01T00:00:00+00:00')""",
        (json.dumps([claim_id]),),
    )
    db.execute(
        """INSERT INTO merchant_analyses(run_id,merchant_id,round_no,payload_json,created_at)
           VALUES ('run','source',1,'{}','2026-01-01T00:00:00+00:00')"""
    )
    for link_id, left, right, confidence in (
        ("self-after", "source", "target", 0.2),
        ("low", "target", "other", 0.3),
        ("high", "source", "other", 0.8),
    ):
        a, b = sorted((left, right))
        db.execute(
            """INSERT INTO merchant_links
                   (id,left_merchant_id,right_merchant_id,relation,confidence,rationale,created_at)
               VALUES (?,?,?,'identifier_collision',?,'reason','2026-01-01T00:00:00+00:00')""",
            (link_id, a, b, confidence),
        )

    _apply(db, manifest, names)

    assert db.query_one("SELECT 1 FROM merchants WHERE id='source'") is None
    target = db.query_one("SELECT identity_confidence FROM merchants WHERE id='target'")
    assert target["identity_confidence"] == pytest.approx(0.9)
    identifier = db.query_one(
        "SELECT value,confidence FROM merchant_identifiers WHERE merchant_id='target' AND kind='phone'"
    )
    assert dict(identifier) == {"value": "high", "confidence": 0.9}
    assert db.query_one(
        "SELECT 1 FROM merchant_identifiers WHERE merchant_id='target' AND kind='address'"
    ) is not None
    assert db.query_one("SELECT merchant_id FROM evidence WHERE id='e-source'")["merchant_id"] == "target"
    assert db.query_one("SELECT merchant_id FROM verification_tasks WHERE id='task'")["merchant_id"] == "target"
    assert db.query_one("SELECT merchant_id FROM merchant_analyses")["merchant_id"] == "target"
    links = db.query("SELECT * FROM merchant_links")
    assert len(links) == 1
    assert links[0]["id"] == "high"
    assert links[0]["confidence"] == pytest.approx(0.8)
    assert db.query_one("PRAGMA foreign_key_check") is None


def test_merge_preserves_unrelated_sellers_derived_state(tmp_path) -> None:
    db, manifest, names = _fixture(tmp_path)
    # Two unrelated sellers: exact duplicates (root+child) and a plain row.
    root_claim = _evidence(db, "other", "e-root", "https://root.example", "unrelated report")
    _evidence(
        db,
        "other",
        "e-dup",
        "https://dup.example",
        "unrelated report",
        claim_id=root_claim,
        claim_owner="other",
    )
    # Mark the second row as an existing duplicate of the root, mirroring the
    # production pre-merge state the rebuild must leave untouched.
    db.execute(
        "UPDATE evidence SET independent=0, duplicate_of='e-root' WHERE id='e-dup'"
    )
    third_id = "11111111-1111-4111-8111-111111111111"
    _merchant(db, third_id, "Unrelated Two")
    names[third_id] = "Unrelated Two"
    _evidence(db, third_id, "e-third", "https://third.example", "unrelated two report")
    before = {
        "other": db.query_one(
            """SELECT e.fingerprint,e.content_fingerprint,e.independent,e.duplicate_of,
                      e.claim_id,c.independent_source_count AS claim_sources,c.mention_count
               FROM evidence e JOIN claims c ON c.id=e.claim_id
               WHERE e.id='e-root'"""
        ),
        "other_dup": db.query_one(
            "SELECT independent,duplicate_of,claim_id FROM evidence WHERE id='e-dup'"
        ),
        "third": db.query_one(
            """SELECT e.fingerprint,e.content_fingerprint,e.independent,e.claim_id,
                      c.mention_count
               FROM evidence e JOIN claims c ON c.id=e.claim_id
               WHERE e.id='e-third'"""
        ),
    }
    claims_before = db.query_one("SELECT COUNT(*) AS n FROM claims")["n"]
    joins_before = db.query_one(
        "SELECT COUNT(*) AS n FROM claim_evidence WHERE evidence_id IN ('e-root','e-dup','e-third')"
    )["n"]

    _apply(db, manifest, names)

    assert db.query_one("SELECT 1 FROM merchants WHERE id='source'") is None
    after_root = db.query_one(
        """SELECT e.fingerprint,e.content_fingerprint,e.independent,e.duplicate_of,
                  e.claim_id,c.independent_source_count AS claim_sources,c.mention_count
           FROM evidence e JOIN claims c ON c.id=e.claim_id
           WHERE e.id='e-root'"""
    )
    assert dict(after_root) == dict(before["other"])
    assert dict(
        db.query_one("SELECT independent,duplicate_of,claim_id FROM evidence WHERE id='e-dup'")
    ) == dict(before["other_dup"])
    assert dict(
        db.query_one(
            """SELECT e.fingerprint,e.content_fingerprint,e.independent,e.claim_id,
                      c.mention_count
               FROM evidence e JOIN claims c ON c.id=e.claim_id
               WHERE e.id='e-third'"""
        )
    ) == dict(before["third"])
    # The duplicate child stays a duplicate of the same root (no global
    # DSU re-closure across unrelated sellers).
    assert db.query_one("SELECT duplicate_of FROM evidence WHERE id='e-dup'")["duplicate_of"] == "e-root"
    claims_delta = db.query_one("SELECT COUNT(*) AS n FROM claims")["n"] - claims_before
    # Retired seller's claim is remapped onto the surviving target's claim
    # (same fingerprint group), so the claim count only drops by the groups
    # that consolidated — here the target/source pair already shared one.
    assert claims_delta == 0
    joins_after = db.query_one(
        "SELECT COUNT(*) AS n FROM claim_evidence WHERE evidence_id IN ('e-root','e-dup','e-third')"
    )["n"]
    assert joins_after == joins_before


def test_claims_duplicates_and_delta_are_rebuilt_seller_locally(tmp_path) -> None:
    db, manifest, names = _fixture(tmp_path)
    _merchant(db, "delta", "Chain", city="Giza")
    names["delta"] = "Chain"
    shared_claim = _evidence(db, "target", "e-target", "https://one.example", "same report")
    _evidence(
        db,
        "source",
        "e-source",
        "https://two.example",
        "same report",
        claim_id=shared_claim,
        claim_owner="target",
    )
    _evidence(
        db,
        "delta",
        "e-delta",
        "https://three.example",
        "same report",
        claim_id=shared_claim,
        claim_owner="target",
    )

    merge_sellers(
        db,
        apply=True,
        manifest=manifest,
        expected_names=names,
        delta_rename=("delta", "Chain — Giza"),
    )

    target_rows = db.query("SELECT * FROM evidence WHERE merchant_id='target' ORDER BY id")
    delta_row = db.query_one("SELECT * FROM evidence WHERE merchant_id='delta'")
    assert len({row["claim_id"] for row in target_rows}) == 1
    assert delta_row["claim_id"] != target_rows[0]["claim_id"]
    assert sum(row["independent"] for row in target_rows) == 1
    roots = {row["duplicate_of"] for row in target_rows if row["duplicate_of"]}
    assert roots == {next(row["id"] for row in target_rows if row["independent"])}
    assert delta_row["duplicate_of"] is None
    claim = db.query_one("SELECT mention_count FROM claims WHERE id=?", (target_rows[0]["claim_id"],))
    assert claim["mention_count"] == 2
    assert db.query_one(
        "SELECT COUNT(*) AS n FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.merchant_id<>c.merchant_id"
    )["n"] == 0
    db.close()


def test_late_failure_rolls_back_and_second_apply_fails_closed(tmp_path, monkeypatch) -> None:
    db, manifest, names = _fixture(tmp_path)
    _evidence(db, "source", "e-source", "https://source.example", "report")
    before = {
        table: db.query_one(f"SELECT COUNT(*) AS n FROM {table}")["n"]
        for table in ("merchants", "evidence", "claims", "claim_evidence")
    }
    import merchant_intel.merchant_merge as module

    original = module._assert_postconditions

    def fail(*args, **kwargs):
        raise RuntimeError("late failure")

    monkeypatch.setattr(module, "_assert_postconditions", fail)
    with pytest.raises(RuntimeError, match="late failure"):
        _apply(db, manifest, names)
    after = {
        table: db.query_one(f"SELECT COUNT(*) AS n FROM {table}")["n"]
        for table in before
    }
    assert after == before
    assert db.query_one("SELECT 1 FROM merchants WHERE id='source'") is not None

    monkeypatch.setattr(module, "_assert_postconditions", original)
    _apply(db, manifest, names)
    with pytest.raises(ValueError, match="missing"):
        _apply(db, manifest, names)
    db.close()
