import asyncio
from pathlib import Path

from merchant_intel.assignments import default_assignments
from merchant_intel.config import load_config
from merchant_intel.database import Database
from merchant_intel.export import export_dataset
from merchant_intel.ingest import ingest_evidence, ingest_luna, resolve_merchant
from merchant_intel.omp.client import AgentRequest, OmpClient
from merchant_intel.omp.mock import MockOmpClient
from merchant_intel.pipeline import Pipeline
from merchant_intel.schemas import EvidenceItem, LunaAgentOutput, LunaFinding, MerchantCandidate, SolRoundOutput


def _candidate(name: str = "Example Store") -> MerchantCandidate:
    return MerchantCandidate(
        canonical_name=name,
        category="electronics",
        city="Cairo",
        identifiers={"websites": ["https://example.test"]},
    )


def _evidence(url: str, summary: str) -> EvidenceItem:
    return EvidenceItem(
        source_url=url,
        source_platform="web",
        source_type="review",
        claim_type="successful_purchase",
        summary=summary,
        sentiment="positive",
        confidence=0.7,
    )


def test_reposts_are_retained_but_not_counted_as_independent(tmp_path):
    db = Database(tmp_path / "mi.db")
    merchant_id = resolve_merchant(db, _candidate(), 1)
    first, first_independent = ingest_evidence(
        db, merchant_id, _evidence("https://one.test/post", "Bought a laptop and received a receipt."),
        agent_run_id="a1", round_no=1,
    )
    second, second_independent = ingest_evidence(
        db, merchant_id, _evidence("https://two.test/repost", "Bought a laptop and received a receipt."),
        agent_run_id="a2", round_no=1,
    )
    assert first != second
    assert first_independent is True
    assert second_independent is False
    rows = db.query("SELECT id, independent, duplicate_of FROM evidence ORDER BY rowid")
    assert [row["independent"] for row in rows] == [1, 0]
    assert rows[1]["duplicate_of"] == rows[0]["id"]
    db.close()


def test_twenty_assignments_cover_all_research_groups():
    cfg = load_config(smoke=False)
    assignments = default_assignments(cfg, 20)
    assert len(assignments) == 20
    assert {item.group for item in assignments} == set("ABCDEFGH")


def test_live_argv_uses_v17_flags_and_real_resume(tmp_path):
    cfg = load_config(smoke=True)
    cfg.root = Path(tmp_path)
    mock = MockOmpClient()
    client = OmpClient(cfg, caps=mock.caps)
    first = client.build_argv(
        AgentRequest(
            prompt="{}", model="google-antigravity/gemini-3.7-flash",
            name="worker", role="discovery", workspace_id="worker",
        ), mock.caps,
    )
    assert "--mode" in first and "json" in first
    assert "--name" not in first
    assert "--fork" not in first
    resumed = client.build_argv(
        AgentRequest(
            prompt="{}", model="google-antigravity/gemini-3.7-flash",
            name="worker", role="analyst", session_id="session-1", resume=True,
            workspace_id="worker",
        ), mock.caps,
    )
    assert "--resume" in resumed and "session-1" in resumed


def test_rich_sol_payload_is_coerced_without_losing_tasks():
    output = SolRoundOutput.model_validate(
        {
            "merchants": [
                {
                    "name": "Example Store",
                    "identity_confidence": {"score": 0.8},
                    "evidence_summary": "two reports",
                    "source_diversity": {"source_count": 2},
                    "verified_claims": [{"claim": "business page exists"}],
                    "verification_tasks": [{"question": "Confirm phone ownership", "query": "find phone"}],
                    "internal_state": "mixed",
                }
            ]
        }
    )
    merchant = output.merchants[0]
    assert merchant.merchant_name == "Example Store"
    assert merchant.source_diversity > 0
    assert merchant.verification_tasks[0].instruction == "find phone"


def test_checkpoint_resume_preserves_round_boundary(tmp_path):
    cfg = load_config(smoke=True)
    cfg.root = Path(tmp_path)
    cfg.database_path = str(tmp_path / "mi.db")
    cfg.export_dir = str(tmp_path / "export")
    db = Database(cfg.database_path)
    client = MockOmpClient()
    first = Pipeline(cfg, client, db)
    first.state.discovery_round = 1
    first.state.discovery_round_status = "agents"
    first.state.stage = "discovery"
    first._save()
    second = Pipeline(cfg, client, db)
    second.resume(first.state.run_id)
    assert second.state.discovery_round == 1
    assert second.state.discovery_round_status == "agents"
    assert second.state.stage == "discovery"
    db.close()


def test_incomplete_checkpoint_resumes_from_unfinished_analysis(tmp_path):
    cfg = load_config(smoke=True)
    cfg.root = Path(tmp_path)
    cfg.database_path = str(tmp_path / "mi.db")
    cfg.export_dir = str(tmp_path / "export")
    db = Database(cfg.database_path)
    client = MockOmpClient()
    first = Pipeline(cfg, client, db)
    first.state.discovery_round = 8
    first.state.discovery_round_status = "idle"
    first.state.stage = "incomplete"
    first.state.analysis_complete = False
    first.state.stop_reason = "Sol provider unavailable"
    first._save()
    second = Pipeline(cfg, client, db)
    second.resume(first.state.run_id)
    assert second.state.stage == "analysis"
    assert second.state.stop_reason == ""
    db.close()


def test_sanitized_export_keeps_url_and_omits_internal_raw(tmp_path):
    db = Database(tmp_path / "mi.db")
    merchant_id = resolve_merchant(db, _candidate(), 1)
    ingest_evidence(
        db, merchant_id, _evidence("https://one.test/post", "A public purchase report."),
        agent_run_id="a1", round_no=1,
    )
    path = export_dataset(db, tmp_path / "export", "json")
    text = path.read_text(encoding="utf-8")
    assert "https://one.test/post" in text
    assert '"raw_json"' not in text
    db.close()


def test_luna_without_provenance_stays_unresolved(tmp_path):
    db = Database(tmp_path / "mi.db")
    merchant_id = resolve_merchant(db, _candidate(), 1)
    db.upsert_run("run-1", "running", "verification", 1, 1, {})
    db.execute(
        """INSERT INTO verification_tasks
           (id, run_id, merchant_id, title, instruction, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("task-1", "run-1", merchant_id, "Check source", "Find a source", "now", "now"),
    )
    ingest_luna(
        db,
        LunaAgentOutput(
            agent_id="luna-1",
            findings=[
                LunaFinding(
                    task_id="task-1",
                    merchant_id=merchant_id,
                    supported=True,
                    still_unresolved=False,
                    summary="The worker supplied no citable source.",
                    evidence=[],
                )
            ],
        ),
        agent_run_id="run-1:luna-1",
        round_no=1,
    )
    row = db.query_one("SELECT status FROM verification_tasks WHERE id='task-1'")
    assert row and row["status"] == "unresolved"
    db.close()


def test_exhausted_unresolved_task_cannot_complete(tmp_path):
    cfg = load_config(smoke=True)
    cfg.root = Path(tmp_path)
    cfg.database_path = str(tmp_path / "mi.db")
    cfg.export_dir = str(tmp_path / "export")
    db = Database(cfg.database_path)
    merchant_id = resolve_merchant(db, _candidate(), 1)
    db.upsert_run("run-1", "running", "verification", 1, 0, {})
    db.execute(
        """INSERT INTO verification_tasks
           (id, run_id, merchant_id, title, instruction, status, attempts, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'unresolved', ?, ?, ?)""",
        (
            "task-exhausted",
            "run-1",
            merchant_id,
            "Retry source",
            "Find an independent source",
            cfg.research.max_task_attempts,
            "now",
            "now",
        ),
    )
    pipe = Pipeline(cfg, MockOmpClient(), db)
    pipe.state.run_id = "run-1"
    pipe.state.stage = "verification"
    pipe.state.foundation_ready = True
    asyncio.run(pipe._luna_loop())
    assert pipe.state.stage == "incomplete"
    assert "unresolved" in pipe.state.stop_reason
    row = db.query_one("SELECT status FROM verification_tasks WHERE id='task-exhausted'")
    assert row and row["status"] == "unresolved"
    db.close()


def test_rate_limit_event_envelope_is_rejected(tmp_path, monkeypatch):
    cfg = load_config(smoke=True)
    cfg.root = Path(tmp_path)
    cfg.omp.max_retries = 1
    mock = MockOmpClient()
    client = OmpClient(cfg, caps=mock.caps)

    class FakeProcess:
        pid = 12345
        returncode = 0

        async def communicate(self):
            return (
                b'{"type":"session","id":"s"}\n'
                b'{"type":"agent_end","errorStatus":429,'
                b'"retryInfo":{"retryDelay":"10s"}}\n',
                b"",
            )

    async def fake_spawn(*_args, **_kwargs):
        return FakeProcess()

    monkeypatch.setattr(
        "merchant_intel.omp.client.asyncio.create_subprocess_exec", fake_spawn
    )
    result = asyncio.run(
        client._once(
            AgentRequest(
                prompt="{}",
                model="google-antigravity/gemini-3.7-flash",
                name="rate-limit",
                role="discovery",
            ),
            mock.caps,
            10,
        )
    )
    assert result.ok is False
    assert result.payload is None
    assert result.error == "provider rate limit"

def test_sol_review_is_routed_to_luna(tmp_path):
    cfg = load_config(smoke=True)
    cfg.root = Path(tmp_path)
    db = Database(tmp_path / "mi.db")
    client = MockOmpClient()
    client.resolved_models = {
        "discovery": "google-antigravity/gemini-3.7-flash",
        "coordinator": "google-antigravity/gemini-3.7-flash",
        "analyst": "google-antigravity/gemini-3.7-flash",
        "verifier": "openai-codex/gpt-5.6-luna",
    }
    pipe = Pipeline(cfg, client, db)
    db.upsert_run(pipe.state.run_id, "running", "verification", 0, 0, {})
    output = LunaAgentOutput(
        findings=[LunaFinding(task_id="task-1", merchant_id="pending")]
    )

    asyncio.run(pipe._sol_review([output]))

    call = client.calls[-1]
    assert call.role == "verifier"
    assert call.model == "openai-codex/gpt-5.6-luna"
    assert "Gemini" in call.prompt
    db.close()
