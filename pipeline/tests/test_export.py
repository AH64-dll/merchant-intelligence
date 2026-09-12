"""Export contract tests: sanitization, CSV injection safety, atomicity.

The sanitized export is the artifact reviewers open outside the pipeline, so it
must not leak raw model output, must not hand a spreadsheet a live formula, and
must never publish a half-written file at the public name.
"""

from __future__ import annotations

import csv
import json

from merchant_intel.database import Database
from merchant_intel.export import export_dataset


def _seed(tmp_path) -> Database:
    db = Database(tmp_path / "mi.db")
    db.execute(
        """INSERT INTO merchants
               (id,canonical_name,normalized_name,category,city,governorate,
                identity_confidence,state,first_seen_round,created_at,updated_at)
           VALUES ('m1','Acme','acme','retail','Cairo','Cairo',0.9,
                   'VERIFIED_MODERATE_CONFIDENCE',1,'2026-01-01T00:00:00+00:00',
                   '2026-01-01T00:00:00+00:00')"""
    )
    db.execute(
        """INSERT INTO sources
               (url,canonical_url,platform,source_type,first_seen_at,last_seen_at)
           VALUES ('https://acme.test','https://acme.test','web','news',
                   '2026-01-01T00:00:00+00:00','2026-01-01T00:00:00+00:00')"""
    )
    db.upsert_run("run", "complete", "analysis", 0, 1, {})
    db.execute(
        """INSERT INTO merchant_analyses(run_id,merchant_id,round_no,payload_json,created_at)
           VALUES ('run','m1',1,?,'2026-01-01T00:00:00+00:00')""",
        (
            json.dumps(
                {
                    "payload_version": 1,
                    "internal_state": "HIGH_RISK_SIGNALS",
                    "risk_signals": ["INTERNAL_RISK_MARKER"],
                    "notes": "INTERNAL_NOTE_MARKER",
                }
            ),
        ),
    )
    db.execute(
        """INSERT INTO verification_tasks
               (id,run_id,merchant_id,title,instruction,claim_ids_json,result_json,
                created_at,updated_at)
           VALUES ('task','run','m1','check','instruction','[]',?,
                   '2026-01-01T00:00:00+00:00','2026-01-01T00:00:00+00:00')""",
        (json.dumps({"verdict": "INTERNAL_RESULT_MARKER"}),),
    )
    return db


def _evidence(db: Database, evidence_id: str, summary: str) -> None:
    source = db.query_one("SELECT id FROM sources")["id"]
    claim_id = f"c-{evidence_id}"
    db.execute(
        """INSERT INTO claims
               (id,merchant_id,claim_type,sentiment,summary,normalized_text,
                fingerprint,independent_source_count,mention_count,created_at,updated_at)
           VALUES (?, 'm1','other','neutral',?,?,?,1,1,
                   '2026-01-01T00:00:00+00:00','2026-01-01T00:00:00+00:00')""",
        (claim_id, summary, summary, f"claim-fp-{evidence_id}"),
    )
    db.execute(
        """INSERT INTO evidence
               (id,merchant_id,source_id,claim_id,claim_type,sentiment,summary,
                quoted_excerpt,author_type,transaction_evidence,confidence,
                reliability_band,language,published_at,captured_at,fingerprint,
                content_fingerprint,independent,duplicate_of,round_no,verified,raw_json)
           VALUES (?, 'm1', ?, ?, 'other','neutral',?, 'quote','customer',1,0.5,
                   'weak','en','2026-01-01T00:00:00+00:00',
                   '2026-01-02T00:00:00+00:00',?,?,1,NULL,1,1,'{"internal":"raw"}')""",
        (
            evidence_id,
            source,
            claim_id,
            summary,
            f"fp-{evidence_id}",
            f"cfp-{evidence_id}",
        ),
    )


def test_sanitized_json_export_omits_internal_model_json(tmp_path):
    db = _seed(tmp_path)
    _evidence(db, "e1", "A public purchase report.")

    path = export_dataset(db, tmp_path / "out", "json")
    text = path.read_text(encoding="utf-8")

    # Neither the raw column names nor the model-authored contents survive.
    for token in (
        "raw_json",
        "quoted_excerpt",
        "payload_json",
        "result_json",
        "INTERNAL_RISK_MARKER",
        "INTERNAL_NOTE_MARKER",
        "INTERNAL_RESULT_MARKER",
    ):
        assert token not in text, token
    # The provenance that reviewers need is still present.
    assert "https://acme.test" in text
    assert "A public purchase report." in text
    db.close()


def test_include_raw_keeps_internal_model_json(tmp_path):
    db = _seed(tmp_path)
    _evidence(db, "e1", "A public purchase report.")

    path = export_dataset(db, tmp_path / "out", "json", sanitized=False)
    text = path.read_text(encoding="utf-8")

    assert "payload_json" in text
    assert "result_json" in text
    assert "raw_json" in text
    assert "INTERNAL_RESULT_MARKER" in text
    db.close()


def test_csv_export_neutralises_formula_cells(tmp_path):
    db = _seed(tmp_path)
    _evidence(db, "e1", '=HYPERLINK("http://evil.test","click me")')
    _evidence(db, "e2", "@SUM(1+1)")
    _evidence(db, "e3", "+cmd|'/c calc'!A0")
    _evidence(db, "e4", "-5 stars, would not buy again")
    _evidence(db, "e5", "an ordinary summary")

    path = export_dataset(db, tmp_path / "out", "csv")
    with path.open(newline="", encoding="utf-8") as handle:
        rows = {row["id"]: row for row in csv.DictReader(handle)}

    assert rows["e1"]["summary"].startswith("'=")
    assert rows["e2"]["summary"].startswith("'@")
    assert rows["e3"]["summary"].startswith("'+")
    assert rows["e4"]["summary"].startswith("'-")
    assert rows["e5"]["summary"] == "an ordinary summary"
    db.close()


def test_csv_export_is_atomic_and_byte_stable(tmp_path):
    db = _seed(tmp_path)
    _evidence(db, "e2", "second")
    _evidence(db, "e1", "first")
    out = tmp_path / "out"

    first = export_dataset(db, out, "csv")
    first_bytes = first.read_bytes()
    # The temp sibling is renamed away, never left behind.
    assert not (out / "evidence.csv.tmp").exists()

    # A stale file at the public name is replaced, not appended to.
    first.write_bytes(b"STALE\n")
    second = export_dataset(db, out, "csv")
    assert second.read_bytes() == first_bytes

    # Re-exporting an unchanged database is byte-for-byte identical.
    third = export_dataset(db, out, "csv")
    assert third.read_bytes() == first_bytes
    db.close()


def test_jsonl_export_is_atomic_and_byte_stable(tmp_path):
    db = _seed(tmp_path)
    _evidence(db, "e2", "second")
    _evidence(db, "e1", "first")
    out = tmp_path / "out"

    first = export_dataset(db, out, "jsonl")
    first_bytes = first.read_bytes()
    assert not (out / "evidence.jsonl.tmp").exists()
    assert export_dataset(db, out, "jsonl").read_bytes() == first_bytes
    db.close()
