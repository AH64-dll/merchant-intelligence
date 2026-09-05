"""Cited-brief generation with fail-closed model pinning and review.

Phase 3 writer entry. Drafts a merchant brief through the project's own OMP
client path (exactly how ``reanalysis.py`` invokes the model), reviews it
with the pinned verifier model, and writes the brief only when BOTH the
deterministic validator and the review model accept it.

Provider pins come from ``config.yaml`` ``models.analyst`` (Gemini drafting)
and ``models.verifier`` (Luna review); no provider plumbing is invented
here and no fallback model is ever used. The function is idempotent,
resumable, bounded to the supplied merchant ids, and never mutates
sources/evidence/claims. Writes happen only when ``apply=True`` and
``dry_run=False``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Sequence

from merchant_intel.config import AppConfig
from merchant_intel.database import Database
from merchant_intel.omp.client import AgentRequest, OmpTransport
from merchant_intel.presentation import (
    MerchantPresentationPackage,
    build_presentation_package,
    evidence_set_hash,
    package_as_dict,
    validate_brief_payload,
)

log = logging.getLogger("merchant_intel.briefs")

__all__ = [
    "BriefOutcome",
    "generate_briefs",
    "MAX_PACKAGE_JSON_BYTES",
    "stale_brief_merchant_ids",
    "upsert_brief",
]

BRIEF_GOAL = (
    "Write a short, source-traceable Arabic seller brief from the supplied "
    "evidence package only. Never invent facts, never issue a public trust "
    "score or verdict."
)

# Schema contract given to both models. The deterministic validator enforces
# the same shape, so a model that ignores it cannot reach the database.
BRIEF_SCHEMA_HINT = """{
  "identity_message": {"text": str, "evidence_ids": [str], "certainty": "identified"|"partial"|"unverified"},
  "reputation_message": {"text": str, "evidence_ids": [str]},
  "bullets": [{"text": str, "evidence_ids": [str]}],
  "unknowns": [{"text": str, "evidence_ids": [str]}]
}"""

# Linux argv limit is ~2MB total but the safe budget for a single embedded
# JSON blob plus omp's own flags is far lower; 96KB keeps prompts comfortably
# inside limits while covering every package except one known outlier.
MAX_PACKAGE_JSON_BYTES = 96 * 1024


@dataclass
class BriefOutcome:
    """Per-merchant result of one generate_briefs call."""

    merchant_id: str
    status: str  # fresh | drafted | rejected | skipped
    reason: str = ""
    evidence_set_hash: str = ""
    violations: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "merchant_id": self.merchant_id,
            "status": self.status,
            "reason": self.reason,
            "evidence_set_hash": self.evidence_set_hash,
            "violations": list(self.violations),
        }



def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_brief(
    db: Database,
    merchant_id: str,
    evidence_set_hash_value: str,
    payload: dict,
    model: str,
    reviewed_at: str | None,
) -> None:
    """Insert or replace the merchant_briefs row for one merchant.

    The caller must own the write decision (validation already passed); this
    function only performs the INSERT ... ON CONFLICT upsert.
    """
    db.execute(
        """INSERT INTO merchant_briefs
               (merchant_id, evidence_set_hash, payload_json, generated_at, model, reviewed_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(merchant_id) DO UPDATE SET
               evidence_set_hash=excluded.evidence_set_hash,
               payload_json=excluded.payload_json,
               generated_at=excluded.generated_at,
               model=excluded.model,
               reviewed_at=excluded.reviewed_at""",
        (
            merchant_id,
            evidence_set_hash_value,
            json.dumps(payload, ensure_ascii=False, sort_keys=True),
            _utc_now_iso(),
            model,
            reviewed_at,
        ),
    )


def stale_brief_merchant_ids(db: Database, limit: int | None = None) -> list[str]:
    """Merchants whose stored brief hash is missing or differs from the hash
    of their current eligible evidence. Computed deterministically, bounded
    by ``limit`` when given."""
    if limit is not None and limit <= 0:
        return []
    merchant_rows = db.query("SELECT id FROM merchants ORDER BY id")
    stale: list[str] = []
    for row in merchant_rows:
        merchant_id = str(row["id"])
        pkg = build_presentation_package(db, merchant_id)
        if pkg is None:
            continue
        current = evidence_set_hash(pkg)
        brief = db.query_one(
            "SELECT evidence_set_hash FROM merchant_briefs WHERE merchant_id=?",
            (merchant_id,),
        )
        if brief is None or str(brief["evidence_set_hash"]) != current:
            stale.append(merchant_id)
            if limit is not None and len(stale) >= limit:
                break
    return stale

def _draft_prompt(pkg: MerchantPresentationPackage) -> str:
    from merchant_intel.presentation import identity_certainty_boundary

    package_json = json.dumps(package_as_dict(pkg), ensure_ascii=False, sort_keys=True)
    certainty = identity_certainty_boundary(pkg)
    return f"""OBJECTIVE
{BRIEF_GOAL}

OUTPUT LANGUAGE
Arabic (the reader is an Arabic-speaking buyer). Evidence IDs stay exactly as supplied.

STRICT RULES
- Use ONLY the facts in the supplied package. Never invent facts, dates, or quotes.
- Bind every statement to one or more of the supplied evidence IDs via "evidence_ids".
- Use the exact uncertainty wording the package supports; do not overstate certainty.
- Never output a numeric score, percentage, or rating.
- Never use verdict words such as مضمون، موثوق، غير موثوق.
- Do not mention source-only or duplicate record counts as proof of anything.
- Return ONLY JSON matching this schema, with no markdown or commentary:
{BRIEF_SCHEMA_HINT}

Constraints: at most 6 bullets; unknowns may be [] but every other evidence_ids
list must be non-empty and reference supplied root evidence IDs only.
identity_message.certainty MUST be exactly "{certainty}" for this merchant
(the deterministic validator enforces this conservative boundary).

MERCHANT PACKAGE
merchant_id={pkg.merchant_id}

{package_json}
"""


def _review_prompt(pkg: MerchantPresentationPackage, payload: dict) -> str:
    package_json = json.dumps(package_as_dict(pkg), ensure_ascii=False, sort_keys=True)
    payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    allowed_ids = sorted(ref.evidence_id for ref in pkg.root_evidence)
    return f"""OBJECTIVE
Review the Arabic seller brief below against the supplied merchant package.

CHECK, in order:
1. Citation coverage: every statement's "evidence_ids" cites only IDs from the
   allowed root evidence list, and every material statement is cited.
2. Identity attribution: "identity_message.certainty" is consistent with the
   conservative identity boundary derivable from the package's identifiers.
3. Uncertainty language: the brief does not overstate certainty and contains
   no numeric score, percentage, or verdict word (مضمون، موثوق، غير موثوق).
4. Schema: exactly the requested JSON shape; at most 6 bullets.

Return ONLY JSON: {{"ok": true|false, "issues": ["…"]}}
"ok" is false when any check fails; list each failure concisely in "issues".

ALLOWED EVIDENCE IDS
{json.dumps(allowed_ids, ensure_ascii=False)}

MERCHANT PACKAGE
merchant_id={pkg.merchant_id}

{package_json}

BRIEF UNDER REVIEW
{payload_json}
"""


def _payload_from_result(result: Any) -> dict | None:
    """Extract the brief object from an AgentResult-like payload."""
    payload = getattr(result, "payload", None)
    if isinstance(payload, dict):
        # The OMP adapter already extracted the JSON object from the reply.
        if "identity_message" in payload:
            return payload
        # Some sessions wrap the answer in a single-key envelope.
        for value in payload.values():
            if isinstance(value, dict) and "identity_message" in value:
                return value
    return None


def _review_verdict(result: Any) -> tuple[bool, list[str]]:
    payload = getattr(result, "payload", None)
    if not isinstance(payload, dict) or "ok" not in payload:
        return False, ["reviewer returned an unreadable verdict"]
    issues = payload.get("issues")
    if not isinstance(issues, list) or not all(isinstance(item, str) for item in issues):
        issues = ["reviewer issues list was malformed"]
    return bool(payload.get("ok")), list(issues)


def _prompt_exceeds_argv_limit(prompt: str) -> bool:
    """True when a prompt is too large to pass safely as an omp argv."""
    return len(prompt.encode("utf-8")) > MAX_PACKAGE_JSON_BYTES


def _prompt_file_transport(content: str) -> str:
    """Persist a prompt to a temp file and return the file path.

    OMP expands a message argument starting with ``@`` by reading the
    referenced file, which keeps the spawned argv short regardless of
    prompt size. The caller owns deleting the returned file.
    """
    fd, path = tempfile.mkstemp(prefix="brief-prompt-", suffix=".md")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(content)
    return path


def _unlink_quietly(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        log.debug("could not remove prompt file %s", path, exc_info=True)


async def generate_briefs(
    db: Database,
    merchant_ids: Sequence[str],
    *,
    apply: bool = False,
    dry_run: bool = True,
    cfg: AppConfig | None = None,
    client: OmpTransport | None = None,
) -> dict[str, Any]:
    """Draft, review, and (when enabled) persist cited briefs.

    Per merchant: build the package, hash the evidence set, skip merchants
    whose stored brief hash already matches (fresh), otherwise draft with the
    pinned analyst model and review with the pinned verifier model. A brief
    is written only when the deterministic validator reports no violations
    AND the reviewer accepts. Rejected briefs are never written and the
    merchant simply stays stale (pending) — resumable by re-running.

    ``dry_run=True`` wins over ``apply=True``: nothing is written. Model
    calls only happen when a brief would be drafted (not for fresh
    merchants), and never for merchants outside the supplied ids.

    ``cfg``/``client`` are injectable for tests and embedding callers; when
    omitted, the config is loaded from ``config.yaml`` (cwd) and the real
    :class:`OmpClient` is constructed — the same client path reanalysis.py
    uses. No subprocess omp call is made outside that transport.
    """
    if cfg is None:
        cfg = load_config()
    if client is None:
        from merchant_intel.omp.client import OmpClient

        client = OmpClient(cfg)
    write = bool(apply) and not bool(dry_run)
    requested = [str(merchant_id).strip() for merchant_id in merchant_ids if str(merchant_id).strip()]
    outcomes: list[BriefOutcome] = []

    catalog = await client.list_models()
    draft_model = cfg.models.analyst
    review_model = cfg.models.verifier
    for model in (draft_model, review_model):
        if model not in catalog:
            raise RuntimeError(
                f"required brief model {model!r} is unavailable; refusing provider fallback"
            )

    run_token = uuid.uuid4().hex[:12]
    for index, merchant_id in enumerate(requested):
        pkg = build_presentation_package(db, merchant_id)
        if pkg is None:
            outcomes.append(BriefOutcome(merchant_id, "skipped", "merchant not found"))
            continue

        current_hash = evidence_set_hash(pkg)
        brief_row = db.query_one(
            "SELECT evidence_set_hash FROM merchant_briefs WHERE merchant_id=?",
            (merchant_id,),
        )
        if brief_row is not None and str(brief_row["evidence_set_hash"]) == current_hash:
            outcomes.append(BriefOutcome(merchant_id, "fresh", evidence_set_hash=current_hash))
            continue

        draft_prompt = _draft_prompt(pkg)
        draft_file: str | None = None
        if _prompt_exceeds_argv_limit(draft_prompt):
            # The package is too large for the OS argv limit; ship the
            # prompt via an ``@file`` reference instead of skipping.
            draft_file = _prompt_file_transport(draft_prompt)
            draft_prompt = f"@{draft_file}"
        name = f"brief-draft-{run_token}-{index}"
        try:
            draft_result = await client.run(
                AgentRequest(
                    prompt=draft_prompt,
                    model=draft_model,
                    name=name,
                    role="analyst",
                    goal=BRIEF_GOAL,
                    workspace_id=name,
                    timeout_sec=cfg.omp.analysis_timeout_sec,
                )
            )
        finally:
            if draft_file:
                _unlink_quietly(draft_file)
        if not draft_result.ok:
            outcomes.append(
                BriefOutcome(
                    merchant_id,
                    "rejected",
                    f"draft provider call failed: {draft_result.error or 'unknown error'}",
                    evidence_set_hash=current_hash,
                )
            )
            continue
        if draft_result.model != draft_model:
            outcomes.append(
                BriefOutcome(
                    merchant_id,
                    "rejected",
                    f"draft returned from {draft_result.model!r}; refusing fallback result",
                    evidence_set_hash=current_hash,
                )
            )
            continue
        payload = _payload_from_result(draft_result)
        if payload is None:
            outcomes.append(
                BriefOutcome(
                    merchant_id,
                    "rejected",
                    "draft did not return the brief JSON object",
                    evidence_set_hash=current_hash,
                )
            )
            continue

        violations = validate_brief_payload(payload, pkg)
        if violations:
            outcomes.append(
                BriefOutcome(
                    merchant_id,
                    "rejected",
                    "deterministic validator rejected the draft",
                    evidence_set_hash=current_hash,
                    violations=violations,
                )
            )
            continue

        review_name = f"brief-review-{run_token}-{index}"
        review_prompt = _review_prompt(pkg, payload)
        review_file: str | None = None
        if _prompt_exceeds_argv_limit(review_prompt):
            review_file = _prompt_file_transport(review_prompt)
            review_prompt = f"@{review_file}"
        try:
            review_result = await client.run(
                AgentRequest(
                    prompt=review_prompt,
                    model=review_model,
                    name=review_name,
                    role="verifier",
                    goal=BRIEF_GOAL,
                    workspace_id=review_name,
                    timeout_sec=cfg.omp.analysis_timeout_sec,
                )
            )
        finally:
            if review_file:
                _unlink_quietly(review_file)
        if not review_result.ok:
            outcomes.append(
                BriefOutcome(
                    merchant_id,
                    "rejected",
                    f"review provider call failed: {review_result.error or 'unknown error'}",
                    evidence_set_hash=current_hash,
                )
            )
            continue
        if review_result.model != review_model:
            outcomes.append(
                BriefOutcome(
                    merchant_id,
                    "rejected",
                    f"review returned from {review_result.model!r}; refusing fallback result",
                    evidence_set_hash=current_hash,
                )
            )
            continue
        reviewer_ok, reviewer_issues = _review_verdict(review_result)
        if not reviewer_ok:
            outcomes.append(
                BriefOutcome(
                    merchant_id,
                    "rejected",
                    "reviewer rejected the brief",
                    evidence_set_hash=current_hash,
                    violations=reviewer_issues,
                )
            )
            continue

        if write:
            upsert_brief(
                db,
                merchant_id,
                current_hash,
                payload,
                draft_model,
                _utc_now_iso(),
            )
            outcomes.append(BriefOutcome(merchant_id, "drafted", evidence_set_hash=current_hash))
        else:
            outcomes.append(
                BriefOutcome(
                    merchant_id,
                    "skipped",
                    "dry run: validated brief not written",
                    evidence_set_hash=current_hash,
                )
            )

    return {
        "write": write,
        "requested": list(requested),
        "draft_model": draft_model,
        "review_model": review_model,
        "outcomes": [outcome.as_dict() for outcome in outcomes],
    }


def run_generate_briefs(
    db: Database,
    merchant_ids: Sequence[str],
    *,
    apply: bool = False,
    dry_run: bool = True,
    cfg: AppConfig | None = None,
    client: OmpTransport | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper around :func:`generate_briefs` for CLI callers."""
    return asyncio.run(
        generate_briefs(db, merchant_ids, apply=apply, dry_run=dry_run, cfg=cfg, client=client)
    )
