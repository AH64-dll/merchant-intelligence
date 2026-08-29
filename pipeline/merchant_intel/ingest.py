"""Insert discovery, analysis, and verification payloads without losing provenance."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from merchant_intel.database import Database
from merchant_intel.normalize import (
    canonicalize_eg_phone,
    canonicalize_name,
    canonicalize_url,
    claim_fingerprint,
    evidence_fingerprint,
    normalize_claim_text,
)
from merchant_intel.schemas import (
    DiscoveryAgentOutput,
    EvidenceItem,
    LunaAgentOutput,
    MerchantCandidate,
    SolRoundOutput,
    utcnow,
)


def _utc_iso(value: datetime | None) -> str | None:
    """Serialize a datetime as UTC ISO-8601 with an explicit +00:00 offset.
    Naive datetimes are treated as UTC; aware datetimes are converted."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _now() -> str:
    return utcnow().isoformat()


def _plain(value: str) -> str:
    return " ".join((value or "").casefold().split())


def _identifier_pairs(candidate: MerchantCandidate) -> list[tuple[str, str, str]]:
    ids = candidate.identifiers
    pairs: list[tuple[str, str, str]] = []

    def add(kind: str, values: Iterable[str], *, url: bool = False, phone: bool = False) -> None:
        for raw in values:
            value = raw.strip()
            if not value:
                continue
            if phone:
                normalized = canonicalize_eg_phone(value)
            elif url:
                normalized = canonicalize_url(value)
            else:
                normalized = _plain(value)
            if normalized:
                pairs.append((kind, value, normalized))

    add("phone", ids.phones, phone=True)
    add("whatsapp", ids.whatsapp, phone=True)
    add("website", ids.websites, url=True)
    add("facebook", ids.facebook, url=True)
    add("instagram", ids.instagram, url=True)
    add("tiktok", ids.tiktok, url=True)
    add("marketplace", ids.marketplaces, url=True)
    add("google_maps", ids.google_maps, url=True)
    add("email", ids.emails)
    add("address", ids.addresses)
    add("commercial_register", ids.commercial_register)
    return pairs


_STRONG_IDENTIFIER_KINDS = {
    "phone",
    "whatsapp",
    "website",
    "facebook",
    "instagram",
    "tiktok",
    "marketplace",
    "google_maps",
    "email",
    "commercial_register",
}


def _link_merchants(
    db: Database,
    left: str,
    right: str,
    *,
    relation: str,
    confidence: float,
    rationale: str,
) -> None:
    if not left or not right or left == right:
        return
    a, b = sorted((left, right))
    db.execute(
        """INSERT OR IGNORE INTO merchant_links
           (id, left_merchant_id, right_merchant_id, relation, confidence, rationale, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (str(uuid.uuid4()), a, b, relation, confidence, rationale, _now()),
    )


def _identity_confidence(identifier_count: int) -> float:
    return min(0.95, 0.15 + (0.15 * min(identifier_count, 5)))


def _add_candidate_details(
    db: Database, merchant_id: str, candidate: MerchantCandidate
) -> None:
    now = _now()
    row = db.query_one("SELECT * FROM merchants WHERE id=?", (merchant_id,))
    if row is None:
        return
    canonical_name = row["canonical_name"] or candidate.canonical_name
    category = row["category"] or candidate.category
    city = row["city"] or candidate.city
    governorate = row["governorate"] or candidate.governorate
    confidence = max(
        float(row["identity_confidence"]),
        _identity_confidence(
            sum(1 for kind, _raw, _norm in _identifier_pairs(candidate) if kind in _STRONG_IDENTIFIER_KINDS)
        ),
    )
    db.execute(
        """UPDATE merchants SET canonical_name=?, category=?, city=?, governorate=?,
           identity_confidence=?, updated_at=? WHERE id=?""",
        (canonical_name, category, city, governorate, confidence, now, merchant_id),
    )
    names = [candidate.canonical_name, *candidate.aliases]
    for alias in names:
        normalized = canonicalize_name(alias)
        if normalized:
            db.execute(
                """INSERT OR IGNORE INTO merchant_aliases(merchant_id, alias, normalized_alias)
                   VALUES (?, ?, ?)""",
                (merchant_id, alias.strip(), normalized),
            )
    for kind, raw, normalized in _identifier_pairs(candidate):
        other_owners = [
            r["merchant_id"]
            for r in db.query(
                """SELECT merchant_id FROM merchant_identifiers
                   WHERE kind=? AND normalized_value=?""",
                (kind, normalized),
            )
            if r["merchant_id"] != merchant_id
        ]
        for other in other_owners:
            _link_merchants(
                db,
                merchant_id,
                other,
                relation="identifier_collision",
                confidence=0.15,
                rationale=f"same {kind} identifier appeared on multiple candidate merchants",
            )
        db.execute(
            """INSERT OR IGNORE INTO merchant_identifiers
               (merchant_id, kind, value, normalized_value, confidence)
               VALUES (?, ?, ?, ?, ?)""",
            (merchant_id, kind, raw, normalized, 0.7 if kind in _STRONG_IDENTIFIER_KINDS else 0.35),
        )

def resolve_merchant(db: Database, candidate: MerchantCandidate, round_no: int) -> str:
    pairs = _identifier_pairs(candidate)
    matched_ids: set[str] = set()
    for kind, _raw, normalized in pairs:
        if kind not in _STRONG_IDENTIFIER_KINDS:
            continue
        rows = db.query(
            "SELECT merchant_id FROM merchant_identifiers WHERE kind=? AND normalized_value=?",
            (kind, normalized),
        )
        for row in rows:
            matched_ids.add(row["merchant_id"])

    # Merge only when strong identifiers agree on one merchant. Conflicting
    # identifiers are retained as an explicit possible-link, never auto-merged.
    if len(matched_ids) == 1:
        merchant_id = next(iter(matched_ids))
        _add_candidate_details(db, merchant_id, candidate)
        return merchant_id
    normalized_name = canonicalize_name(candidate.canonical_name)
    city = _plain(candidate.city)
    if normalized_name and city:
        row = db.query_one(
            """SELECT id FROM merchants
               WHERE normalized_name=? AND lower(city)=? LIMIT 1""",
            (normalized_name, city),
        )
        if row:
            merchant_id = row["id"]
            _add_candidate_details(db, merchant_id, candidate)
            for other in matched_ids - {merchant_id}:
                _link_merchants(
                    db,
                    merchant_id,
                    other,
                    relation="name_identifier_conflict",
                    confidence=0.30,
                    rationale="name/city matched but candidate identifiers point elsewhere",
                )
            return merchant_id

    merchant_id = str(uuid.uuid4())
    now = _now()
    db.execute(
        """INSERT INTO merchants
           (id, canonical_name, normalized_name, category, city, governorate,
            identity_confidence, state, first_seen_round, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            merchant_id,
            candidate.canonical_name.strip(),
            normalized_name,
            candidate.category.strip(),
            candidate.city.strip(),
            candidate.governorate.strip(),
            _identity_confidence(
                sum(1 for kind, _raw, _norm in pairs if kind in _STRONG_IDENTIFIER_KINDS)
            ),
            "INSUFFICIENT_DATA",
            round_no,
            now,
            now,
        ),
    )
    _add_candidate_details(db, merchant_id, candidate)
    for other in matched_ids:
        _link_merchants(
            db,
            merchant_id,
            other,
            relation="identifier_collision",
            confidence=0.20,
            rationale="new candidate had identifiers already associated with another merchant",
        )
    return merchant_id


def _upsert_source(db: Database, evidence: EvidenceItem) -> int:
    canonical = canonicalize_url(evidence.source_url)
    existing = db.query_one("SELECT id FROM sources WHERE canonical_url=?", (canonical,))
    if existing:
        db.execute(
            "UPDATE sources SET last_seen_at=? WHERE id=?", (_now(), existing["id"])
        )
        return int(existing["id"])
    cur = db.execute(
        """INSERT INTO sources(url, canonical_url, platform, source_type, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            evidence.source_url,
            canonical,
            evidence.source_platform,
            evidence.source_type or "unknown",
            _now(),
            _now(),
        ),
    )
    return int(cur.lastrowid)


def _upsert_claim(
    db: Database,
    merchant_id: str,
    evidence: EvidenceItem,
    merchant_name: str,
) -> str:
    fingerprint = claim_fingerprint(
        merchant_name,
        evidence.claim_type.value,
        evidence.summary,
        evidence.raw_quote,
    )
    row = db.query_one("SELECT id FROM claims WHERE fingerprint=?", (fingerprint,))
    now = _now()
    if row:
        claim_id = row["id"]
        db.execute(
            """UPDATE claims SET mention_count=mention_count+1, updated_at=? WHERE id=?""",
            (now, claim_id),
        )
        return claim_id
    claim_id = str(uuid.uuid4())
    db.execute(
        """INSERT INTO claims
           (id, merchant_id, claim_type, sentiment, summary, normalized_text, fingerprint,
            independent_source_count, mention_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)""",
        (
            claim_id,
            merchant_id,
            evidence.claim_type.value,
            evidence.sentiment.value,
            evidence.summary,
            normalize_claim_text(evidence.summary),
            fingerprint,
            now,
            now,
        ),
    )
    return claim_id


def ingest_evidence(
    db: Database,
    merchant_id: str,
    evidence: EvidenceItem,
    *,
    agent_run_id: str | None,
    round_no: int,
    verified: bool = False,
) -> tuple[str, bool]:
    """Return (evidence_id, is_independent).

    Every observation is retained. Exact URL duplicates and same-content
    cross-platform reposts receive duplicate_of and independent=0 rather than
    disappearing, preserving an auditable raw trail.
    """
    merchant = db.query_one("SELECT canonical_name FROM merchants WHERE id=?", (merchant_id,))
    if merchant is None:
        raise ValueError(f"evidence references unknown merchant {merchant_id}")
    name = merchant["canonical_name"]
    exact_fp = evidence_fingerprint(
        name, evidence.claim_type.value, evidence.summary, evidence.source_url
    )
    content_fp = claim_fingerprint(
        name, evidence.claim_type.value, evidence.summary, evidence.raw_quote
    )
    duplicate = db.query_one(
        """SELECT id FROM evidence
           WHERE fingerprint=? OR content_fingerprint=? ORDER BY id LIMIT 1""",
        (exact_fp, content_fp),
    )
    # Duplicate pointers always reference the canonical root of a chain:
    # if the matched row is itself a duplicate, walk to its root so chains
    # stay flat and root-canonical.
    duplicate_root_id: str | None = None
    if duplicate is not None:
        duplicate_root_id = duplicate["id"]
        seen: set[str] = set()
        while True:
            parent = db.query_one(
                "SELECT duplicate_of FROM evidence WHERE id=?", (duplicate_root_id,)
            )
            if parent is None or parent["duplicate_of"] is None:
                break
            if duplicate_root_id in seen:
                # Defensive: a cycle at write time is corrupt input; do not
                # follow it further.
                break
            seen.add(duplicate_root_id)
            duplicate_root_id = parent["duplicate_of"]
    source_id = _upsert_source(db, evidence)
    claim_id = _upsert_claim(db, merchant_id, evidence, name)
    evidence_id = str(uuid.uuid4())
    independent = duplicate is None
    db.execute(
        """INSERT INTO evidence
           (id, merchant_id, source_id, claim_id, claim_type, sentiment, summary, quoted_excerpt,
            author_type, transaction_evidence, confidence, reliability_band, language,
            published_at, captured_at, fingerprint, content_fingerprint, independent,
            duplicate_of, agent_run_id, round_no, verified, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            evidence_id,
            merchant_id,
            source_id,
            claim_id,
            evidence.claim_type.value,
            evidence.sentiment.value,
            evidence.summary,
            evidence.raw_quote,
            evidence.author_type.value,
            int(evidence.transaction_evidence),
            evidence.confidence,
            evidence.reliability_band.value,
            evidence.language,
            _utc_iso(evidence.published_at),
            _utc_iso(evidence.captured_at or utcnow()),
            exact_fp,
            content_fp,
            int(independent),
            duplicate_root_id,
            agent_run_id,
            round_no,
            int(verified),
            evidence.model_dump_json(),
        ),
    )
    db.execute(
        "INSERT OR IGNORE INTO claim_evidence(claim_id, evidence_id) VALUES (?, ?)",
        (claim_id, evidence_id),
    )
    if independent:
        db.execute(
            """UPDATE claims SET independent_source_count=(
                 SELECT COUNT(DISTINCT e.source_id) FROM evidence e
                 WHERE e.claim_id=? AND e.independent=1
               ), updated_at=? WHERE id=?""",
            (claim_id, _now(), claim_id),
        )
    return evidence_id, independent


def ingest_discovery(
    db: Database,
    output: DiscoveryAgentOutput,
    *,
    agent_run_id: str,
    round_no: int,
) -> dict[str, int]:
    new_merchants = 0
    new_evidence = 0
    duplicates = 0
    seen_merchants: set[str] = set()
    for record in output.records:
        before = db.query_one(
            "SELECT id FROM merchants WHERE normalized_name=? AND lower(city)=?",
            (canonicalize_name(record.merchant_candidate.canonical_name), _plain(record.merchant_candidate.city)),
        )
        merchant_id = resolve_merchant(db, record.merchant_candidate, round_no)
        if before is None and merchant_id not in seen_merchants:
            new_merchants += 1
        seen_merchants.add(merchant_id)
        _eid, is_new = ingest_evidence(
            db,
            merchant_id,
            record.evidence,
            agent_run_id=agent_run_id,
            round_no=round_no,
        )
        if is_new:
            new_evidence += 1
        else:
            duplicates += 1
    return {
        "new_merchants": new_merchants,
        "new_evidence": new_evidence,
        "duplicates": duplicates,
        "records": len(output.records),
    }


def ingest_sol(
    db: Database,
    run_id: str,
    output: SolRoundOutput,
    round_no: int,
    *,
    allowed_merchant_ids: set[str] | None = None,
) -> int:
    tasks = 0
    allowed = allowed_merchant_ids or set()
    for analysis in output.merchants:
        merchant_id = analysis.merchant_id
        if merchant_id in {"", "pending"} and len(allowed) == 1:
            merchant_id = next(iter(allowed))
        merchant = db.query_one("SELECT id FROM merchants WHERE id=?", (merchant_id,))
        if merchant is None and allowed:
            label = canonicalize_name(analysis.merchant_name or analysis.merchant_id)
            for candidate_id in allowed:
                candidate = db.query_one(
                    "SELECT id, canonical_name FROM merchants WHERE id=?", (candidate_id,)
                )
                if candidate and label and canonicalize_name(candidate["canonical_name"]) == label:
                    merchant_id = candidate["id"]
                    merchant = candidate
                    break
        if merchant is None:
            # Never attach an analysis to an arbitrary first merchant.
            continue
        db.execute(
            """INSERT INTO merchant_analyses
               (run_id, merchant_id, round_no, payload_json, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (run_id, merchant_id, round_no, analysis.model_dump_json(), _now()),
        )
        db.execute(
            """UPDATE merchants SET state=?, identity_confidence=?, updated_at=? WHERE id=?""",
            (analysis.internal_state.value, analysis.identity_confidence, _now(), merchant_id),
        )
        for task in analysis.verification_tasks:
            task_merchant = task.merchant_id
            if task_merchant in {"", "pending"}:
                task_merchant = merchant_id
            if not db.query_one("SELECT id FROM merchants WHERE id=?", (task_merchant,)):
                task_merchant = merchant_id
            # Unexecutable guard: a task with neither title nor instruction
            # defines no claim to verify; ingesting it would poison the
            # verification queue (agents return NON_EXECUTABLE shells forever).
            if not (task.title or "").strip() and not (task.instruction or "").strip():
                continue
            db.execute(
                """INSERT OR IGNORE INTO verification_tasks
                   (id, run_id, merchant_id, title, instruction, excluded_sources_json,
                    claim_ids_json, priority, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
                (
                    task.task_id,
                    run_id,
                    task_merchant,
                    task.title,
                    task.instruction,
                    db.dumps(task.already_used_sources),
                    db.dumps(task.claim_ids),
                    task.priority,
                    now,
                    now,
                ),
            )
            tasks += 1
    return tasks


def mark_tasks_assigned(
    db: Database, task_ids: Iterable[str], agent_id: str, round_no: int
) -> None:
    now = _now()
    for task_id in task_ids:
        db.execute(
            """UPDATE verification_tasks SET status='in_progress', assigned_agent=?,
               attempts=attempts+1, last_attempt_round=?, updated_at=?
               WHERE id=? AND status IN ('pending','unresolved')""",
            (agent_id, round_no, now, task_id),
        )


def release_tasks(db: Database, task_ids: Iterable[str], error: str) -> None:
    for task_id in task_ids:
        db.execute(
            """UPDATE verification_tasks SET status='pending', last_error=?, updated_at=?
               WHERE id=? AND status='in_progress'""",
            (error[:1000], _now(), task_id),
        )


def ingest_luna(
    db: Database,
    output: LunaAgentOutput,
    *,
    agent_run_id: str,
    round_no: int,
) -> int:
    added = 0
    for finding in output.findings:
        task = db.query_one(
            "SELECT * FROM verification_tasks WHERE id=?", (finding.task_id,)
        )
        if task is None:
            continue
        resolved = (
            not finding.still_unresolved
            and bool(finding.evidence)
            and (finding.supported is not None or finding.contradicted is not None)
        )
        status = "done" if resolved else "unresolved"
        db.execute(
            """UPDATE verification_tasks SET status=?, result_json=?, assigned_agent=?,
               last_error='', updated_at=? WHERE id=?""",
            (status, finding.model_dump_json(), output.agent_id, _now(), finding.task_id),
        )
        merchant_id = finding.merchant_id
        if merchant_id in {"", "pending"}:
            merchant_id = task["merchant_id"]
        if not db.query_one("SELECT id FROM merchants WHERE id=?", (merchant_id,)):
            continue
        for evidence in finding.evidence:
            _eid, is_new = ingest_evidence(
                db,
                merchant_id,
                evidence,
                agent_run_id=agent_run_id,
                round_no=round_no,
                verified=resolved,
            )
            if is_new:
                added += 1
    return added
