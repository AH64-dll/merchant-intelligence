"""Tests for the presentation package builder and the cited-brief writer.

No test reaches the network or the real OMP provider: the model-call seam
(the same ``OmpTransport.run`` path reanalysis.py uses) is stubbed with a
payload-returning fake client.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass
from pathlib import Path

import pytest

from merchant_intel.briefs import (
    generate_briefs,
    stale_brief_merchant_ids,
    upsert_brief,
)
from merchant_intel.config import load_config
from merchant_intel.database import Database
from merchant_intel.ingest import resolve_merchant
from merchant_intel.presentation import (
    build_presentation_package,
    evidence_set_hash,
    validate_brief_payload,
)
from merchant_intel.schemas import MerchantCandidate

# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------


def _config(tmp_path: Path):
    cfg = load_config(smoke=True)
    cfg.root = tmp_path
    cfg.database_path = "mi.db"
    cfg.export_dir = "export"
    cfg.log_dir = "logs"
    return cfg


def _merchant(db: Database, name: str, *, identifiers: dict[str, list[str]] | None = None) -> str:
    return resolve_merchant(
        db,
        MerchantCandidate(
            canonical_name=name,
            category="electronics",
            city="Cairo",
            governorate="Cairo",
            identifiers=identifiers or {"websites": [f"https://{name.lower().replace(' ', '-')}.test"]},
        ),
        1,
    )


def _source(db: Database, *, url: str, web_url: str | None = None, access_kind: str = "web", label: str = "") -> int:
    db.execute(
        """INSERT INTO sources
               (url, canonical_url, platform, source_type, first_seen_at, last_seen_at,
                web_url, source_label, locator_note, access_kind)
           VALUES (?, ?, 'web', 'review', '2026-01-01T00:00:00+00:00',
                   '2026-01-01T00:00:00+00:00', ?, ?, '', ?)""",
        (url, url, web_url, label, access_kind),
    )
    row = db.query_one("SELECT last_insert_rowid() AS id")
    return int(row["id"])


def _claim(db: Database, merchant_id: str, claim_id: str, summary: str) -> None:
    db.execute(
        """INSERT INTO claims
               (id, merchant_id, claim_type, sentiment, summary, normalized_text, fingerprint,
                independent_source_count, mention_count, created_at, updated_at)
           VALUES (?, ?, 'customer_experience', 'negative', ?, ?, ?, 1, 1,
                   '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')""",
        (claim_id, merchant_id, summary, summary.lower(), f"fp-{claim_id}"),
    )


def _evidence(
    db: Database,
    merchant_id: str,
    evidence_id: str,
    source_id: int,
    *,
    summary: str = "",
    raw_quote: str = "",
    claim_id: str | None = None,
    duplicate_of: str | None = None,
) -> str:
    db.execute(
        """INSERT INTO evidence
               (id, merchant_id, source_id, claim_id, claim_type, sentiment, summary,
                quoted_excerpt, author_type, transaction_evidence, confidence, reliability_band,
                language, published_at, captured_at, fingerprint, content_fingerprint,
                independent, duplicate_of, round_no, verified, raw_json)
           VALUES (?, ?, ?, ?, 'customer_experience', 'negative', ?, ?,
                   'customer', 0, 0.8, 'medium', 'ar',
                   '2026-01-01T00:00:00+00:00', '2026-01-02T00:00:00+00:00',
                   ?, ?, ?, ?, 1, 1, '{}')""",
        (
            evidence_id,
            merchant_id,
            source_id,
            claim_id,
            summary,
            raw_quote,
            f"fp-{evidence_id}",
            f"cfp-{evidence_id}",
            0 if duplicate_of else 1,
            duplicate_of,
        ),
    )
    if claim_id:
        db.execute(
            "INSERT OR IGNORE INTO claim_evidence(claim_id, evidence_id) VALUES (?, ?)",
            (claim_id, evidence_id),
        )
    return evidence_id


def _rich_merchant(db: Database) -> str:
    """One seller: 3 meaningful root evidence rows across 2 sources (one
    source with a link-check row, one without), one duplicate child, one
    source-only row, and a whois source."""
    merchant_id = _merchant(
        db,
        "Rich Store",
        identifiers={"phones": ["+201001234567"], "websites": ["https://rich.example.com"]},
    )
    s1 = _source(db, url="https://src-one.test/a", web_url="https://src-one.test/a", label="مصدر أول")
    s2 = _source(db, url="https://src-two.test/b", web_url="https://src-two.test/b", label="مصدر ثانٍ")
    s3 = _source(db, url="whois:rich.example.com", web_url=None, access_kind="whois", label="سجل النطاق")
    db.execute(
        """INSERT INTO source_link_checks (source_id, status, checked_at, final_url, http_status, detail)
           VALUES (?, 'reachable', '2026-06-01T00:00:00+00:00', ?, 200, '')""",
        (s1, "https://src-one.test/a"),
    )

    _claim(db, merchant_id, "claim-1", "تأخير في التوصيل")
    _evidence(
        db, merchant_id, "ev-meaningful-1", s1,
        summary="تأخير في التوصيل لأسبوعين", claim_id="claim-1",
    )
    _evidence(
        db, merchant_id, "ev-meaningful-2", s2,
        summary="تغليف سيء", raw_quote="المنتج وصل مكسورًا",
    )
    # meaningful but sharing source s1 (so 2 sources across 3 meaningful rows)
    _evidence(
        db, merchant_id, "ev-meaningful-3", s1,
        summary="رد المتجر متأخر",
    )
    # duplicate child pointing at the first root
    _evidence(db, merchant_id, "ev-dup-child", s2, duplicate_of="ev-meaningful-1")
    _evidence(db, merchant_id, "ev-source-only", s3)
    return merchant_id


def _valid_payload(pkg, *, certainty: str | None = None) -> dict:
    evidence_id = pkg.root_evidence[0].evidence_id
    return {
        "identity_message": {
            "text": "المتجر مرتبط برقم هاتف وموقع إلكتروني في السجل.",
            "evidence_ids": [evidence_id],
            "certainty": certainty or "identified",
        },
        "reputation_message": {
            "text": "توجد شكاوى موثقة من تأخير التوصيل.",
            "evidence_ids": [evidence_id],
        },
        "bullets": [
            {"text": "شكوى تأخير توصيل موثقة بتاريخ.", "evidence_ids": [evidence_id]}
        ],
        "unknowns": [],
    }


# --------------------------------------------------------------------------
# Fake transport over the OmpTransport.run seam (no network, no provider)
# --------------------------------------------------------------------------


@dataclass
class _FakeResult:
    ok: bool = True
    model: str | None = None
    payload: object = None
    error: str | None = None


class FakeOmpClient:
    """Records AgentRequests and returns scripted payloads per role."""

    def __init__(self, *, analyst_payloads=None, verifier_payloads=None, catalog=None):
        self.catalog = catalog or [
            "google-antigravity/gemini-3.7-flash",
            "openai-codex/gpt-5.6-luna",
            "merge-gateway/glm-5.3-flash",
        ]
        self.analyst_payloads = list(analyst_payloads or [])
        self.verifier_payloads = list(verifier_payloads or [])
        self.calls: list[object] = []

    async def list_models(self) -> list[str]:
        return list(self.catalog)

    async def run(self, request):
        self.calls.append(request)
        if request.role == "analyst":
            payload = self.analyst_payloads.pop(0) if self.analyst_payloads else {"__fail__": True}
            if isinstance(payload, dict) and payload.get("__fail__"):
                return _FakeResult(ok=False, model=request.model, payload=None, error="provider down")
            return _FakeResult(ok=True, model=request.model, payload=payload)
        payload = self.verifier_payloads.pop(0) if self.verifier_payloads else {"ok": True, "issues": []}
        return _FakeResult(ok=True, model=request.model, payload=payload)


# --------------------------------------------------------------------------
# Package builder
# --------------------------------------------------------------------------


def test_package_fields_counts_and_sources(tmp_path):
    cfg = _config(tmp_path)
    db = Database(cfg.resolve(cfg.database_path))
    merchant_id = _rich_merchant(db)

    pkg = build_presentation_package(db, merchant_id)
    assert pkg is not None
    assert pkg.merchant_id == merchant_id
    assert pkg.canonical_name == "Rich Store"
    assert pkg.city == "Cairo"
    assert pkg.category == "electronics"

    # 3 meaningful root rows + 1 source-only root = 4 roots; dup child excluded
    assert len(pkg.root_evidence) == 4
    assert {ref.evidence_id for ref in pkg.root_evidence} == {
        "ev-meaningful-1", "ev-meaningful-2", "ev-meaningful-3", "ev-source-only",
    }
    assert pkg.duplicate_children_count == 1
    assert pkg.source_only_count == 1

    # sources: two web sources with labels, one whois without web_url
    by_id = {s.source_id: s for ref in pkg.root_evidence for s in ref.sources}
    assert len(by_id) == 3
    s1 = next(s for s in by_id.values() if s.source_label == "مصدر أول")
    assert s1.web_url == "https://src-one.test/a"
    assert s1.access_kind == "web"
    assert s1.check_status == "reachable"
    s2 = next(s for s in by_id.values() if s.source_label == "مصدر ثانٍ")
    assert s2.check_status is None
    s3 = next(s for s in by_id.values() if s.access_kind == "whois")
    assert s3.web_url is None
    assert s3.check_status is None

    # identifiers: phone + website (displayable), roles derived conservatively
    kinds = {item["kind"] for item in pkg.identifiers}
    assert kinds == {"phone", "website"}
    assert set(pkg.allowed_identifier_matches) == {"contact", "owned_site"}
    assert pkg.all_source_ids == tuple(sorted(by_id))

    # missing merchant -> None
    assert build_presentation_package(db, str(uuid.uuid4())) is None
    db.close()


def test_evidence_set_hash_stability_and_sensitivity(tmp_path):
    cfg = _config(tmp_path)
    db = Database(cfg.resolve(cfg.database_path))
    merchant_id = _rich_merchant(db)

    pkg1 = build_presentation_package(db, merchant_id)
    pkg2 = build_presentation_package(db, merchant_id)
    h1 = evidence_set_hash(pkg1)
    h2 = evidence_set_hash(pkg2)
    assert h1 == h2
    assert len(h1) == 32
    # stable across a "restart": rebuild in a fresh process-equivalent way
    assert evidence_set_hash(build_presentation_package(db, merchant_id)) == h1

    # changed input -> different hash: add a new meaningful evidence row
    s_new = _source(db, url="https://src-new.test/c", web_url="https://src-new.test/c")
    _evidence(db, merchant_id, "ev-new", s_new, summary="شكوى جديدة تمامًا")
    pkg3 = build_presentation_package(db, merchant_id)
    assert evidence_set_hash(pkg3) != h1

    # changed input -> different hash: link-check status change on an existing source
    db.execute(
        "UPDATE source_link_checks SET status='not_found' WHERE source_id=?",
        (next(s.source_id for s in pkg3.root_evidence[0].sources),),
    )
    pkg4 = build_presentation_package(db, merchant_id)
    assert evidence_set_hash(pkg4) != evidence_set_hash(pkg3)
    db.close()


# --------------------------------------------------------------------------
# Validator
# --------------------------------------------------------------------------


def _pkg_for_validator(tmp_path):
    cfg = _config(tmp_path)
    db = Database(cfg.resolve(cfg.database_path))
    merchant_id = _rich_merchant(db)
    pkg = build_presentation_package(db, merchant_id)
    return db, pkg


def test_validator_accepts_valid_payload(tmp_path):
    db, pkg = _pkg_for_validator(tmp_path)
    assert validate_brief_payload(_valid_payload(pkg), pkg) == []
    db.close()


def test_validator_rejects_fabricated_evidence_id(tmp_path):
    db, pkg = _pkg_for_validator(tmp_path)
    payload = _valid_payload(pkg)
    payload["bullets"][0]["evidence_ids"] = ["ev-does-not-exist"]
    issues = validate_brief_payload(payload, pkg)
    assert any("ev-does-not-exist" in issue for issue in issues)
    db.close()


def test_validator_rejects_verdict_word(tmp_path):
    db, pkg = _pkg_for_validator(tmp_path)
    payload = _valid_payload(pkg)
    payload["reputation_message"]["text"] = "هذا المتجر مضمون في التعامل."
    issues = validate_brief_payload(payload, pkg)
    assert any("مضمون" in issue for issue in issues)
    db.close()


def test_validator_rejects_seven_bullets(tmp_path):
    db, pkg = _pkg_for_validator(tmp_path)
    payload = _valid_payload(pkg)
    evidence_id = pkg.root_evidence[0].evidence_id
    payload["bullets"] = [
        {"text": f"ملاحظة رقم {index} موثقة.", "evidence_ids": [evidence_id]} for index in range(7)
    ]
    issues = validate_brief_payload(payload, pkg)
    assert any("bullets" in issue and "6" in issue for issue in issues)
    db.close()


def test_validator_rejects_missing_certainty(tmp_path):
    db, pkg = _pkg_for_validator(tmp_path)
    payload = _valid_payload(pkg)
    del payload["identity_message"]["certainty"]
    issues = validate_brief_payload(payload, pkg)
    assert any("certainty" in issue for issue in issues)
    db.close()


def test_validator_rejects_certainty_mismatching_boundary(tmp_path):
    db, pkg = _pkg_for_validator(tmp_path)
    # Rich Store has phone + website -> contact + owned_site -> identified;
    # claiming "unverified" contradicts the conservative boundary.
    assert set(pkg.allowed_identifier_matches) == {"contact", "owned_site"}
    payload = _valid_payload(pkg, certainty="unverified")
    issues = validate_brief_payload(payload, pkg)
    assert any("certainty" in issue for issue in issues)
    db.close()


def test_validator_rejects_scores_and_percentages(tmp_path):
    db, pkg = _pkg_for_validator(tmp_path)
    payload = _valid_payload(pkg)
    payload["bullets"][0]["text"] = "نسبة الرضا 95% حسب الشكاوى."
    issues = validate_brief_payload(payload, pkg)
    assert any("score" in issue or "percentage" in issue for issue in issues)
    db.close()


# --------------------------------------------------------------------------
# stale_brief_merchant_ids
# --------------------------------------------------------------------------


def test_stale_brief_merchant_ids_contents(tmp_path):
    cfg = _config(tmp_path)
    db = Database(cfg.resolve(cfg.database_path))
    rich = _rich_merchant(db)
    empty = _merchant(db, "Empty Store")
    db.execute(
        "UPDATE merchants SET identity_confidence=0.2 WHERE id=?", (empty,)
    )

    # No briefs at all: both are stale
    assert stale_brief_merchant_ids(db) == sorted([empty, rich])

    rich_hash = evidence_set_hash(build_presentation_package(db, rich))
    now = "2026-06-01T00:00:00+00:00"
    upsert_brief(db, rich, rich_hash, _valid_payload(build_presentation_package(db, rich)), "m", now)

    # Only the merchant without a brief is stale now
    assert stale_brief_merchant_ids(db) == [empty]

    # Make the fresh brief stale by changing the evidence set
    s_new = _source(db, url="https://src-stale.test/d", web_url="https://src-stale.test/d")
    _evidence(db, rich, "ev-staler", s_new, summary="ملاحظة إضافية جديدة")
    assert stale_brief_merchant_ids(db) == sorted([empty, rich])

    # limit bounds the result
    assert len(stale_brief_merchant_ids(db, limit=1)) == 1
    db.close()


# --------------------------------------------------------------------------
# generate_briefs
# --------------------------------------------------------------------------


def _brief_row(db: Database, merchant_id: str):
    return db.query_one(
        "SELECT * FROM merchant_briefs WHERE merchant_id=?", (merchant_id,)
    )


def test_generate_briefs_happy_path_apply_writes_and_second_run_is_fresh(tmp_path):
    cfg = _config(tmp_path)
    db = Database(cfg.resolve(cfg.database_path))
    merchant_id = _rich_merchant(db)
    pkg = build_presentation_package(db, merchant_id)
    draft = _valid_payload(pkg)
    client = FakeOmpClient(analyst_payloads=[draft], verifier_payloads=[{"ok": True, "issues": []}])

    result = asyncio.run(
        generate_briefs(db, [merchant_id], apply=True, dry_run=False, cfg=cfg, client=client)
    )
    assert [o["status"] for o in result["outcomes"]] == ["drafted"]
    assert result["draft_model"] == "google-antigravity/gemini-3.7-flash"
    assert result["review_model"] == "merge-gateway/glm-5.3-flash"

    row = _brief_row(db, merchant_id)
    assert row is not None
    assert row["evidence_set_hash"] == evidence_set_hash(pkg)
    assert json.loads(row["payload_json"]) == draft
    assert row["model"] == "google-antigravity/gemini-3.7-flash"
    assert row["reviewed_at"] is not None

    # both calls used the seam: one analyst draft + one verifier review
    assert len(client.calls) == 2
    assert client.calls[0].role == "analyst"
    assert client.calls[1].role == "verifier"
    # the prompt contained only package data, in Arabic-targeting form
    assert "merchant_id=" in client.calls[0].prompt

    # second apply: skipped as fresh, no new model calls
    result2 = asyncio.run(
        generate_briefs(db, [merchant_id], apply=True, dry_run=False, cfg=cfg, client=client)
    )
    assert [o["status"] for o in result2["outcomes"]] == ["fresh"]
    assert len(client.calls) == 2  # unchanged
    db.close()


def test_generate_briefs_dry_run_writes_nothing(tmp_path):
    cfg = _config(tmp_path)
    db = Database(cfg.resolve(cfg.database_path))
    merchant_id = _rich_merchant(db)
    pkg = build_presentation_package(db, merchant_id)
    client = FakeOmpClient(
        analyst_payloads=[_valid_payload(pkg)],
        verifier_payloads=[{"ok": True, "issues": []}],
    )

    result = asyncio.run(
        generate_briefs(db, [merchant_id], apply=True, dry_run=True, cfg=cfg, client=client)
    )
    assert _brief_row(db, merchant_id) is None
    status = result["outcomes"][0]["status"]
    assert status == "skipped"
    assert "dry run" in result["outcomes"][0]["reason"]

    # dry_run=False without apply also writes nothing
    client2 = FakeOmpClient(
        analyst_payloads=[_valid_payload(pkg)],
        verifier_payloads=[{"ok": True, "issues": []}],
    )
    asyncio.run(generate_briefs(db, [merchant_id], apply=False, dry_run=False, cfg=cfg, client=client2))
    assert _brief_row(db, merchant_id) is None
    db.close()


def test_generate_briefs_rejected_brief_is_not_written(tmp_path):
    cfg = _config(tmp_path)
    db = Database(cfg.resolve(cfg.database_path))
    merchant_id = _rich_merchant(db)
    pkg = build_presentation_package(db, merchant_id)

    # deterministic validator catches the fabricated id before the reviewer
    bad_payload = _valid_payload(pkg)
    bad_payload["identity_message"]["evidence_ids"] = ["ev-fabricated"]
    client = FakeOmpClient(
        analyst_payloads=[bad_payload],
        verifier_payloads=[{"ok": True, "issues": []}],
    )
    result = asyncio.run(
        generate_briefs(db, [merchant_id], apply=True, dry_run=False, cfg=cfg, client=client)
    )
    assert result["outcomes"][0]["status"] == "rejected"
    assert any("ev-fabricated" in v for v in result["outcomes"][0]["violations"])
    assert _brief_row(db, merchant_id) is None
    # reviewer was never called — the deterministic gate failed first
    assert len(client.calls) == 1

    # reviewer says not ok -> also not written
    client2 = FakeOmpClient(
        analyst_payloads=[_valid_payload(pkg)],
        verifier_payloads=[{"ok": False, "issues": ["citation coverage gap"]}],
    )
    result2 = asyncio.run(
        generate_briefs(db, [merchant_id], apply=True, dry_run=False, cfg=cfg, client=client2)
    )
    assert result2["outcomes"][0]["status"] == "rejected"
    assert "citation coverage gap" in result2["outcomes"][0]["violations"]
    assert _brief_row(db, merchant_id) is None
    # merchant stays stale (pending), resumable
    assert stale_brief_merchant_ids(db) == [merchant_id]
    db.close()


def test_generate_briefs_skips_unknown_and_fresh_and_is_bounded(tmp_path):
    cfg = _config(tmp_path)
    db = Database(cfg.resolve(cfg.database_path))
    known = _rich_merchant(db)
    stranger = str(uuid.uuid4())

    # unknown merchant is skipped without any model call
    client = FakeOmpClient()
    result = asyncio.run(
        generate_briefs(db, [stranger], apply=True, dry_run=False, cfg=cfg, client=client)
    )
    assert result["outcomes"][0]["status"] == "skipped"
    assert len(client.calls) == 0

    # pre-seed a fresh brief for `known`; bounded request touches nothing else
    pkg = build_presentation_package(db, known)
    upsert_brief(
        db, known, evidence_set_hash(pkg), _valid_payload(pkg), "m",
        "2026-06-01T00:00:00+00:00",
    )
    client2 = FakeOmpClient()
    result2 = asyncio.run(
        generate_briefs(db, [known, stranger], apply=True, dry_run=False, cfg=cfg, client=client2)
    )
    statuses = {o["merchant_id"]: o["status"] for o in result2["outcomes"]}
    assert statuses[known] == "fresh"
    assert statuses[stranger] == "skipped"
    assert len(client2.calls) == 0

    # never mutates sources/evidence/claims
    assert db.query_one("SELECT COUNT(*) AS n FROM sources")["n"] == 3
    assert db.query_one("SELECT COUNT(*) AS n FROM evidence")["n"] == 5
    assert db.query_one("SELECT COUNT(*) AS n FROM claims")["n"] == 1
    db.close()


def test_generate_briefs_unavailable_pinned_model_fails_closed(tmp_path):
    cfg = _config(tmp_path)
    db = Database(cfg.resolve(cfg.database_path))
    merchant_id = _rich_merchant(db)
    client = FakeOmpClient(catalog=["google-antigravity/gemini-3.7-flash"])
    with pytest.raises(RuntimeError, match="unavailable"):
        asyncio.run(
            generate_briefs(db, [merchant_id], apply=True, dry_run=False, cfg=cfg, client=client)
        )
    assert _brief_row(db, merchant_id) is None
    db.close()
