"""Deterministic OMP stand-in for scheduler / parse / resume tests."""

import json
import re
from typing import Any
import re

from merchant_intel.omp.client import AgentRequest, AgentResult, OmpError
from merchant_intel.omp.events import Usage
from merchant_intel.omp.client import AgentRequest, AgentResult, OmpError
from merchant_intel.omp.events import Usage
from merchant_intel.omp.models import (
    CODEX_PROVIDER,
    GEMINI_PROVIDER,
    resolve_all_roles,
)
from merchant_intel.omp.probe import OmpCapabilities

MOCK_CATALOG = [
    f"{GEMINI_PROVIDER}/gemini-3.7-flash",
    f"{CODEX_PROVIDER}/gpt-5.6-sol",
    f"{CODEX_PROVIDER}/gpt-5.6-luna",
    "opencode-go/hy3",
    "openai/gpt-4o",
]


class MockOmpClient:
    def __init__(
        self,
        hints: dict[str, str] | None = None,
        *,
        fail_names: set[str] | None = None,
        catalog: list[str] | None = None,
        gemini_provider: str = GEMINI_PROVIDER,
        gpt_provider: str = CODEX_PROVIDER,
        shared_provider: str | None = None,
        allow_fallback: bool = False,
    ) -> None:
        self.hints = hints or {
            "discovery": f"{GEMINI_PROVIDER}/gemini-3.7-flash",
            "coordinator": f"{GEMINI_PROVIDER}/gemini-3.7-flash",
            "analyst": f"{CODEX_PROVIDER}/gpt-5.6-sol",
            "verifier": f"{CODEX_PROVIDER}/gpt-5.6-luna",
        }
        self.catalog = list(catalog or MOCK_CATALOG)
        self.fail_names = fail_names or set()
        self.gemini_provider = gemini_provider
        self.gpt_provider = gpt_provider
        self.shared_provider = shared_provider
        self.allow_fallback = allow_fallback
        self.allow_fallback = allow_fallback
        self.resolved_models: dict[str, str] = {}
        self.calls: list[AgentRequest] = []
        self.caps = OmpCapabilities(
            binary="omp-mock",
            version="mock",
            help_text=(
                "mock -p --mode json --model --session-dir --resume --continue "
                "--thinking --auto-approve --no-context-files --no-tools --no-session "
                "--max-time"
            ),
            flags=frozenset(
                {
                    "--mode",
                    "--model",
                    "--session-dir",
                    "--resume",
                    "--continue",
                    "--thinking",
                    "--auto-approve",
                    "--no-tools",
                    "--no-session",
                    "--max-time",
                }
            ),
            short_flags=frozenset({"p", "r", "c"}),
            supports_print=True,
            supports_json_mode=True,
            supports_resume=True,
            supports_continue=True,
            supports_session_dir=True,
            supports_no_session=True,
            supports_thinking=True,
            supports_no_tools=True,
            supports_tools=True,
            supports_exclude_tools=True,
            supports_auto_approve=True,
            supports_no_pty=True,
            supports_no_extensions=True,
            supports_no_skills=True,
            supports_no_rules=True,
            supports_max_time=True,
            models_invocation=("models", "--json"),
            raw_model_listing="\n".join(self.catalog),
        )

    async def probe(self) -> OmpCapabilities:
        return self.caps

    async def list_models(self) -> list[str]:
        return list(self.catalog)
        self.resolved_models = resolve_all_roles(
            self.hints,
            self.catalog,
            gemini_provider=self.gemini_provider,
            gpt_provider=self.gpt_provider,
            shared_provider=self.shared_provider,
            allow_fallback=self.allow_fallback,
        )
        return self.resolved_models

    def model_for_role(self, role: str) -> str:
        return self.resolved_models[role]

    async def run(self, request: AgentRequest) -> AgentResult:
        self.calls.append(request)
        session_id = request.session_id or f"mock-{request.name}"
        argv = ["omp-mock", "-p", "--mode", "json", "--model", request.model]
        if request.name in self.fail_names:
            return AgentResult(
                ok=False,
                session_id=session_id,
                model=request.model,
                text="",
                payload=None,
                usage=Usage(),
                argv=argv,
                stdout="",
                stderr="simulated provider timeout",
                returncode=124,
                error="simulated provider timeout",
            )
        if request.name in self.malformed_names:
            return AgentResult(
                ok=False,
                session_id=session_id,
                model=request.model,
                text="this is not json at all",
                payload=None,
                usage=Usage(output_tokens=12, model=request.model),
                argv=argv,
                stdout="this is not json at all",
                stderr="",
                returncode=0,
                error="json extract failed",
            )
        payload = _payload_for(request)
        text = json.dumps(payload, ensure_ascii=False)
        return AgentResult(
            ok=True,
            session_id=session_id,
            model=request.model,
            text=text,
            payload=payload,
            usage=Usage(input_tokens=800, output_tokens=400, model=request.model),
            argv=argv,
            stdout=text,
            stderr="",
            returncode=0,
        )

    async def close(self) -> None:
        return None

    async def kill(self, session_id: str) -> None:
        return None


def _payload_for(request: AgentRequest) -> dict[str, Any]:
    role = request.role
    if role == "discovery":
        return _discovery_payload(request)
    if role == "coordinator":
        return {
            "continue_research": False,
            "ready_for_analysis": True,
            "dataset_foundation_ready": True,
            "unique_merchants": 12,
            "identity_resolution_rate": 0.7,
            "source_diversity_score": 0.6,
            "evidence_diversity": {"positive": 8, "negative": 4, "neutral": 3},
            "geographic_notes": "Cairo, Giza, Alexandria, Mansoura",
            "category_notes": "electronics, gaming, mobile, repair",
            "freshness_notes": "mostly 2025-2026",
            "reliability_notes": "mixed; several invoice-backed purchases",
            "duplication_notes": "reposts detected and collapsed",
            "contradictions": [],
            "gaps": [],
            "recommended_next_searches": [],
            "diminishing_returns": False,
            "rationale": "Mock dataset meets foundation thresholds.",
        }
    if role == "analyst":
        return _analyst_payload(request)
    if role == "verifier":
        return _verifier_payload(request)
    raise OmpError(f"unknown mock role {role}")


def _discovery_payload(request: AgentRequest) -> dict[str, Any]:
    slug = request.name.replace(" ", "-")
    city = "Cairo"
    lowered = request.prompt.lower()
    if "alexandria" in lowered:
        city = "Alexandria"
    elif "giza" in lowered:
        city = "Giza"
    elif "mansoura" in lowered:
        city = "Mansoura"
    name = f"Mock Store {slug[-12:]}"
    return {
        "agent_id": request.name,
        "assignment": request.name,
        "search_terms_used": ["متجر الكترونيات مصر", "egypt pc store review"],
        "records": [
            {
                "merchant_candidate": {
                    "canonical_name": name,
                    "aliases": [name + " EG"],
                    "category": "electronics",
                    "city": city,
                    "governorate": city,
                    "identifiers": {
                        "phones": ["+201001234567"],
                        "websites": [f"https://example.com/{slug}"],
                        "facebook": [f"https://facebook.com/{slug}"],
                        "instagram": [],
                        "tiktok": [],
                        "marketplaces": [],
                        "addresses": [f"{city}, Egypt"],
                        "emails": [f"{slug}@example.com"],
                        "whatsapp": ["+201001234567"],
                        "google_maps": [f"https://maps.google.com/?q={slug}"],
                        "commercial_register": [],
                    },
                },
                "evidence": {
                    "source_url": f"https://example.com/reviews/{slug}",
                    "source_platform": "web",
                    "source_type": "review",
                    "author_type": "customer",
                    "claim_type": "successful_purchase",
                    "summary": f"Customer reported a completed laptop purchase from {name} with invoice.",
                    "sentiment": "positive",
                    "transaction_evidence": True,
                    "supporting_artifacts": [],
                    "confidence": 0.72,
                    "reliability_band": "strong",
                    "language": "en",
                    "raw_quote": "Bought a laptop, got serial and receipt.",
                    "merchant_identifier_used": "+201001234567",
                },
            },
            {
                "merchant_candidate": {
                    "canonical_name": name,
                    "aliases": [],
                    "category": "electronics",
                    "city": city,
                    "governorate": city,
                    "identifiers": {
                        "phones": ["+201001234567"],
                        "websites": [f"https://example.com/{slug}"],
                        "facebook": [],
                        "instagram": [],
                        "tiktok": [],
                        "marketplaces": [],
                        "addresses": [],
                        "emails": [],
                        "whatsapp": [],
                        "google_maps": [],
                        "commercial_register": [],
                    },
                },
                "evidence": {
                    "source_url": f"https://reddit.com/r/Egypt/comments/{slug}",
                    "source_platform": "reddit",
                    "source_type": "forum",
                    "author_type": "customer",
                    "claim_type": "delayed_delivery",
                    "summary": f"One Reddit user said {name} delivered a GPU five days late, then resolved it.",
                    "sentiment": "neutral",
                    "transaction_evidence": False,
                    "supporting_artifacts": [],
                    "confidence": 0.41,
                    "reliability_band": "medium",
                    "language": "en",
                    "raw_quote": "Came late but they answered WhatsApp.",
                    "merchant_identifier_used": name,
                },
            },
        ],
        "coverage_notes": "mock discovery",
        "blocked_or_inaccessible": [],
    }


def _analyst_payload(request: AgentRequest) -> dict[str, Any]:
    return {
        "merchants": [
            {
                "merchant_id": "pending",
                "identity_confidence": 0.8,
                "evidence_summary": {
                    "total_items": 2,
                    "positive": 1,
                    "negative": 0,
                    "neutral": 1,
                },







                "verification_tasks": []
                if "sol-review" in request.name
                else [
                    {
                        "task_id": f"task-{request.name}-1",
                        "merchant_id": "pending",
                        "title": "Confirm website ownership",
                        "instruction": (
                            "Find independent evidence that the listed website belongs "
                            "to this merchant. Do not reuse the original review URL."
                        ),
                        "already_used_sources": [],
                        "target_identifiers": [],
                        "claim_ids": [],
                        "priority": "medium",
                    }
                ],






            }
        ],


    }
def _verifier_payload(request: AgentRequest) -> dict[str, Any]:
    task_ids = [
        value
        for value in re.findall(r'"task_id"\s*:\s*"([^"]*)"', request.prompt)
        if value
    ]
    if not task_ids:
        task_ids = ["task-mock-1"]
    findings: list[dict[str, Any]] = []
    for task_id in task_ids:
        findings.append(
            {
                "task_id": task_id,
                "merchant_id": "pending",
                "supported": True,
                "contradicted": False,
                "still_unresolved": False,
                "summary": "Independent marketplace listing uses the same phone number.",
                "evidence": [
                    {
                        "source_url": f"https://example.com/independent-listing/{task_id}",
                        "source_platform": "marketplace",
                        "source_type": "marketplace",
                        "author_type": "merchant",
                        "claim_type": "verified_business_information",
                        "summary": "Marketplace profile lists the same phone and trade name.",
                        "sentiment": "neutral",
                        "transaction_evidence": False,
                        "supporting_artifacts": [],
                        "confidence": 0.66,
                        "reliability_band": "medium",
                        "language": "en",
                        "raw_quote": "Contact: 01001234567",
                        "merchant_identifier_used": "+201001234567",
                    }
                ],
                "identity_match_confidence": 0.74,
                "notes": "Did not reuse the original review URL.",
            }
        )
    return {"agent_id": request.name, "findings": findings}
