"""Pydantic contracts for agent I/O and the SQLite-backed dataset.

Public trust scores are intentionally absent. Agents may emit internal
evidence confidence, identity confidence, and qualitative states only.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Sentiment(StrEnum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"


class ClaimType(StrEnum):
    SUCCESSFUL_PURCHASE = "successful_purchase"
    PRODUCT_QUALITY = "product_quality"
    COUNTERFEIT_ALLEGATION = "counterfeit_product_allegation"
    NON_DELIVERY = "non_delivery"
    DELAYED_DELIVERY = "delayed_delivery"
    REFUND_ISSUE = "refund_issue"
    WARRANTY_ISSUE = "warranty_issue"
    AFTER_SALES_SUPPORT = "after_sales_support"
    INCORRECT_PRODUCT = "incorrect_product"
    PRICING_ISSUE = "pricing_issue"
    PAYMENT_DISPUTE = "payment_dispute"
    COMMUNICATION_ISSUE = "communication_issue"
    REPEATED_RECOMMENDATION = "repeated_recommendation"
    OFFICIAL_WARNING = "official_warning"
    VERIFIED_BUSINESS_INFORMATION = "verified_business_information"
    IDENTITY_MISMATCH = "identity_mismatch"
    SUSPICIOUS_PAGE_CHANGES = "suspicious_page_changes"
    ACCOUNT_PAGE_DISAPPEARANCE = "account_page_disappearance"
    MERCHANT_RESPONSE = "merchant_response"
    COMPLAINT_RESOLVED = "complaint_resolved"
    COMPLAINT_UNRESOLVED = "complaint_unresolved"
    PHYSICAL_PRESENCE = "physical_presence"
    WARRANTY_HONORED = "warranty_honored"
    REFUND_ISSUED = "refund_issued"
    LONG_BUSINESS_HISTORY = "long_business_history"
    OTHER = "other"


class ReliabilityBand(StrEnum):
    WEAK = "weak"
    MEDIUM = "medium"
    STRONG = "strong"
    VERY_STRONG = "very_strong"


class MerchantState(StrEnum):
    VERIFIED_HIGH_CONFIDENCE = "VERIFIED_HIGH_CONFIDENCE"
    VERIFIED_MODERATE_CONFIDENCE = "VERIFIED_MODERATE_CONFIDENCE"
    MIXED_REPUTATION = "MIXED_REPUTATION"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    IDENTITY_UNCERTAIN = "IDENTITY_UNCERTAIN"
    HIGH_RISK_SIGNALS = "HIGH_RISK_SIGNALS"
    OFFICIAL_WARNING = "OFFICIAL_WARNING"
    REQUIRES_MANUAL_REVIEW = "REQUIRES_MANUAL_REVIEW"


class AuthorType(StrEnum):
    CUSTOMER = "customer"
    MERCHANT = "merchant"
    JOURNALIST = "journalist"
    REGULATOR = "regulator"
    REGISTRY = "registry"
    ANONYMOUS = "anonymous"
    UNKNOWN = "unknown"


class GapType(StrEnum):
    MERCHANT_COVERAGE = "merchant_coverage"
    SOURCE_DIVERSITY = "source_diversity"
    POSITIVE_EVIDENCE = "positive_evidence"
    NEGATIVE_EVIDENCE = "negative_evidence"
    GEOGRAPHIC_COVERAGE = "geographic_coverage"
    CATEGORY_COVERAGE = "category_coverage"
    IDENTITY_QUALITY = "identity_quality"
    FRESHNESS = "freshness"
    RELIABILITY = "reliability"
    INDEPENDENT_CORROBORATION = "independent_corroboration"
    OTHER = "other"


FORBIDDEN_LABELS = ("scammer", "scam", "fraudster", "criminal", "thief")


def _reject_forbidden_labels(value: str) -> str:
    lowered = value.lower()
    for word in FORBIDDEN_LABELS:
        if word in lowered.split():
            raise ValueError(
                f"automatic defamatory label {word!r} is forbidden; "
                "describe reports, not verdicts"
            )
    return value
def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return "; ".join(f"{key}={item}" for key, item in value.items())
    if isinstance(value, list):
        return "; ".join(_stringify(item) for item in value)
    return str(value)


def _as_confidence(value: Any) -> float:
    if isinstance(value, dict):
        for key in ("score", "confidence", "value", "identity_confidence", "evidence_confidence"):
            if key in value:
                value = value[key]
                break
    try:
        return max(0.0, min(1.0, float(value or 0.0)))
    except (TypeError, ValueError):
        return 0.0


class Identifiers(BaseModel):
    phones: list[str] = Field(default_factory=list)
    websites: list[str] = Field(default_factory=list)
    facebook: list[str] = Field(default_factory=list)
    instagram: list[str] = Field(default_factory=list)
    tiktok: list[str] = Field(default_factory=list)
    marketplaces: list[str] = Field(default_factory=list)
    addresses: list[str] = Field(default_factory=list)
    emails: list[str] = Field(default_factory=list)
    whatsapp: list[str] = Field(default_factory=list)
    google_maps: list[str] = Field(default_factory=list)
    commercial_register: list[str] = Field(default_factory=list)


class MerchantCandidate(BaseModel):
    canonical_name: str
    aliases: list[str] = Field(default_factory=list)
    category: str = ""
    city: str = ""
    governorate: str = ""
    identifiers: Identifiers = Field(default_factory=Identifiers)


class EvidenceItem(BaseModel):
    source_url: str
    source_platform: str
    source_type: str = ""
    captured_at: datetime | None = None
    published_at: datetime | None = None
    author_type: AuthorType = AuthorType.UNKNOWN
    claim_type: ClaimType = ClaimType.OTHER
    summary: str
    sentiment: Sentiment
    transaction_evidence: bool = False
    supporting_artifacts: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    reliability_band: ReliabilityBand = ReliabilityBand.WEAK
    language: str = ""
    raw_quote: str = ""
    merchant_identifier_used: str = ""

    @model_validator(mode="before")
    @classmethod
    def normalize_source_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        data["source_url"] = _stringify(data.get("source_url") or data.get("url") or data.get("link") or "")
        data["source_platform"] = _stringify(
            data.get("source_platform") or data.get("platform") or data.get("source_type") or "web"
        )
        data["source_type"] = _stringify(data.get("source_type") or data.get("type") or "unknown")
        data["summary"] = _stringify(
            data.get("summary")
            or data.get("claim")
            or data.get("description")
            or data.get("text")
            or "Source cited without a model-supplied summary."
        )
        sentiment = str(data.get("sentiment") or data.get("tone") or "neutral").lower()
        data["sentiment"] = sentiment if sentiment in {item.value for item in Sentiment} else "neutral"
        claim_type = str(data.get("claim_type") or data.get("type") or "other").lower()
        data["claim_type"] = claim_type if claim_type in {item.value for item in ClaimType} else "other"
        author = str(data.get("author_type") or "unknown").lower()
        data["author_type"] = author if author in {item.value for item in AuthorType} else "unknown"
        band = str(data.get("reliability_band") or data.get("reliability") or "weak").lower()
        band_aliases = {"low": "weak", "moderate": "medium", "high": "strong", "very_high": "very_strong"}
        data["reliability_band"] = band_aliases.get(band, band if band in {item.value for item in ReliabilityBand} else "weak")
        data["confidence"] = _as_confidence(data.get("confidence", 0.0))
        artifacts = data.get("supporting_artifacts") or data.get("artifacts") or []
        data["supporting_artifacts"] = artifacts if isinstance(artifacts, list) else [artifacts]
        data["raw_quote"] = _stringify(data.get("raw_quote") or data.get("quote") or "")
        data["merchant_identifier_used"] = _stringify(data.get("merchant_identifier_used") or "")
        for key in ("captured_at", "published_at"):
            raw_date = data.get(key)
            if raw_date and isinstance(raw_date, str):
                try:
                    datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
                except ValueError:
                    data[key] = None
        return data

    @field_validator("supporting_artifacts", mode="before")
    @classmethod
    def normalize_artifacts(cls, values: Any) -> list[str]:
        if values is None:
            return []
        if not isinstance(values, list):
            values = [values]
        return [_stringify(value) for value in values]

    @field_validator("source_url")
    @classmethod
    def url_required(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("source_url is mandatory; never drop provenance")
        return value.strip()

    @field_validator("summary")
    @classmethod
    def no_verdict_words(cls, value: str) -> str:
        return _reject_forbidden_labels(value)

    @model_validator(mode="after")
    def band_matches_confidence(self) -> EvidenceItem:
        if self.reliability_band is ReliabilityBand.WEAK and self.confidence > 0.39:
            self.reliability_band = ReliabilityBand.MEDIUM
        if self.confidence >= 0.75:
            self.reliability_band = ReliabilityBand.STRONG
        if self.confidence >= 0.92:
            self.reliability_band = ReliabilityBand.VERY_STRONG
        return self


class DiscoveryRecord(BaseModel):
    merchant_candidate: MerchantCandidate
    evidence: EvidenceItem
    notes: str = ""


class DiscoveryAgentOutput(BaseModel):
    agent_id: str
    assignment: str
    search_terms_used: list[str] = Field(default_factory=list)
    records: list[DiscoveryRecord] = Field(default_factory=list)
    coverage_notes: str = ""
    blocked_or_inaccessible: list[str] = Field(default_factory=list)

class ResearchGap(BaseModel):
    type: GapType
    description: str
    recommended_next_searches: list[str] = Field(default_factory=list)

    @field_validator("type", mode="before")
    @classmethod
    def normalize_type(cls, value: Any) -> GapType | str:
        if isinstance(value, GapType):
            return value
        raw = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
        aliases = {
            "geographic_expansion": GapType.GEOGRAPHIC_COVERAGE,
            "category_diversification": GapType.CATEGORY_COVERAGE,
            "multi_source_corroboration": GapType.INDEPENDENT_CORROBORATION,
            "temporal_metadata": GapType.FRESHNESS,
            "dispute_and_negative_signal_balance": GapType.NEGATIVE_EVIDENCE,
        }
        return aliases.get(raw, GapType(raw) if raw in {item.value for item in GapType} else GapType.OTHER)


class CoordinatorJudgement(BaseModel):
    continue_research: bool
    ready_for_analysis: bool
    dataset_foundation_ready: bool
    unique_merchants: int
    identity_resolution_rate: float
    source_diversity_score: float
    evidence_diversity: dict[str, int] = Field(default_factory=dict)
    geographic_notes: str = ""
    category_notes: str = ""
    freshness_notes: str = ""
    reliability_notes: str = ""
    duplication_notes: str = ""
    contradictions: list[str] = Field(default_factory=list)
    gaps: list[ResearchGap] = Field(default_factory=list)
    recommended_next_searches: list[str] = Field(default_factory=list)
    diminishing_returns: bool = False
    rationale: str = ""

    @field_validator("contradictions", mode="before")
    @classmethod
    def stringify_contradictions(cls, values: Any) -> list[str]:
        if not isinstance(values, list):
            return [_stringify(values)]
        return [_stringify(value) for value in values]


class VerificationTask(BaseModel):
    task_id: str = ""
    merchant_id: str = "pending"
    title: str = ""
    instruction: str = ""
    already_used_sources: list[str] = Field(default_factory=list)
    target_identifiers: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)
    priority: Literal["low", "medium", "high", "critical"] = "medium"

    @model_validator(mode="before")
    @classmethod
    def normalize_task(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        data.setdefault("task_id", data.get("id") or data.get("key") or "")
        data.setdefault("merchant_id", data.get("merchant") or "pending")
        data.setdefault("title", data.get("question") or data.get("task") or data.get("name") or "")
        data.setdefault(
            "instruction",
            data.get("query") or data.get("description") or data.get("request") or data.get("task") or "",
        )
        data.setdefault(
            "already_used_sources",
            data.get("excluded_sources") or data.get("source_exclusions") or [],
        )
        priority = str(data.get("priority", "medium")).lower()
        data["priority"] = "critical" if priority in {"urgent", "critical"} else priority if priority in {"low", "medium", "high"} else "medium"
        if not data["task_id"]:
            seed = f"{data.get('merchant_id')}|{data.get('title')}|{data.get('instruction')}"
            data["task_id"] = "task-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
        return data

    @field_validator("task_id", "merchant_id", "title", "instruction", mode="before")
    @classmethod
    def stringify_task_fields(cls, value: Any) -> str:
        return _stringify(value)

    @field_validator("already_used_sources", "target_identifiers", "claim_ids", mode="before")
    @classmethod
    def normalize_string_list(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            value = [value]
        return [_stringify(item) for item in value]

class MerchantAnalysis(BaseModel):
    payload_version: Literal[1] = 1
    merchant_id: str = "pending"
    merchant_name: str = ""
    identity_confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    identity_confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    evidence_summary: dict[str, Any] = Field(default_factory=dict)
    source_diversity: float = Field(ge=0.0, le=1.0, default=0.0)
    verified_claims: list[str] = Field(default_factory=list)
    unverified_claims: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    risk_signals: list[str] = Field(default_factory=list)
    positive_signals: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    requires_more_research: bool = False
    verification_tasks: list[VerificationTask] = Field(default_factory=list)
    internal_state: MerchantState = MerchantState.INSUFFICIENT_DATA
    evidence_confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    reputation_notes: str = ""
    fraud_risk_notes: str = ""
    consumer_satisfaction_notes: str = ""

    @model_validator(mode="before")
    def normalize_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        aliases = {
            "merchant_id": ("id", "merchant"),
            "merchant_name": ("name", "canonical_name", "merchant_name"),
            "evidence_summary": ("evidence", "evidence_counts"),
            "source_diversity": ("source_diversity_score",),
            "risk_signals": ("risk_indicators",),
            "positive_signals": ("positive_indicators",),
            "missing_information": ("missing_data",),
            "verification_tasks": ("verification_questions", "verification"),
            "reputation_notes": ("reputation",),
            "fraud_risk_notes": ("fraud_risk", "risk_notes"),
            "consumer_satisfaction_notes": ("consumer_satisfaction", "satisfaction"),
        }
        for target, alternatives in aliases.items():
            if target not in data or data[target] is None:
                for alternative in alternatives:
                    if alternative in data and data[alternative] is not None:
                        data[target] = data[alternative]
                        break
        if not data.get("merchant_id"):
            data["merchant_id"] = "pending"
        return data

    @field_validator("identity_confidence", "source_diversity", "evidence_confidence", mode="before")
    @classmethod
    def normalize_confidence(cls, value: Any) -> float:
        if isinstance(value, dict) and "source_count" in value and "score" not in value:
            try:
                return min(1.0, float(value["source_count"]) / 3.0)
            except (TypeError, ValueError):
                return 0.0
        return _as_confidence(value)

    @field_validator("evidence_summary", mode="before")
    @classmethod
    def normalize_summary(cls, value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        return {"summary": _stringify(value)}

    @field_validator(
        "verified_claims",
        "unverified_claims",
        "contradictions",
        "risk_signals",
        "positive_signals",
        "missing_information",
        mode="before",
    )
    @classmethod
    def normalize_analysis_lists(cls, values: Any) -> list[str]:
        if values is None:
            return []
        if not isinstance(values, list):
            values = [values]
        return [_reject_forbidden_labels(_stringify(value)) for value in values]

    @field_validator("verification_tasks", mode="before")
    @classmethod
    def normalize_tasks(cls, values: Any) -> list[Any]:
        if values is None:
            return []
        return values if isinstance(values, list) else [values]

    @field_validator("internal_state", mode="before")
    @classmethod
    def normalize_state(cls, value: Any) -> MerchantState:
        raw = str(value or "").upper().replace("-", "_").replace(" ", "_")
        aliases = {
            "MIXED": MerchantState.MIXED_REPUTATION,
            "MANUAL_REVIEW": MerchantState.REQUIRES_MANUAL_REVIEW,
            "UNKNOWN": MerchantState.INSUFFICIENT_DATA,
        }
        if raw in aliases:
            return aliases[raw]
        try:
            return MerchantState(raw)
        except ValueError:
            return MerchantState.REQUIRES_MANUAL_REVIEW

    @field_validator(
        "merchant_name",
        "reputation_notes",
        "fraud_risk_notes",
        "consumer_satisfaction_notes",
        mode="before",
    )
    @classmethod
    def normalize_notes(cls, value: Any) -> str:
        return _stringify(value) if value is not None else ""



class SolRoundOutput(BaseModel):
    merchants: list[MerchantAnalysis] = Field(default_factory=list)
    dataset_notes: str = ""
    remaining_critical_uncertainties: int = 0

    @model_validator(mode="before")
    @classmethod
    def normalize_output(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        if "merchants" not in data:
            data["merchants"] = data.get("analyses") or data.get("merchant_analyses") or []
        if isinstance(data.get("remaining_critical_uncertainties"), list):
            data["remaining_critical_uncertainties"] = len(data["remaining_critical_uncertainties"])
        return data

class LunaFinding(BaseModel):
    task_id: str = ""
    merchant_id: str = "pending"
    supported: bool | None = None
    contradicted: bool | None = None
    still_unresolved: bool = False
    summary: str = ""
    evidence: list[EvidenceItem] = Field(default_factory=list)
    identity_match_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    notes: str = ""

    @model_validator(mode="before")
    @classmethod
    def normalize_finding(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        data.setdefault("task_id", data.get("id") or data.get("task") or "")
        data.setdefault("merchant_id", data.get("merchant") or "pending")
        data.setdefault(
            "summary",
            data.get("finding") or data.get("result") or data.get("conclusion") or "",
        )
        raw_evidence = data.get("evidence") or data.get("sources") or data.get("evidence_items") or []
        if not isinstance(raw_evidence, list):
            raw_evidence = [raw_evidence]
        # Keep citation stubs in the raw OMP artifact, but do not promote a
        # citation without a URL into provenance-bearing database evidence.
        data["evidence"] = [
            item
            for item in raw_evidence
            if isinstance(item, dict)
            and (item.get("source_url") or item.get("url") or item.get("link"))
        ]
        if not data.get("task_id"):
            data["task_id"] = "task-" + hashlib.sha1(
                _stringify(data).encode("utf-8")
            ).hexdigest()[:16]
        return data

    @field_validator("task_id", "merchant_id", "summary", "notes", mode="before")
    @classmethod
    def stringify_finding_fields(cls, value: Any) -> str:
        return _stringify(value)

    @field_validator("identity_match_confidence", mode="before")
    @classmethod
    def normalize_identity_confidence(cls, value: Any) -> float | None:
        return None if value is None else _as_confidence(value)


class LunaAgentOutput(BaseModel):
    agent_id: str = "unknown"
    findings: list[LunaFinding] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_output(cls, value: Any) -> Any:
        if isinstance(value, list):
            return {"findings": value}
        if not isinstance(value, dict):
            return value
        data = dict(value)
        if "findings" not in data:
            data["findings"] = data.get("verification_results") or data.get("results") or []
        return data


class QualityMetrics(BaseModel):
    unique_merchants: int = 0
    unique_sources: int = 0
    evidence_items: int = 0
    independent_evidence_items: int = 0
    duplicate_rate: float = 0.0
    identity_resolution_rate: float = 0.0
    positive_evidence_ratio: float = 0.0
    negative_evidence_ratio: float = 0.0
    neutral_evidence_ratio: float = 0.0
    high_confidence_ratio: float = 0.0
    medium_confidence_ratio: float = 0.0
    low_confidence_ratio: float = 0.0
    multi_source_merchant_ratio: float = 0.0
    stale_evidence_ratio: float = 0.0
    unresolved_claim_count: int = 0
    verification_queue_size: int = 0
    new_useful_evidence: int = 0
    cities: int = 0
    categories: int = 0
    source_platforms: int = 0

    def as_dict(self) -> dict[str, Any]:
        return self.model_dump()
