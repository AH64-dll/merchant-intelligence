import asyncio
import copy
import json
import uuid
from pathlib import Path

import pytest

from merchant_intel.cli import build_parser
from merchant_intel.config import load_config
from merchant_intel.database import Database
from merchant_intel.ingest import ingest_evidence, ingest_sol, resolve_merchant
from merchant_intel.omp.mock import MockOmpClient
from merchant_intel.reanalysis import (
    TARGETED_REANALYSIS_MODEL,
    ReanalysisError,
    reanalyze_merchants,
)
from merchant_intel.schemas import EvidenceItem, MerchantCandidate, SolRoundOutput


class PayloadMockOmpClient(MockOmpClient):
    def __init__(self, payload, *, result_model=None):
        super().__init__()
        self.payload = payload
        self.result_model = result_model

    async def run(self, request):
        result = await super().run(request)
        result.payload = copy.deepcopy(self.payload)
        result.text = json.dumps(result.payload)
        result.stdout = result.text
        if self.result_model is not None:
            result.model = self.result_model
        return result


class SequencePayloadMockOmpClient(MockOmpClient):
    def __init__(self, payloads):
        super().__init__()
        self.payloads = list(payloads)

    async def run(self, request):
        index = len(self.calls)
        result = await super().run(request)
        result.payload = copy.deepcopy(self.payloads[index])
        result.text = json.dumps(result.payload)
        result.stdout = result.text
        return result


def _config(tmp_path: Path):
    cfg = load_config(smoke=True)
    cfg.root = tmp_path
    cfg.database_path = "mi.db"
    cfg.export_dir = "export"
    cfg.log_dir = "logs"
    return cfg


def _merchant(db: Database, name: str = "Example Store") -> str:
    merchant_id = resolve_merchant(
        db,
        MerchantCandidate(
            canonical_name=name,
            category="electronics",
            city="Cairo",
            governorate="Cairo",
            identifiers={"websites": [f"https://{name.lower().replace(' ', '-')}.test"]},
        ),
        1,
    )
    db.execute(
        "UPDATE merchants SET identity_confidence=0.93 WHERE id=?",
        (merchant_id,),
    )
    return merchant_id


def _analysis(merchant_id: str, *, with_task: bool = True) -> dict:
    return {
        "merchant_id": merchant_id,
        "merchant_name": "Example Store",
        "identity_confidence": 0.01,
        "evidence_summary": {"total_items": 25},
        "source_diversity": 0.8,
        "verified_claims": ["official identity present"],
        "unverified_claims": [],
        "contradictions": [],
        "risk_signals": [],
        "positive_signals": ["documented purchase"],
        "missing_information": [],
        "requires_more_research": True,
        "verification_tasks": (
            [
                {
                    "task_id": f"task-{merchant_id}",
                    "merchant_id": merchant_id,
                    "title": "Model-created task that must be stripped",
                    "instruction": "Look for another source.",
                }
            ]
            if with_task
            else []
        ),
        "internal_state": "VERIFIED_HIGH_CONFIDENCE",
        "evidence_confidence": 0.8,
        "reputation_notes": "documented evidence",
        "fraud_risk_notes": "no recorded warning",
        "consumer_satisfaction_notes": "positive report",
    }


def _payload(*merchant_ids: str) -> dict:
    return {
        "merchants": [_analysis(merchant_id) for merchant_id in merchant_ids],
        "dataset_notes": "targeted batch",
        "remaining_critical_uncertainties": 0,
    }


def test_targeted_batch_is_pinned_bounded_curated_and_newest(tmp_path):
    cfg = _config(tmp_path)
    db = Database(tmp_path / "mi.db")
    merchant_id = _merchant(db)

    for index in range(25):
        ingest_evidence(
            db,
            merchant_id,
            EvidenceItem(
                source_url=f"https://evidence.test/{index}",
                source_platform="web",
                source_type="review",
                claim_type="successful_purchase",
                summary=f"Distinct documented purchase number {index} with invoice details.",
                sentiment="positive",
                confidence=0.7,
            ),
            agent_run_id="seed",
            round_no=1,
        )

    db.upsert_run("older-run", "complete", "analysis", 0, 7, {})
    ingest_sol(
        db,
        "older-run",
        SolRoundOutput.model_validate(
            {
                "merchants": [_analysis(merchant_id, with_task=False)],
                "dataset_notes": "older analysis",
                "remaining_critical_uncertainties": 0,
            }
        ),
        7,
        allowed_merchant_ids={merchant_id},
    )
    db.execute(
        "UPDATE merchants SET identity_confidence=0.93 WHERE id=?",
        (merchant_id,),
    )

    client = PayloadMockOmpClient(_payload(merchant_id))
    result = asyncio.run(reanalyze_merchants(cfg, client, db, [merchant_id]))

    assert len(client.calls) == 1
    call = client.calls[0]
    assert call.model == TARGETED_REANALYSIS_MODEL
    assert call.role == "analyst"
    assert call.timeout_sec == cfg.omp.analysis_timeout_sec
    assert call.prompt.count("source=https://evidence.test/") == 20
    assert "source=https://evidence.test/24" in call.prompt
    assert "source=https://evidence.test/0 " not in call.prompt

    assert result.round_no == 8
    assert result.merchant_ids == (merchant_id,)
    assert result.analyses_persisted == 1
    latest = db.query_one(
        "SELECT round_no, payload_json FROM merchant_analyses "
        "WHERE merchant_id=? ORDER BY round_no DESC, id DESC LIMIT 1",
        (merchant_id,),
    )
    assert latest["round_no"] == 8
    payload = json.loads(latest["payload_json"])
    assert payload["identity_confidence"] == pytest.approx(0.93)
    assert payload["verification_tasks"] == []
    assert db.query_one(
        "SELECT identity_confidence, state FROM merchants WHERE id=?", (merchant_id,)
    )["identity_confidence"] == pytest.approx(0.93)
    assert db.query_one("SELECT COUNT(*) AS n FROM verification_tasks")["n"] == 0
    db.close()


@pytest.mark.parametrize("boundary", ["pending", "duplicate", "omitted", "outside", "name"])
def test_invalid_output_boundaries_write_nothing(tmp_path, boundary):
    cfg = _config(tmp_path)
    db = Database(tmp_path / "mi.db")
    merchant_id = _merchant(db)
    outside_id = str(uuid.uuid4())
    analyses = {
        "pending": [_analysis("pending")],
        "duplicate": [_analysis(merchant_id), _analysis(merchant_id)],
        "omitted": [],
        "outside": [_analysis(outside_id)],
        "name": [_analysis("Example Store")],
    }[boundary]
    client = PayloadMockOmpClient({"merchants": analyses})

    with pytest.raises(ReanalysisError):
        asyncio.run(reanalyze_merchants(cfg, client, db, [merchant_id]))

    assert db.query_one("SELECT COUNT(*) AS n FROM merchant_analyses")["n"] == 0
    assert db.query_one("SELECT COUNT(*) AS n FROM pipeline_runs")["n"] == 0
    merchant = db.query_one(
        "SELECT identity_confidence, state FROM merchants WHERE id=?", (merchant_id,)
    )
    assert merchant["identity_confidence"] == pytest.approx(0.93)
    assert merchant["state"] == "INSUFFICIENT_DATA"
    db.close()


def test_late_batch_failure_does_not_persist_an_earlier_valid_batch(tmp_path):
    cfg = _config(tmp_path)
    cfg.research.analysis_batch_size = 1
    db = Database(tmp_path / "mi.db")
    first_id = _merchant(db, "First Store")
    second_id = _merchant(db, "Second Store")
    client = SequencePayloadMockOmpClient([_payload(first_id), {"merchants": []}])

    with pytest.raises(ReanalysisError, match="omitted"):
        asyncio.run(reanalyze_merchants(cfg, client, db, [first_id, second_id]))

    assert len(client.calls) == 2
    assert all(call.model == TARGETED_REANALYSIS_MODEL for call in client.calls)
    assert db.query_one("SELECT COUNT(*) AS n FROM merchant_analyses")["n"] == 0
    assert db.query_one("SELECT COUNT(*) AS n FROM pipeline_runs")["n"] == 0
    db.close()


def test_model_fallback_result_fails_closed_without_writes(tmp_path):
    cfg = _config(tmp_path)
    db = Database(tmp_path / "mi.db")
    merchant_id = _merchant(db)
    client = PayloadMockOmpClient(
        _payload(merchant_id), result_model="openai-codex/gpt-5.6-luna"
    )

    with pytest.raises(ReanalysisError, match="refusing fallback"):
        asyncio.run(reanalyze_merchants(cfg, client, db, [merchant_id]))

    assert client.calls[0].model == TARGETED_REANALYSIS_MODEL
    assert db.query_one("SELECT COUNT(*) AS n FROM merchant_analyses")["n"] == 0
    assert db.query_one("SELECT COUNT(*) AS n FROM pipeline_runs")["n"] == 0
    db.close()


@pytest.mark.parametrize("requested", [["Example Store"], [str(uuid.uuid4())]])
def test_requests_must_be_existing_uuids_before_launch(tmp_path, requested):
    cfg = _config(tmp_path)
    db = Database(tmp_path / "mi.db")
    _merchant(db)
    client = PayloadMockOmpClient({"merchants": []})

    with pytest.raises(ReanalysisError):
        asyncio.run(reanalyze_merchants(cfg, client, db, requested))

    assert client.calls == []
    db.close()

def test_isolation_of_unrequested_merchants(tmp_path):
    cfg = _config(tmp_path)
    db = Database(tmp_path / "mi.db")
    first_id = _merchant(db, "First Store")
    second_id = _merchant(db, "Second Store")
    db.execute(
        "UPDATE merchants SET identity_confidence=0.42, state='MIXED_REPUTATION' WHERE id=?",
        (second_id,),
    )
    db.upsert_run("other-run", "complete", "analysis", 0, 3, {})
    ingest_sol(
        db,
        "other-run",
        SolRoundOutput.model_validate(
            {
                "merchants": [_analysis(second_id, with_task=False)],
                "dataset_notes": "pre-existing analysis",
                "remaining_critical_uncertainties": 0,
            }
        ),
        3,
    )
    before = db.query_one(
        "SELECT identity_confidence, state, updated_at FROM merchants WHERE id=?",
        (second_id,),
    )
    analyses_before = db.query_one(
        "SELECT COUNT(*) AS n FROM merchant_analyses WHERE merchant_id=?",
        (second_id,),
    )["n"]

    client = PayloadMockOmpClient(_payload(first_id))
    asyncio.run(reanalyze_merchants(cfg, client, db, [first_id]))

    after = db.query_one(
        "SELECT identity_confidence, state, updated_at FROM merchants WHERE id=?",
        (second_id,),
    )
    analyses_after = db.query_one(
        "SELECT COUNT(*) AS n FROM merchant_analyses WHERE merchant_id=?",
        (second_id,),
    )["n"]
    assert analyses_after == analyses_before
    assert dict(before) == dict(after)
    db.close()


def test_multi_batch_success_persists_the_validated_union(tmp_path):
    cfg = _config(tmp_path)
    cfg.research.analysis_batch_size = 1
    db = Database(tmp_path / "mi.db")
    first_id = _merchant(db, "First Store")
    second_id = _merchant(db, "Second Store")
    client = SequencePayloadMockOmpClient([_payload(first_id), _payload(second_id)])

    result = asyncio.run(reanalyze_merchants(cfg, client, db, [first_id, second_id]))

    assert len(client.calls) == 2
    assert result.analyses_persisted == 2
    assert db.query_one(
        "SELECT COUNT(*) AS n FROM merchant_analyses WHERE run_id=?",
        (result.run_id,),
    )["n"] == 2
    for merchant_id in (first_id, second_id):
        assert db.query_one(
            "SELECT COUNT(*) AS n FROM merchant_analyses WHERE merchant_id=?",
            (merchant_id,),
        )["n"] == 1
    db.close()


def test_catalog_without_pinned_model_fails_closed_before_any_call(tmp_path):
    cfg = _config(tmp_path)
    db = Database(tmp_path / "mi.db")
    merchant_id = _merchant(db)
    client = PayloadMockOmpClient(_payload(merchant_id))
    client.catalog = ["some-other-provider/some-model"]

    with pytest.raises(ReanalysisError, match="unavailable"):
        asyncio.run(reanalyze_merchants(cfg, client, db, [merchant_id]))

    assert client.calls == []
    assert db.query_one("SELECT COUNT(*) AS n FROM merchant_analyses")["n"] == 0
    db.close()


def test_wrong_name_on_correct_uuid_attaches_by_id_only(tmp_path):
    cfg = _config(tmp_path)
    db = Database(tmp_path / "mi.db")
    first_id = _merchant(db, "First Store")
    second_id = _merchant(db, "Second Store")
    analysis = _analysis(first_id, with_task=False)
    analysis["merchant_name"] = "Second Store"
    client = PayloadMockOmpClient({"merchants": [analysis]})

    result = asyncio.run(reanalyze_merchants(cfg, client, db, [first_id, second_id][:1]))

    assert result.analyses_persisted == 1
    row = db.query_one(
        "SELECT merchant_id FROM merchant_analyses WHERE run_id=?",
        (result.run_id,),
    )
    assert row["merchant_id"] == first_id
    assert db.query_one(
        "SELECT COUNT(*) AS n FROM merchant_analyses WHERE merchant_id=?",
        (second_id,),
    )["n"] == 0
    db.close()


def test_cli_exposes_explicit_uuid_list():
    first = str(uuid.uuid4())
    second = str(uuid.uuid4())
    args = build_parser().parse_args(["reanalyze-merchants", first, second])
    assert args.cmd == "reanalyze-merchants"
    assert args.merchant_ids == [first, second]
