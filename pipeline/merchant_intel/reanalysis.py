"""Explicit UUID-only seller reanalysis without restarting the pipeline loop."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

from merchant_intel.config import AppConfig
from merchant_intel.database import Database
from merchant_intel.ingest import ingest_sol
from merchant_intel.omp.client import AgentRequest, OmpTransport
from merchant_intel.pipeline import GOAL, Pipeline, _parse
from merchant_intel.prompts import render
from merchant_intel.schemas import SolRoundOutput

TARGETED_REANALYSIS_MODEL = "google-antigravity/gemini-3.7-flash"


class ReanalysisError(ValueError):
    """Raised when a targeted batch cannot be validated without guessing."""


@dataclass(frozen=True)
class ReanalysisResult:
    run_id: str
    round_no: int
    merchant_ids: tuple[str, ...]
    analyses_persisted: int

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["merchant_ids"] = list(self.merchant_ids)
        return data


def _canonical_requested_ids(merchant_ids: Sequence[str]) -> tuple[str, ...]:
    if not merchant_ids:
        raise ReanalysisError("at least one merchant UUID is required")

    normalized: list[str] = []
    seen: set[str] = set()
    for raw_id in merchant_ids:
        text = str(raw_id).strip()
        try:
            merchant_id = str(uuid.UUID(text))
        except (AttributeError, TypeError, ValueError) as exc:
            raise ReanalysisError(f"merchant identifier is not a UUID: {text!r}") from exc
        if merchant_id in seen:
            raise ReanalysisError(f"duplicate requested merchant UUID: {merchant_id}")
        seen.add(merchant_id)
        normalized.append(merchant_id)
    return tuple(normalized)


def _load_curated_confidence(
    db: Database, merchant_ids: tuple[str, ...]
) -> dict[str, float]:
    placeholders = ",".join("?" for _ in merchant_ids)
    rows = db.query(
        f"SELECT id, identity_confidence FROM merchants WHERE id IN ({placeholders})",
        merchant_ids,
    )
    confidence = {str(row["id"]): float(row["identity_confidence"]) for row in rows}
    missing = sorted(set(merchant_ids) - set(confidence))
    if missing:
        raise ReanalysisError(f"unknown merchant UUIDs: {', '.join(missing)}")
    return confidence


def _validate_and_curate_output(
    output: SolRoundOutput,
    requested_ids: tuple[str, ...],
    curated_confidence: dict[str, float],
) -> None:
    requested = set(requested_ids)
    returned: set[str] = set()

    for analysis in output.merchants:
        merchant_id = analysis.merchant_id.strip()
        if not merchant_id or merchant_id == "pending":
            raise ReanalysisError("targeted reanalysis requires an explicit merchant UUID; pending is invalid")
        if merchant_id not in requested:
            raise ReanalysisError(
                f"analysis returned an ID outside the requested UUID set: {merchant_id!r}"
            )
        if merchant_id in returned:
            raise ReanalysisError(f"duplicate analysis for merchant UUID: {merchant_id}")
        returned.add(merchant_id)
        # Canonicalize in place so membership, completeness, and the curated
        # confidence lookup share one stripped key.
        analysis.merchant_id = merchant_id

    missing = sorted(requested - returned)
    if missing:
        raise ReanalysisError(f"analysis omitted requested merchant UUIDs: {', '.join(missing)}")

    # Consolidation reanalysis must not enqueue a new research round, and the
    # model must not overwrite identifier-derived curation.
    for analysis in output.merchants:
        analysis.verification_tasks = []
        analysis.identity_confidence = curated_confidence[analysis.merchant_id]


async def reanalyze_merchants(
    cfg: AppConfig,
    client: OmpTransport,
    db: Database,
    merchant_ids: Sequence[str],
) -> ReanalysisResult:
    """Reanalyze exactly ``merchant_ids`` and atomically persist one validated batch.

    The function performs no database writes until the complete model response has
    passed schema, provider, membership, uniqueness, and completeness validation.
    """

    requested_ids = _canonical_requested_ids(merchant_ids)
    curated_confidence = _load_curated_confidence(db, requested_ids)

    catalog = await client.list_models()
    if TARGETED_REANALYSIS_MODEL not in catalog:
        raise ReanalysisError(
            "required targeted reanalysis model is unavailable; refusing provider fallback"
        )

    # This is deliberately the pipeline's package builder rather than a second
    # evidence-selection policy. It caps every seller at 20 evidence rows, and
    # the established analysis batch size also keeps the OMP argv bounded.
    package_builder = Pipeline(cfg, client, db)
    batch_size = max(1, cfg.research.analysis_batch_size)
    batch_token = uuid.uuid4().hex
    validated_analyses = []
    dataset_notes: list[str] = []
    remaining_uncertainties = 0

    for offset in range(0, len(requested_ids), batch_size):
        batch_ids = requested_ids[offset : offset + batch_size]
        packages = package_builder._merchant_packages_for_ids(set(batch_ids))
        prompt = render(
            "sol.md",
            goal=GOAL,
            scope_hint=cfg.research.scope_hint,
            packages=packages,
        )
        batch_number = offset // batch_size + 1
        result = await client.run(
            AgentRequest(
                prompt=prompt,
                model=TARGETED_REANALYSIS_MODEL,
                name=f"seller-reanalysis-{batch_token}-b{batch_number}",
                role="analyst",
                goal=GOAL,
                workspace_id=f"seller-reanalysis-{batch_token}-b{batch_number}",
                timeout_sec=cfg.omp.analysis_timeout_sec,
            )
        )
        if not result.ok:
            raise ReanalysisError(
                result.error or f"targeted reanalysis provider call failed for batch {batch_number}"
            )
        if result.model != TARGETED_REANALYSIS_MODEL:
            raise ReanalysisError(
                "targeted reanalysis changed provider/model; refusing fallback result "
                f"from {result.model!r}"
            )
        try:
            batch_output = _parse(SolRoundOutput, result.payload)
        except ValueError as exc:
            raise ReanalysisError(
                f"targeted reanalysis batch {batch_number} failed schema validation: {exc}"
            ) from exc
        _validate_and_curate_output(batch_output, batch_ids, curated_confidence)
        validated_analyses.extend(batch_output.merchants)
        if batch_output.dataset_notes:
            dataset_notes.append(batch_output.dataset_notes)
        remaining_uncertainties += batch_output.remaining_critical_uncertainties

    parsed = SolRoundOutput(
        merchants=validated_analyses,
        dataset_notes="\n".join(dataset_notes),
        remaining_critical_uncertainties=remaining_uncertainties,
    )
    _validate_and_curate_output(parsed, requested_ids, curated_confidence)

    run_id = f"seller-reanalysis-{batch_token}"
    with db.transaction():
        row = db.query_one("SELECT COALESCE(MAX(round_no), 0) AS max_round FROM merchant_analyses")
        round_no = int(row["max_round"] if row else 0) + 1
        db.upsert_run(
            run_id,
            "complete",
            "analysis",
            0,
            round_no,
            {
                "kind": "targeted_seller_reanalysis",
                "model": TARGETED_REANALYSIS_MODEL,
                "merchant_ids": list(requested_ids),
            },
            notes="Explicit UUID-only seller consolidation reanalysis.",
        )
        # No allowed_merchant_ids: the pending-rewrite and name-match
        # fallbacks in ingest_sol are structurally disabled for this strict
        # path, so a bad member ID can only skip — and the persisted-count
        # check below fails the transaction instead of guessing an owner.
        tasks_created = ingest_sol(
            db,
            run_id,
            parsed,
            round_no,
        )
        if tasks_created:
            raise ReanalysisError("targeted reanalysis unexpectedly created verification tasks")
        persisted = db.query_one(
            "SELECT COUNT(*) AS n FROM merchant_analyses WHERE run_id=?",
            (run_id,),
        )
        persisted_count = int(persisted["n"] if persisted else 0)
        if persisted_count != len(requested_ids):
            raise ReanalysisError(
                f"targeted reanalysis persisted {persisted_count} analyses; "
                f"expected {len(requested_ids)}"
            )

    return ReanalysisResult(
        run_id=run_id,
        round_no=round_no,
        merchant_ids=requested_ids,
        analyses_persisted=persisted_count,
    )
