"""Persistent Stage A/B/C orchestration for merchant intelligence."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from pydantic import ValidationError

from merchant_intel.assignments import DiscoveryAssignment, default_assignments, gap_assignments
from merchant_intel.config import AppConfig
from merchant_intel.database import Database
from merchant_intel.ingest import (
    ingest_discovery,
    ingest_luna,
    ingest_sol,
    mark_tasks_assigned,
    release_tasks,
)
from merchant_intel.omp.client import AgentRequest, AgentResult, OmpTransport
from merchant_intel.prompts import render
from merchant_intel.quality import compute_metrics, diminishing, gate_failures
from merchant_intel.schemas import (
    CoordinatorJudgement,
    DiscoveryAgentOutput,
    LunaAgentOutput,
    QualityMetrics,
    SolRoundOutput,
    utcnow,
)

log = logging.getLogger("merchant_intel.pipeline")

GOAL = (
    "Build a provenance-preserving Egyptian merchant-intelligence dataset for a future trust "
    "SaaS. Measure reputation from public evidence; never invent verdicts or public 0-100 scores."
)


@dataclass
class PipelineState:
    run_id: str
    stage: str = "discovery"
    discovery_round: int = 0
    verification_round: int = 0
    discovery_round_status: str = "idle"  # idle, agents, coordination
    completed_agents: list[str] = field(default_factory=list)
    failed_agents: list[str] = field(default_factory=list)
    session_ids: dict[str, str] = field(default_factory=dict)
    analysis_batches_completed: list[str] = field(default_factory=list)
    diminishing_streak: int = 0
    verification_no_progress_streak: int = 0
    stop_reason: str = ""
    prev_new_evidence: int = 0
    prev_pending_tasks: int = 0
    foundation_ready: bool = False
    analysis_complete: bool = False
    last_metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "stage": self.stage,
            "discovery_round": self.discovery_round,
            "verification_round": self.verification_round,
            "discovery_round_status": self.discovery_round_status,
            "completed_agents": self.completed_agents,
            "failed_agents": self.failed_agents,
            "session_ids": self.session_ids,
            "analysis_batches_completed": self.analysis_batches_completed,
            "diminishing_streak": self.diminishing_streak,
            "verification_no_progress_streak": self.verification_no_progress_streak,
            "stop_reason": self.stop_reason,
            "prev_new_evidence": self.prev_new_evidence,
            "prev_pending_tasks": self.prev_pending_tasks,
            "foundation_ready": self.foundation_ready,
            "analysis_complete": self.analysis_complete,
            "last_metrics": self.last_metrics,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PipelineState":
        return cls(
            run_id=str(data["run_id"]),
            stage=str(data.get("stage", "discovery")),
            discovery_round=int(data.get("discovery_round", 0)),
            verification_round=int(data.get("verification_round", 0)),
            discovery_round_status=str(data.get("discovery_round_status", "idle")),
            completed_agents=list(data.get("completed_agents", [])),
            failed_agents=list(data.get("failed_agents", [])),
            session_ids=dict(data.get("session_ids", {})),
            analysis_batches_completed=list(data.get("analysis_batches_completed", [])),
            diminishing_streak=int(data.get("diminishing_streak", 0)),
            verification_no_progress_streak=int(data.get("verification_no_progress_streak", 0)),
            stop_reason=str(data.get("stop_reason", "")),
            prev_new_evidence=int(data.get("prev_new_evidence", 0)),
            prev_pending_tasks=int(data.get("prev_pending_tasks", 0)),
            foundation_ready=bool(data.get("foundation_ready", False)),
            analysis_complete=bool(data.get("analysis_complete", False)),
            last_metrics=dict(data.get("last_metrics", {})),
        )


def _parse(model: type, payload: Any, *, wrap_list_as: str | None = None) -> Any:
    if payload is None:
        raise ValueError("empty agent payload")
    if isinstance(payload, list) and wrap_list_as:
        payload = {wrap_list_as: payload, "agent_id": "unknown", "assignment": "unknown"}
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        raise ValueError(str(exc)) from exc


class Pipeline:
    def __init__(self, cfg: AppConfig, client: OmpTransport, db: Database) -> None:
        self.cfg = cfg
        self.client = client
        self.db = db
        self.sem = asyncio.Semaphore(max(1, cfg.concurrency.max_parallel_agents))
        self.state = PipelineState(run_id=str(uuid.uuid4()))
        for directory in ("raw", "normalized", "verified", "rejected", "ambiguous"):
            (cfg.resolve(cfg.export_dir).parent / directory).mkdir(parents=True, exist_ok=True)

    def _save(self, *, status: str | None = None) -> None:
        if status is None:
            status = (
                "complete"
                if self.state.stage == "complete"
                else "incomplete"
                if self.state.stage == "incomplete"
                else "running"
            )
        self.db.upsert_run(
            self.state.run_id,
            status,
            self.state.stage,
            self.state.discovery_round,
            self.state.verification_round,
            self.cfg.safe_snapshot(),
            self.state.stop_reason,
        )
        self.db.save_checkpoint(self.state.run_id, self.state.to_dict())

    def resume(self, run_id: str | None = None) -> None:
        rid = run_id or self.db.latest_resumable_run_id() or self.db.latest_run_id()
        if not rid:
            raise RuntimeError("no run to resume")
        payload = self.db.load_checkpoint(rid)
        if not payload:
            raise RuntimeError(f"no checkpoint for {rid}")
        self.state = PipelineState.from_dict(payload)
        if self.state.stage == "complete":
            return
        if self.state.stage == "incomplete":
            # Incomplete is a durable outcome, not a dead end. Resume from
            # the earliest unfinished stage so provider failures can be retried
            # after quotas recover or the operator raises configured limits.
            if self.state.discovery_round_status == "coordination":
                self.state.stage = "coordination"
            elif self.state.discovery_round_status == "agents":
                self.state.stage = "discovery"
            elif self.state.analysis_complete:
                self.state.stage = "verification"
            elif self.state.discovery_round > 0:
                self.state.stage = "analysis"
            else:
                self.state.stage = "discovery"
            self.state.stop_reason = ""
        if self.state.stage == "complete":
            raise RuntimeError(f"run {rid} is already complete")
        # A process can die after marking a verification task in progress. It
        # is safe to return it to the durable queue; agent output is idempotent.
        self.db.execute(
            """UPDATE verification_tasks SET status='pending', assigned_agent=NULL,
               updated_at=? WHERE run_id=? AND status='in_progress'""",
            (utcnow().isoformat(), rid),
        )

    async def run(self) -> PipelineState:
        await self.client.resolve_models()
        self._save(status="running")
        try:
            if self.state.stage in {"discovery", "coordination"}:
                await self._discovery_loop()
            if self.state.stage == "analysis":
                await self._sol()
            if self.state.stage == "verification":
                await self._luna_loop()
            self._finalize()
            self._save()
        except asyncio.CancelledError:
            self.state.stop_reason = self.state.stop_reason or "controller interrupted; checkpoint preserved"
            self._save(status="running")
            raise
        except Exception as exc:
            self.state.stop_reason = self.state.stop_reason or f"controller error: {type(exc).__name__}: {exc}"
            self._save(status="running")
            raise
        return self.state

    def _finalize(self) -> None:
        if self.state.stage == "complete":
            return
        pending = self.db.query_one(
            """SELECT COUNT(*) AS n FROM verification_tasks
               WHERE run_id=? AND status IN ('pending','unresolved','in_progress')""",
            (self.state.run_id,),
        )
        left = int(pending["n"]) if pending else 0
        if self.state.foundation_ready and self.state.analysis_complete and left == 0:
            self.state.stage = "complete"
            self.state.stop_reason = self.state.stop_reason or "quality gates satisfied and verification queue empty"
        else:
            self.state.stage = "incomplete"
            self.state.stop_reason = self.state.stop_reason or (
                "quality gates or verification completeness not satisfied; uncertainty preserved"
            )
    async def _schema_repair(
        self,
        result: AgentResult,
        *,
        role: str,
        name: str,
        stage: str,
        workspace_id: str,
        error: str,
    ) -> AgentResult | None:
        if not result.session_id:
            return None
        repair = await self.client.run(
            AgentRequest(
                prompt=(
                    "Your previous JSON was syntactically valid but failed the required "
                    "schema. Correct it now and return ONLY the JSON object. Do not add "
                    f"markdown or commentary. Validation error: {error[:4000]}"
                ),
                model=self.client.model_for_role(role),
                name=f"{name}-schema-repair",
                role=role,
                goal=GOAL,
                session_id=result.session_id,
                resume=True,
                workspace_id=workspace_id,
            )
        )
        self._log_agent(stage, f"{name}-schema-repair", repair, "schema repair", role)
        return repair

    async def _discovery_loop(self) -> None:
        searches = self._latest_searches()
        while self.state.discovery_round < self.cfg.research.max_discovery_rounds:
            if self.state.discovery_round_status == "coordination" or self.state.stage == "coordination":
                metrics = compute_metrics(
                    self.db,
                    run_id=self.state.run_id,
                    stale_after_days=self.cfg.research.stale_after_days,
                )
                judgement = await self._coordinate(metrics)
                if await self._after_judgement(judgement, metrics):
                    return
                searches = self._latest_searches()
                continue

            if self.state.discovery_round_status == "idle":
                self.state.discovery_round += 1
                self.state.discovery_round_status = "agents"
                self.state.completed_agents = []
                self.state.failed_agents = []
                self._save()

            count = self.cfg.concurrency.discovery_agents
            assignments = gap_assignments(self.cfg, searches, count) if searches else default_assignments(self.cfg, count)
            pending = [a for a in assignments if a.agent_id not in self.state.completed_agents]
            print(
                f"[Discovery R{self.state.discovery_round}] {len(assignments)} agents launched; "
                f"{len(pending)} pending",
                flush=True,
            )
            results = await self._run_group([self._discovery_one(item) for item in pending])
            parsed_count = sum(1 for result in results if result)
            print(
                f"[Discovery R{self.state.discovery_round}] {parsed_count}/{len(pending)} parsed; "
                f"{len(self.state.completed_agents)}/{len(assignments)} complete",
                flush=True,
            )
            metrics = compute_metrics(
                self.db,
                new_evidence=sum(r.get("new_evidence", 0) for r in results if isinstance(r, dict)),
                run_id=self.state.run_id,
                stale_after_days=self.cfg.research.stale_after_days,
            )
            self._record_metrics("discovery", metrics)
            print(
                f"Unique merchants: {metrics.unique_merchants}  Evidence: {metrics.evidence_items}  "
                f"Independent: {metrics.independent_evidence_items}  Duplicates: {metrics.duplicate_rate:.0%}  "
                f"High/medium: {metrics.high_confidence_ratio + metrics.medium_confidence_ratio:.0%}",
                flush=True,
            )
            self.state.discovery_round_status = "coordination"
            self.state.stage = "coordination"
            self._save()
            judgement = await self._coordinate(metrics)
            if await self._after_judgement(judgement, metrics):
                return
            searches = self._latest_searches()

        self.state.stage = "analysis"
        self.state.discovery_round_status = "idle"
        self.state.foundation_ready = False
        self.state.stop_reason = self.state.stop_reason or "maximum discovery rounds without meeting quality gates"
        self._save()

    async def _after_judgement(
        self, judgement: CoordinatorJudgement, metrics: QualityMetrics
    ) -> bool:
        for gap in judgement.gaps:
            self.db.execute(
                """INSERT INTO research_gaps(run_id, round_no, gap_type, description, searches_json)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    self.state.run_id,
                    self.state.discovery_round,
                    gap.type.value,
                    gap.description,
                    self.db.dumps(gap.recommended_next_searches),
                ),
            )
        reasons = gate_failures(metrics, self.cfg.quality_gates)
        new_evidence = metrics.new_useful_evidence
        if diminishing(self.state.prev_new_evidence, new_evidence, self.cfg.research.diminishing_ratio):
            self.state.diminishing_streak += 1
        else:
            self.state.diminishing_streak = 0
        self.state.prev_new_evidence = new_evidence
        if judgement.dataset_foundation_ready and not reasons:
            self.state.foundation_ready = True
            self.state.stage = "analysis"
            self.state.discovery_round_status = "idle"
            self._save()
            print("Coordinator: dataset foundation ready.", flush=True)
            return True

        stop_for_diminishing = (
            self.state.diminishing_streak >= self.cfg.research.diminishing_streak
            or judgement.diminishing_returns
        )
        if stop_for_diminishing or not judgement.continue_research:
            self.state.foundation_ready = False
            self.state.stage = "analysis"
            self.state.discovery_round_status = "idle"
            self.state.stop_reason = (
                "discovery stopped at measurable diminishing returns"
                if stop_for_diminishing
                else "coordinator found no justified additional discovery; dataset remains incomplete"
            )
            self._save()
            print(f"Coordinator: {self.state.stop_reason}.", flush=True)
            for reason in reasons[:8]:
                print(f"  - {reason}", flush=True)
            return True

        if self.state.discovery_round >= self.cfg.research.max_discovery_rounds:
            self.state.foundation_ready = False
            self.state.stage = "analysis"
            self.state.discovery_round_status = "idle"
            self.state.stop_reason = "maximum discovery rounds without meeting quality gates"
            self._save()
            return True

        print("Coordinator: coverage insufficient; launching targeted gap searches.", flush=True)
        for reason in reasons[:8]:
            print(f"  - {reason}", flush=True)
        self.state.stage = "discovery"
        self.state.discovery_round_status = "idle"
        self.state.completed_agents = []
        self._save()
        return False
    async def _after_judgement(
        self, judgement: CoordinatorJudgement, metrics: QualityMetrics
    ) -> bool:
        for gap in judgement.gaps:
            self.db.execute(
                """INSERT INTO research_gaps(run_id, round_no, gap_type, description, searches_json)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    self.state.run_id,
                    self.state.discovery_round,
                    gap.type.value,
                    gap.description,
                    self.db.dumps(gap.recommended_next_searches),
                ),
            )
        self.state.stage = "discovery"
        self.state.discovery_round_status = "idle"
        self.state.completed_agents = []
        self._save()
        return False
        new_evidence = metrics.new_useful_evidence
        if diminishing(self.state.prev_new_evidence, new_evidence, self.cfg.research.diminishing_ratio):
            self.state.diminishing_streak += 1
        else:
            self.state.diminishing_streak = 0
        self.state.prev_new_evidence = new_evidence

        if judgement.dataset_foundation_ready and not reasons:
            self.state.foundation_ready = True
            self.state.stage = "analysis"
            self.state.discovery_round_status = "idle"
            self._save()
            print("Coordinator: dataset foundation ready.", flush=True)
            return True

        stop_for_diminishing = (
            self.state.diminishing_streak >= self.cfg.research.diminishing_streak
            or judgement.diminishing_returns
        )
        if stop_for_diminishing or not judgement.continue_research:
            self.state.foundation_ready = False
            self.state.stage = "analysis"
            self.state.discovery_round_status = "idle"
            self.state.stop_reason = (
                "discovery stopped at measurable diminishing returns"
                if stop_for_diminishing
                else "coordinator found no justified additional discovery; dataset remains incomplete"
            )
            self._save()
            print(f"Coordinator: {self.state.stop_reason}.", flush=True)
            for reason in reasons[:8]:
                print(f"  - {reason}", flush=True)
            return True

        if self.state.discovery_round >= self.cfg.research.max_discovery_rounds:
            self.state.foundation_ready = False
            self.state.stage = "analysis"
            self.state.discovery_round_status = "idle"
            self.state.stop_reason = "maximum discovery rounds without meeting quality gates"
            self._save()
            return True

        print("Coordinator: coverage insufficient; launching targeted gap searches.", flush=True)
        for reason in reasons[:8]:
            print(f"  - {reason}", flush=True)
        self.state.discovery_round_status = "idle"
        self.state.completed_agents = []
        self._save()
        return False

    def _latest_searches(self) -> list[str]:
        rows = self.db.query(
            "SELECT searches_json FROM research_gaps WHERE run_id=? ORDER BY id DESC LIMIT 12",
            (self.state.run_id,),
        )
        searches: list[str] = []
        for row in rows:
            try:
                values = json.loads(row["searches_json"])
            except (TypeError, ValueError):
                values = []
            if isinstance(values, list):
                searches.extend(str(value) for value in values if str(value).strip())
        return list(dict.fromkeys(searches))

    async def _discovery_one(self, assignment: DiscoveryAssignment) -> dict[str, int] | None:
        async with self.sem:
            prompt = render(
                "discovery.md",
                goal=GOAL,
                country=self.cfg.research.country,
                language_hint=self.cfg.research.language_hint,
                agent_id=assignment.agent_id,
                group=assignment.group,
                title=assignment.title,
                focus=assignment.focus,
                city_bias=assignment.city_bias or "any Egyptian city plus nationwide/online",
                source_bias=assignment.source_bias,
                search_seeds="\n".join(f"- {seed}" for seed in assignment.search_seeds),
                exclusions=self._exclusions(),
            )
            result = await self.client.run(
                AgentRequest(
                    prompt=prompt,
                    model=self.client.model_for_role("discovery"),
                    name=assignment.agent_id,
                    role="discovery",
                    goal=GOAL,
                    workspace_id=f"{self.state.run_id}-discovery-r{self.state.discovery_round}-{assignment.agent_id}",
                )
            )
            self._log_agent("discovery", assignment.agent_id, result, assignment.title, "discovery")
            if not result.ok:
                self.state.failed_agents.append(assignment.agent_id)
                self._save()
                return None
            try:
                parsed = _parse(DiscoveryAgentOutput, result.payload, wrap_list_as="records")
                if parsed.agent_id == "unknown":
                    parsed.agent_id = assignment.agent_id
            except ValueError as exc:
                log.warning("discovery parse failed %s: %s", assignment.agent_id, exc)
                self.state.failed_agents.append(assignment.agent_id)
                self._save()
                return None
            stats = ingest_discovery(
                self.db,
                parsed,
                agent_run_id=f"{self.state.run_id}:{assignment.agent_id}",
                round_no=self.state.discovery_round,
            )
            self.state.completed_agents.append(assignment.agent_id)
            if result.session_id:
                self.state.session_ids[assignment.agent_id] = result.session_id
            prompt = render(
                "sol.md",
                goal=GOAL,
                scope_hint=self.cfg.research.scope_hint,
                packages=self._merchant_packages_for_ids(ids),
            )
            return stats

    def _exclusions(self, limit: int = 60) -> str:
        rows = self.db.query(
            "SELECT canonical_name, city FROM merchants ORDER BY updated_at DESC LIMIT ?",
            (limit,),
                    timeout_sec=self.cfg.omp.analysis_timeout_sec,
        )
        return "\n".join(f"- {row['canonical_name']} ({row['city']})" for row in rows) or "(none yet)"

    async def _coordinate(self, metrics: QualityMetrics) -> CoordinatorJudgement:
        self.state.stage = "coordination"
        prompt = render(
            "coordinator.md",
            goal=GOAL,
            metrics=metrics.model_dump_json(indent=2),
            merchant_sample=self._merchant_packages(12),
            previous_gaps=self.state.stop_reason or "(none)",
        )
        result = await self.client.run(
            AgentRequest(
                prompt=prompt,
                model=self.client.model_for_role("coordinator"),
                name=f"coordinator-r{self.state.discovery_round}",
                role="coordinator",
                goal=GOAL,
                workspace_id=f"{self.state.run_id}-coordinator-r{self.state.discovery_round}",
            )
        )
        self._log_agent("coordination", "coordinator", result, "dataset quality judgement", "coordinator")
        if result.session_id:
            self.state.session_ids[f"coordinator-r{self.state.discovery_round}"] = result.session_id
        if not result.ok or result.payload is None:
            return CoordinatorJudgement(
                continue_research=True,
                ready_for_analysis=False,
                dataset_foundation_ready=False,
                unique_merchants=metrics.unique_merchants,
                identity_resolution_rate=metrics.identity_resolution_rate,
                source_diversity_score=0.0,
                rationale="coordinator failed; continue targeted discovery",
            )
        try:
            return _parse(CoordinatorJudgement, result.payload)
        except ValueError as exc:
            repaired = await self._schema_repair(
                result,
                role="coordinator",
                name=f"coordinator-r{self.state.discovery_round}",
                stage="coordination",
                workspace_id=f"{self.state.run_id}-coordinator-r{self.state.discovery_round}",
                error=str(exc),
            )
            if repaired and repaired.ok:
                try:
                    return _parse(CoordinatorJudgement, repaired.payload)
                except ValueError:
                    pass
            log.warning("coordinator JSON invalid: %s", exc)
            return CoordinatorJudgement(
                continue_research=True,
                ready_for_analysis=False,
                dataset_foundation_ready=False,
                unique_merchants=metrics.unique_merchants,
                identity_resolution_rate=metrics.identity_resolution_rate,
                source_diversity_score=0.0,
                rationale="coordinator JSON invalid; continue discovery",
            )

    def _full_verification_queue_count(self) -> int:
        row = self.db.query_one(
            """SELECT COUNT(*) AS n FROM verification_tasks
               WHERE run_id=? AND status IN ('pending','unresolved','in_progress')""",
            (self.state.run_id,),
        )
        return int(row["n"]) if row else 0

    def _verification_stop_note(self) -> str:
        return (
            "verification queue empty"
            if self._full_verification_queue_count() == 0
            else "verification budget exhausted; unresolved claims preserved"
        )



    async def _sol(self) -> None:
        self.state.stage = "analysis"
        merchants = self.db.query("SELECT id FROM merchants ORDER BY id")
        if not merchants:
            self.state.stop_reason = self.state.stop_reason or "no merchants were discovered"
            self._save()
            return
        batch_size = max(1, self.cfg.research.analysis_batch_size)
        total_batches = (len(merchants) + batch_size - 1) // batch_size
        print(f"[Sol Analysis] {len(merchants)} merchants in {total_batches} bounded batches", flush=True)
        for batch_index in range(total_batches):
            batch_key = f"analysis-r{self.state.discovery_round}-b{batch_index + 1}"
            if batch_key in self.state.analysis_batches_completed:
                continue
            ids = {row["id"] for row in merchants[batch_index * batch_size : (batch_index + 1) * batch_size]}
            prompt = render("sol.md", goal=GOAL, packages=self._merchant_packages_for_ids(ids))
            result = await self.client.run(
                AgentRequest(
                    prompt=prompt,
                    model=self.client.model_for_role("analyst"),
                    name=f"sol-r{self.state.discovery_round}-b{batch_index + 1}",
                    role="analyst",
                    goal=GOAL,
                    workspace_id=f"{self.state.run_id}-{batch_key}",
                )
            )
            self._log_agent("analysis", batch_key, result, batch_key, "analyst")
            if not result.ok:
                self.state.stop_reason = f"Sol analysis failed for {batch_key}"
                self._save()
                return
            try:
                parsed = _parse(SolRoundOutput, result.payload)
            except ValueError as exc:
                repaired = await self._schema_repair(
                    result,
                    role="analyst",
                    name=f"sol-r{self.state.discovery_round}-b{batch_index + 1}",
                    stage="analysis",
                    workspace_id=f"{self.state.run_id}-{batch_key}",
                    error=str(exc),
                )
                if repaired and repaired.ok:
                    try:
                        parsed = _parse(SolRoundOutput, repaired.payload)
                    except ValueError:
                        parsed = None
            if parsed is None:
                self.state.stop_reason = f"Sol output invalid for {batch_key}"
                self._save()
                return
            self._limit_analysis_tasks(parsed)
            ingest_sol(
                self.db,
                self.state.run_id,
                parsed,
                self.state.verification_round,
                allowed_merchant_ids=ids,
            )
            self.state.analysis_batches_completed.append(batch_key)
            self._save()
        self.state.analysis_complete = True
        self.state.stage = "verification"
        self._save()
        task_count = self.db.query_one(
            "SELECT COUNT(*) AS n FROM verification_tasks WHERE run_id=?", (self.state.run_id,)
        )
        print(f"[Sol Analysis] batches complete; verification_tasks={int(task_count['n']) if task_count else 0}", flush=True)

    async def _luna_loop(self) -> None:
        max_rounds = self.cfg.research.max_verification_rounds
        while self.state.verification_round < max_rounds:
            pending = self.db.query(
                """SELECT * FROM verification_tasks
                   WHERE run_id=? AND status IN ('pending','unresolved') AND attempts < ?
                   ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id""",
                (self.state.run_id, self.cfg.research.max_task_attempts),
            )
            if not pending:
                full_queue = self._full_verification_queue_count()
                self.state.stage = (
                    "complete"
                    if self.state.foundation_ready and full_queue == 0
                    else "incomplete"
                )
                self.state.stop_reason = self.state.stop_reason or (
                    self._verification_stop_note()
                    if full_queue == 0
                    else "verification budget exhausted; unresolved claims preserved"
                )
                self._save()
                return
            self.state.verification_round += 1
            self.state.stage = "verification"
            before = len(pending)
            per = max(1, self.cfg.concurrency.luna_tasks_per_agent)
            n_agents = min(
                self.cfg.concurrency.max_luna_agents,
                max(self.cfg.concurrency.min_luna_agents, (before + per - 1) // per),
            )
            print(
                f"[Luna Verification R{self.state.verification_round}] launching {n_agents} agents for {before} tasks",
                flush=True,
            )
            # Bounded chunks: the per-agent prompt carries every task's text,
            # and argv elements cap at ~128 KB. The class semaphore still
            # throttles how many run concurrently.
            chunk_size = 60
            chunks = [pending[i : i + chunk_size] for i in range(0, len(pending), chunk_size)]
            results = await self._run_group(
                [self._luna_one(index, chunk) for index, chunk in enumerate(chunks, start=1) if chunk]
            )
            findings = [item for item in results if isinstance(item, dict) and item.get("output")]
            await self._sol_review([item["output"] for item in findings])
            metrics = compute_metrics(
                self.db,
                run_id=self.state.run_id,
                stale_after_days=self.cfg.research.stale_after_days,
                new_evidence=sum(int(item.get("new_evidence", 0)) for item in results if isinstance(item, dict)),
            )
            self._record_metrics("verification", metrics)
            after_row = self.db.query_one(
                """SELECT COUNT(*) AS n FROM verification_tasks
                   WHERE run_id=? AND status IN ('pending','unresolved') AND attempts < ?""",
                (self.state.run_id, self.cfg.research.max_task_attempts),
            )
            after = int(after_row["n"]) if after_row else 0
            print(f"Remaining actionable verification tasks: {after}", flush=True)
            if self.state.verification_no_progress_streak >= self.cfg.research.diminishing_streak:
                self.state.stage = "incomplete"
                self.state.stop_reason = "verification reached diminishing returns; unresolved tasks preserved"
                self._save()
                return
            self._save()
        self.state.stage = "incomplete"
        self.state.stop_reason = "maximum verification rounds reached; unresolved tasks preserved"
        self._save()

    async def _luna_one(self, index: int, rows: list[Any]) -> dict[str, Any] | None:
        async with self.sem:
            agent_id = f"luna-{self.state.verification_round}-{index:02d}"
            task_ids = [str(row["id"]) for row in rows]
            mark_tasks_assigned(self.db, task_ids, agent_id, self.state.verification_round)
            def _clip(value: object, limit: int) -> str:
                text = str(value or "")
                return text if len(text) <= limit else text[:limit] + "…"

            tasks = [
                {
                    "task_id": row["id"],
                    "merchant_id": row["merchant_id"],
                    "title": _clip(row["title"], 150),
                    "instruction": _clip(row["instruction"], 400),
                    "already_used_sources": _clip(row["excluded_sources_json"], 300),
                    "attempt": int(row["attempts"] or 0) + 1,
                }
                for row in rows
            ]
            prompt = render(
                "luna.md",
                goal=GOAL,
                agent_id=agent_id,
                tasks=self.db.dumps(tasks),
            )
            result = await self.client.run(
                AgentRequest(
                    prompt=prompt,
                    model=self.client.model_for_role("verifier"),
                    name=agent_id,
                    role="verifier",
                    goal=GOAL,
                    workspace_id=f"{self.state.run_id}-verification-r{self.state.verification_round}-{index}",
                )
            )
            self._log_agent("verification", agent_id, result, f"{len(rows)} narrow tasks", "verifier")
            if not result.ok:
                release_tasks(self.db, task_ids, result.error or "verifier failed")
                self.state.failed_agents.append(agent_id)
                self._save()
                return None
            try:
                parsed = _parse(LunaAgentOutput, result.payload, wrap_list_as="findings")
                parsed.agent_id = agent_id
            except ValueError as exc:
                release_tasks(self.db, task_ids, str(exc))
                log.warning("luna parse failed %s: %s", agent_id, exc)
                self.state.failed_agents.append(agent_id)
                self._save()
                return None
            returned_ids = {finding.task_id for finding in parsed.findings}
            release_tasks(
                self.db,
                [task_id for task_id in task_ids if task_id not in returned_ids],
                "verifier omitted this task from its response",
            )
            added = ingest_luna(
                self.db,
                parsed,
                agent_run_id=f"{self.state.run_id}:{agent_id}",
                round_no=self.state.verification_round,
            )
            if result.session_id:
                self.state.session_ids[agent_id] = result.session_id
            self._save()
            return {"output": parsed, "new_evidence": added, "agent_id": agent_id}

    async def _sol_review(self, outputs: Iterable[LunaAgentOutput]) -> None:
        outputs = list(outputs)
        if not outputs:
            return
        merchant_ids = {
            finding.merchant_id
            for output in outputs
            for finding in output.findings
            if finding.merchant_id and finding.merchant_id != "pending"
        }
        findings_json = self.db.dumps([output.model_dump() for output in outputs])
        # Linux caps a single argv element at ~128 KB; the composed prompt is
        # passed as one argv element, so bound both payloads well under it.
        max_prompt_part = 80_000
        packages = self._merchant_packages_for_ids(merchant_ids)
        if len(packages) > max_prompt_part:
            packages = packages[:max_prompt_part] + "\n…(truncated: dataset exceeds prompt budget)"
        if len(findings_json) > max_prompt_part:
            findings_json = findings_json[:max_prompt_part] + "\n…(truncated: findings exceed prompt budget)"
        prompt = render(
            "sol_review.md",
            goal=GOAL,
            packages=packages,
            findings=findings_json,
        )
        name = f"sol-review-r{self.state.verification_round}"
        result = await self.client.run(
            AgentRequest(
                prompt=prompt,
                model=self.client.model_for_role("analyst"),
                name=name,
                role="analyst",
                goal=GOAL,
                workspace_id=f"{self.state.run_id}-{name}",
            )
        )
        self._log_agent("analysis_review", name, result, "Luna findings review", "analyst")
        if not result.ok:
            return
        try:
            parsed = _parse(SolRoundOutput, result.payload)
        except ValueError as exc:
            log.warning("Sol verification review invalid: %s", exc)
            return
        self._limit_analysis_tasks(parsed)
        ingest_sol(
            self.db,
            self.state.run_id,
            parsed,
            self.state.verification_round,
            allowed_merchant_ids=merchant_ids,
        )

    def _limit_analysis_tasks(self, output: SolRoundOutput) -> None:
        limit = max(0, self.cfg.research.max_verification_tasks_per_merchant)
        if limit == 0:
            for merchant in output.merchants:
                merchant.verification_tasks = []
            return
        for merchant in output.merchants:
            merchant.verification_tasks = merchant.verification_tasks[:limit]

    async def _run_group(self, coros: list[Any]) -> list[Any]:
        if not coros:
            return []
        raw = await asyncio.gather(*coros, return_exceptions=True)
        results: list[Any] = []
        for item in raw:
            if isinstance(item, BaseException):
                if isinstance(item, asyncio.CancelledError):
                    raise item
                log.error("agent task failed: %s", item)
            else:
                results.append(item)
        return results

    def _record_metrics(self, stage: str, metrics: QualityMetrics) -> None:
        round_no = self.state.discovery_round if stage == "discovery" else self.state.verification_round
        self.db.save_metrics(self.state.run_id, stage, round_no, metrics.as_dict())
        self.state.last_metrics = metrics.as_dict()


    def _previous_gaps(self) -> str:
        rows = self.db.query(
            "SELECT gap_type, description, searches_json FROM research_gaps WHERE run_id=? ORDER BY id DESC LIMIT 12",
            (self.state.run_id,),
        )
        return "\n".join(
            f"- {row['gap_type']}: {row['description']} searches={row['searches_json']}" for row in rows
        ) or "(none)"

    def _merchant_packages(self, limit: int = 20) -> str:
        rows = self.db.query(
            "SELECT id FROM merchants ORDER BY updated_at DESC LIMIT ?", (limit,)
        )
        return self._merchant_packages_for_ids({row["id"] for row in rows})

    def _merchant_packages_for_ids(self, merchant_ids: set[str]) -> str:
        if not merchant_ids:
            return "(no merchants)"
        placeholders = ",".join("?" for _ in merchant_ids)
        merchants = self.db.query(
            f"SELECT * FROM merchants WHERE id IN ({placeholders}) ORDER BY id",
            tuple(merchant_ids),
        )
        blocks: list[str] = []
        for merchant in merchants:
            evidence = self.db.query(
                """SELECT e.summary, e.sentiment, e.claim_type, e.confidence, e.reliability_band,
                          e.published_at, e.independent, e.duplicate_of, s.url, s.platform
                   FROM evidence e JOIN sources s ON s.id=e.source_id
                   WHERE e.merchant_id=? ORDER BY e.independent DESC, e.captured_at DESC LIMIT 20""",
                (merchant["id"],),
            )
            lines = [
                f"merchant_id={merchant['id']}",
                f"name={merchant['canonical_name']} city={merchant['city']} governorate={merchant['governorate']} category={merchant['category']}",
                f"identity_confidence={merchant['identity_confidence']} state={merchant['state']}",
            ]
            for item in evidence:
                lines.append(
                    f"- [{item['sentiment']}/{item['claim_type']}/{item['reliability_band']}/"
                    f"confidence={item['confidence']}/independent={item['independent']}] "
                    f"{item['summary'][:240]} source={item['url']} published={item['published_at']}"
                )
            blocks.append("\n".join(lines))
        return "\n\n".join(blocks) or "(no merchants)"

    def _log_agent(
        self,
        stage: str,
        agent_id: str,
        result: AgentResult,
        assignment: str,
        role: str,
    ) -> None:
        raw_dir = self.cfg.resolve(self.cfg.export_dir).parent / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        safe = "".join(char if char.isalnum() or char in "-_." else "-" for char in agent_id)
        raw_path = raw_dir / f"{self.state.run_id}-{stage}-r{self.state.discovery_round}-{safe}.json"
        raw_path.write_text(
            json.dumps(
                {
                    "run_id": self.state.run_id,
                    "stage": stage,
                    "round": self.state.verification_round if stage in {"verification", "analysis_review"} else self.state.discovery_round,
                    "agent_id": agent_id,
                    "assignment": assignment,
                    "role": role,
                    "model": result.model,
                    "session_id": result.session_id,
                    "ok": result.ok,
                    "attempts": result.attempts,
                    "duration_ms": result.duration_ms,
                    "usage": result.usage.__dict__,
                    "argv": result.argv,
                    "error": result.error,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "text": result.text,
                    "payload": result.payload,
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        row_id = f"{self.state.run_id}:{stage}:{self.state.discovery_round}:{self.state.verification_round}:{agent_id}"
        self.db.execute(
            """INSERT OR REPLACE INTO agent_runs
               (id, run_id, stage, round_no, agent_id, role, model, assignment_json,
                omp_session_id, status, attempts, started_at, finished_at, error, raw_path,
                parsed_ok, input_tokens, output_tokens, cached_tokens, cost, duration_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                row_id,
                self.state.run_id,
                stage,
                self.state.verification_round if stage in {"verification", "analysis_review"} else self.state.discovery_round,
                agent_id,
                role,
                result.model,
                json.dumps({"assignment": assignment}, ensure_ascii=False),
                result.session_id,
                "ok" if result.ok and result.payload is not None else "error",
                result.attempts,
                utcnow().isoformat(),
                utcnow().isoformat(),
                result.error,
                str(raw_path),
                int(bool(result.ok and result.payload is not None)),
                result.usage.input_tokens,
                result.usage.output_tokens,
                result.usage.cached_tokens,
                result.usage.cost,
                result.duration_ms,
            ),
        )

