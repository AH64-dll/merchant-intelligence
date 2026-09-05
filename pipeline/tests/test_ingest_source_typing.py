"""Ingestion-side source typing and source-only evidence contracts.

Covers two deterministic behaviours:

* a worker that returns no usable summary or quote yields a source-only
  :class:`EvidenceItem` with an empty summary — never a fabricated sentence;
* ``_upsert_source`` persists the v4 presentation columns derived from the raw
  locator, and a later upsert of the same canonical URL never overwrites an
  existing classification.

Fixtures for the non-web locators are the real values found in
``data/merchant_intelligence.db`` (sources.id 1442/1559/1081 ...).
"""

from __future__ import annotations

import json

from merchant_intel.database import Database
from merchant_intel.ingest import _upsert_source
from merchant_intel.schemas import EvidenceItem
from merchant_intel.sources import PLACEHOLDER_SUMMARY

# Real locators from the master dataset (verbatim).
CLEAN_URL = "https://www.cairo24.com/1982600"
ANNOTATED_URL = (
    "https://cpa.gov.eg/ar-eg/قضايا-وأحكام/PgrID/628/PageID/1 … "
    "PageID/7 (plus CategoryID/20 view)"
)
ANNOTATED_WEB_URL = "https://cpa.gov.eg/ar-eg/قضايا-وأحكام/PgrID/628/PageID/1"
ANNOTATED_NOTE = "… PageID/7 (plus CategoryID/20 view)"
WHOIS_URL = "whois://fitandfix.com (Verisign registry output)"
WHOIS_NOTE = "fitandfix.com (Verisign registry output)"


def _dump(item: EvidenceItem) -> str:
    return json.dumps(item.model_dump(), default=str, ensure_ascii=False)


def _evidence(**overrides: object) -> EvidenceItem:
    payload: dict[str, object] = {
        "source_url": CLEAN_URL,
        "source_platform": "web",
        "source_type": "news_article",
    }
    payload.update(overrides)
    return EvidenceItem.model_validate(payload)


def test_missing_summary_and_quote_are_source_only() -> None:
    item = _evidence()

    assert item.source_only is True
    assert item.summary == ""
    assert item.raw_quote == ""
    assert PLACEHOLDER_SUMMARY not in _dump(item)


def test_legacy_placeholder_summary_becomes_source_only() -> None:
    item = _evidence(summary=PLACEHOLDER_SUMMARY)

    assert item.source_only is True
    assert item.summary == ""
    assert PLACEHOLDER_SUMMARY not in _dump(item)


def test_blank_only_summary_is_source_only() -> None:
    item = _evidence(summary="   ", description="  ")

    assert item.source_only is True
    assert item.summary == ""


def test_real_summary_is_not_source_only() -> None:
    summary = "Cairo Economic Court issued a bankruptcy ruling against the seller."
    item = _evidence(summary=summary)

    assert item.source_only is False
    assert item.summary == summary


def test_quote_without_summary_is_not_source_only() -> None:
    item = _evidence(raw_quote="تم التأكد من وجود فرع في مدينة نصر")

    assert item.source_only is False
    assert item.summary == ""
    assert item.raw_quote


def test_supporting_artifacts_split_keeps_every_value() -> None:
    item = _evidence(
        summary="Registration certificate and a page reference.",
        supporting_artifacts=["https://ok.test/x", "javascript:bad", "شهادة تسجيل"],
    )

    assert item.supporting_urls == ["https://ok.test/x"]
    assert item.supporting_notes == ["javascript:bad", "شهادة تسجيل"]
    assert len(item.supporting_urls) + len(item.supporting_notes) == len(
        item.supporting_artifacts
    )
    # The raw list is the audit record and must stay untouched.
    assert item.supporting_artifacts == [
        "https://ok.test/x",
        "javascript:bad",
        "شهادة تسجيل",
    ]


def test_source_metadata_defaults_and_coercion() -> None:
    item = _evidence(summary="ok", source_label=None, source_note=42)

    assert item.source_label == ""
    assert item.source_note == "42"


def _source_row(db: Database, source_id: int) -> dict[str, object]:
    row = db.query_one("SELECT * FROM sources WHERE id=?", (source_id,))
    assert row is not None
    return dict(row)


def test_upsert_source_writes_presentation_columns(tmp_path) -> None:
    db = Database(tmp_path / "typing.db")
    try:
        clean_id = _upsert_source(db, _evidence(summary="clean", source_url=CLEAN_URL))
        clean = _source_row(db, clean_id)
        assert clean["web_url"] == CLEAN_URL
        assert clean["access_kind"] == "web"
        assert clean["locator_note"] == ""
        assert clean["source_label"] == ""

        annotated_id = _upsert_source(
            db,
            _evidence(
                summary="annotated",
                source_url=ANNOTATED_URL,
                source_label="CPA cases",
            ),
        )
        annotated = _source_row(db, annotated_id)
        assert annotated["web_url"] == ANNOTATED_WEB_URL
        assert annotated["access_kind"] == "web"
        assert annotated["locator_note"] == ANNOTATED_NOTE
        assert annotated["source_label"] == "CPA cases"
        # The historical locator is preserved verbatim.
        assert annotated["url"] == ANNOTATED_URL

        whois_id = _upsert_source(
            db, _evidence(summary="whois", source_url=WHOIS_URL)
        )
        whois = _source_row(db, whois_id)
        assert whois["web_url"] is None
        assert whois["access_kind"] == "whois"
        assert whois["locator_note"] == WHOIS_NOTE
        assert whois["url"] == WHOIS_URL
    finally:
        db.close()


def test_upsert_source_backfills_and_never_overwrites(tmp_path) -> None:
    db = Database(tmp_path / "typing.db")
    try:
        source_id = _upsert_source(
            db,
            _evidence(
                summary="first",
                source_url=ANNOTATED_URL,
                source_label="first label",
                source_note="first note",
            ),
        )
        first = _source_row(db, source_id)
        assert first["locator_note"] == "first note"

        # Same canonical_url: the row is reused, not re-inserted.
        again_id = _upsert_source(
            db,
            _evidence(
                summary="second",
                source_url=ANNOTATED_URL,
                source_label="ignored label",
                source_note="ignored note",
            ),
        )
        assert again_id == source_id
        second = _source_row(db, source_id)
        assert second["web_url"] == first["web_url"]
        assert second["access_kind"] == first["access_kind"]
        assert second["locator_note"] == "first note"
        assert second["source_label"] == "first label"

        # A row classified before the column existed is backfilled once.
        db.execute(
            "UPDATE sources SET web_url=NULL, source_label='', locator_note='', "
            "access_kind='' WHERE id=?",
            (source_id,),
        )
        _upsert_source(db, _evidence(summary="third", source_url=ANNOTATED_URL))
        backfilled = _source_row(db, source_id)
        assert backfilled["web_url"] == ANNOTATED_WEB_URL
        assert backfilled["access_kind"] == "web"
        assert backfilled["locator_note"] == ANNOTATED_NOTE
        assert backfilled["source_label"] == ""
    finally:
        db.close()
