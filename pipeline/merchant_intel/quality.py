"""Dataset quality metrics, gates, and diminishing-return detection."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from merchant_intel.config import QualityGates
from merchant_intel.database import Database
from merchant_intel.schemas import QualityMetrics


def _is_stale(value: str | None, cutoff: datetime) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed < cutoff


def compute_metrics(
    db: Database,
    *,
    new_evidence: int = 0,
    run_id: str | None = None,
    stale_after_days: int = 730,
) -> QualityMetrics:
    merchants = db.query("SELECT * FROM merchants")
    evidence = db.query("SELECT * FROM evidence")
    sources = db.query("SELECT * FROM sources")
    unique_merchants = len(merchants)
    evidence_items = len(evidence)
    primary = [row for row in evidence if int(row["independent"] or 0) == 1]
    independent = len(primary)
    duplicate_rate = (
        sum(1 for row in evidence if row["duplicate_of"]) / evidence_items
        if evidence_items
        else 0.0
    )
    identified = sum(1 for row in merchants if row["identity_confidence"] >= 0.45)
    identity_rate = identified / unique_merchants if unique_merchants else 0.0
    denom = len(primary) or 1
    pos = sum(1 for row in primary if row["sentiment"] == "positive")
    neg = sum(1 for row in primary if row["sentiment"] == "negative")
    neu = sum(1 for row in primary if row["sentiment"] == "neutral")
    high = sum(1 for row in primary if row["reliability_band"] in {"strong", "very_strong"})
    med = sum(1 for row in primary if row["reliability_band"] == "medium")
    low = sum(1 for row in primary if row["reliability_band"] == "weak")

    merchant_source_counts: dict[str, set[str]] = {}
    for row in primary:
        merchant_source_counts.setdefault(row["merchant_id"], set()).add(str(row["source_id"]))
    multi = sum(1 for source_set in merchant_source_counts.values() if len(source_set) >= 2)
    cities = {str(row["city"]).strip() for row in merchants if str(row["city"]).strip()}
    categories = {str(row["category"]).strip() for row in merchants if str(row["category"]).strip()}
    platforms = {str(row["platform"]).strip() for row in sources if str(row["platform"]).strip()}
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(0, stale_after_days))
    stale = sum(1 for row in primary if _is_stale(row["published_at"], cutoff))
    task_sql = "SELECT COUNT(*) AS n FROM verification_tasks WHERE status IN ('pending','unresolved','in_progress')"
    task_params: tuple[object, ...] = ()
    if run_id:
        task_sql += " AND run_id=?"
        task_params = (run_id,)
    pending = db.query_one(task_sql, task_params)
    unresolved = db.query_one(
        "SELECT COUNT(*) AS n FROM verification_tasks WHERE status IN ('pending','unresolved','in_progress')"
        + (" AND run_id=?" if run_id else ""),
        (run_id,) if run_id else (),
    )
    return QualityMetrics(
        unique_merchants=unique_merchants,
        unique_sources=len(sources),
        evidence_items=evidence_items,
        independent_evidence_items=independent,
        duplicate_rate=duplicate_rate,
        identity_resolution_rate=identity_rate,
        positive_evidence_ratio=pos / denom,
        negative_evidence_ratio=neg / denom,
        neutral_evidence_ratio=neu / denom,
        high_confidence_ratio=high / denom,
        medium_confidence_ratio=med / denom,
        low_confidence_ratio=low / denom,
        multi_source_merchant_ratio=(multi / unique_merchants) if unique_merchants else 0.0,
        stale_evidence_ratio=(stale / denom) if denom else 0.0,
        unresolved_claim_count=int(unresolved["n"]) if unresolved else 0,
        verification_queue_size=int(pending["n"]) if pending else 0,
        new_useful_evidence=new_evidence,
        cities=len(cities),
        categories=len(categories),
        source_platforms=len(platforms),
    )


def gate_failures(metrics: QualityMetrics, gates: QualityGates) -> list[str]:
    checks = [
        (metrics.unique_merchants < gates.min_unique_merchants,
         f"unique_merchants {metrics.unique_merchants} < {gates.min_unique_merchants}"),
        (metrics.identity_resolution_rate < gates.min_identity_resolution_rate,
         "identity_resolution_rate below gate"),
        (metrics.multi_source_merchant_ratio < gates.min_multi_source_merchant_ratio,
         "multi_source_merchant_ratio below gate"),
        (metrics.positive_evidence_ratio < gates.min_positive_evidence_ratio,
         "positive_evidence_ratio below gate"),
        (metrics.negative_evidence_ratio < gates.min_negative_evidence_ratio,
         "negative_evidence_ratio below gate"),
        (metrics.neutral_evidence_ratio < gates.min_neutral_evidence_ratio,
         "neutral_evidence_ratio below gate"),
        (metrics.high_confidence_ratio + metrics.medium_confidence_ratio
         < gates.min_high_or_medium_confidence_ratio,
         "high_or_medium_confidence_ratio below gate"),
        (metrics.duplicate_rate > gates.max_duplicate_rate,
         "duplicate_rate above gate"),
        (metrics.stale_evidence_ratio > gates.max_stale_evidence_ratio,
         "stale_evidence_ratio above gate"),
        (metrics.cities < gates.min_cities, "cities below gate"),
        (metrics.categories < gates.min_categories, "categories below gate"),
        (metrics.source_platforms < gates.min_source_platforms, "source_platforms below gate"),
    ]
    return [message for failed, message in checks if failed]


def diminishing(prev: int, current: int, ratio: float) -> bool:
    if prev <= 0:
        return False
    return current < max(1, int(prev * ratio))

