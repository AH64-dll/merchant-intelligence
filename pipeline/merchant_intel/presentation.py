"""Presentation package builder and strict brief-contract validation.

Phase 3 of the seller-profile presentation plan. This module is the single
deterministic boundary between the raw provenance graph (sources, evidence,
claims) and the model-facing brief workflow:

- :func:`build_presentation_package` projects one merchant's displayable
  identity and root evidence into a frozen, hashable package. Duplicate
  children are excluded from the root layer and only counted; source-only
  rows (no usable summary or quote) are retained but flagged by count.
- :func:`evidence_set_hash` fingerprints the currently eligible evidence so a
  stored brief is only rendered against the exact evidence set it was
  written for.
- :func:`validate_brief_payload` is the deterministic gate for model output:
  every statement must cite a supplied root evidence id, and no text may
  contain a score, a percentage, or a verdict word.

No function here performs network I/O or writes to the database.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from typing import Any

from merchant_intel.database import Database
from merchant_intel.sources import is_placeholder_summary

__all__ = [
    "EvidenceRef",
    "MerchantPresentationPackage",
    "SourceRef",
    "build_presentation_package",
    "evidence_set_hash",
    "identity_certainty_boundary",
    "validate_brief_payload",
]


@dataclass(frozen=True)
class SourceRef:
    """Presentation-safe view of one source row plus its link-check result.

    ``web_url`` is the browser-openable original URL or ``None``; the raw
    ``sources.url`` locator is never re-exposed here. ``check_status`` is the
    availability-check result (``None`` = never checked) and is availability
    information only, never a credibility judgement.
    """

    source_id: int
    web_url: str | None
    locator_note: str
    source_label: str
    access_kind: str  # web | whois | offline | unknown
    check_status: str | None


@dataclass(frozen=True)
class EvidenceRef:
    """One root (non-duplicate) evidence row with its source citation."""

    evidence_id: str
    claim_id: str | None
    summary: str
    raw_quote: str
    published_at: str | None
    captured_at: str | None
    author_type: str
    is_duplicate_child: bool
    sources: tuple[SourceRef, ...]


@dataclass(frozen=True)
class MerchantPresentationPackage:
    """Everything a brief-drafting agent may know about one seller."""

    merchant_id: str
    canonical_name: str
    city: str | None
    category: str | None
    aliases: tuple[str, ...]
    identifiers: tuple[dict, ...]  # {kind, value, normalized_value}; displayable only
    allowed_identifier_matches: tuple[str, ...]
    root_evidence: tuple[EvidenceRef, ...]  # excludes duplicate children
    duplicate_children_count: int
    source_only_count: int
    all_source_ids: tuple[int, ...]


# --------------------------------------------------------------------------
# Identifier display policy (conservative mirror of webapp identifier-policy)
# --------------------------------------------------------------------------

_ROLE_BY_KIND: dict[str, str] = {
    "phone": "contact",
    "whatsapp": "contact",
    "email": "contact",
    "website": "owned_site",
    "facebook": "social_profile",
    "instagram": "social_profile",
    "tiktok": "social_profile",
    "marketplace": "marketplace_profile",
    "google_maps": "location",
    "commercial_register": "registration",
    "address": "location",
}

# Generic regulator/support roots — never merchant-owned identity.
_EXTERNAL_REFERENCE_HOSTS = frozenset(
    {"cpa.gov.eg", "shakwa.cpa-mobile.com", "support.apple.com"}
)

# Platform roots whose profiles must carry an item path to be searchable.
_SHARED_PROFILE_HOSTS = frozenset(
    {
        "facebook.com",
        "instagram.com",
        "tiktok.com",
        "g.page",
        "goo.gl",
        "maps.app.goo.gl",
        "maps.google.com",
        "google.com",
        "play.google.com",
        "apps.apple.com",
    }
)

_URL_KINDS = frozenset({"website", "marketplace", "facebook", "instagram", "tiktok", "google_maps"})
_PHONE_KINDS = frozenset({"phone", "whatsapp"})


def _url_host(value: str) -> str | None:
    if "://" not in value:
        return None
    rest = value.split("://", 1)[1]
    if not rest:
        return None
    host = rest.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    if "@" in host:  # strip credentials
        host = host.rsplit("@", 1)[1]
    if ":" in host:
        host = host.split(":", 1)[0]
    host = host.lower().removeprefix("www.")
    if not host or "." not in host:
        return None
    return host


def _url_path(value: str) -> str:
    rest = value.split("://", 1)[1]
    if "/" not in rest:
        return ""
    path = rest.split("/", 1)[1]
    return "/" + path.split("?", 1)[0].split("#", 1)[0] if path else ""


def _is_egyptian_phone_shape(normalized: str) -> bool:
    digits = re.sub(r"\D", "", normalized)
    if not normalized.startswith("+20"):
        return False
    national = digits[2:]
    return bool(re.fullmatch(r"1[0125][0-9]{8}", national) or re.fullmatch(r"[2-9][0-9]{8}", national))


def _identifier_role(kind: str, normalized_value: str) -> str | None:
    role = _ROLE_BY_KIND.get(kind)
    if role is None:
        return None
    if kind in {"website", "marketplace"}:
        host = _url_host(normalized_value)
        if host is not None and host in _EXTERNAL_REFERENCE_HOSTS:
            return "external_reference"
    return role


def _is_searchable_identifier(kind: str, normalized_value: str) -> bool:
    if _identifier_role(kind, normalized_value) == "external_reference":
        return False
    if kind in _PHONE_KINDS:
        return _is_egyptian_phone_shape(normalized_value)
    if kind == "email":
        return "@" in normalized_value and "." in normalized_value
    if kind in _URL_KINDS:
        host = _url_host(normalized_value)
        if host is None:
            return False
        if kind == "website":
            return True  # bare origin is a legitimate owned-site key
        if host in _SHARED_PROFILE_HOSTS:
            return len(_url_path(normalized_value)) > 1
        return True
    return True


# --------------------------------------------------------------------------
# Package builder
# --------------------------------------------------------------------------


def _is_meaningful_evidence(summary: str, raw_quote: str) -> bool:
    """Meaningful = carries usable text. A placeholder summary masquerades
    as a fact and is therefore source-only even though it is non-empty."""
    if raw_quote.strip():
        return True
    text = summary.strip()
    return bool(text) and not is_placeholder_summary(text)


def build_presentation_package(db: Database, merchant_id: str) -> MerchantPresentationPackage | None:
    """Project one merchant into its presentation package.

    Returns ``None`` when the merchant does not exist. Duplicate children are
    excluded from ``root_evidence`` and only counted in
    ``duplicate_children_count``; root rows without a usable summary or quote
    are retained in ``root_evidence`` (as source-only) and counted in
    ``source_only_count``.
    """
    merchant = db.query_one("SELECT * FROM merchants WHERE id=?", (merchant_id,))
    if merchant is None:
        return None

    alias_rows = db.query(
        "SELECT alias FROM merchant_aliases WHERE merchant_id=? ORDER BY alias",
        (merchant_id,),
    )
    identifiers = tuple(
        {"kind": str(row["kind"]), "value": str(row["value"]), "normalized_value": str(row["normalized_value"])}
        for row in db.query(
            "SELECT kind, value, normalized_value FROM merchant_identifiers "
            "WHERE merchant_id=? ORDER BY kind, normalized_value",
            (merchant_id,),
        )
        if _is_searchable_identifier(str(row["kind"]), str(row["normalized_value"]))
    )

    evidence_rows = db.query(
        "SELECT * FROM evidence WHERE merchant_id=? ORDER BY id",
        (merchant_id,),
    )
    source_ids = sorted({int(row["source_id"]) for row in evidence_rows})
    source_map: dict[int, SourceRef] = {}
    if source_ids:
        placeholders = ",".join("?" for _ in source_ids)
        for row in db.query(
            "SELECT s.id, s.web_url, s.locator_note, s.source_label, s.access_kind,"
            " c.status AS check_status"
            f" FROM sources s LEFT JOIN source_link_checks c ON c.source_id=s.id"
            f" WHERE s.id IN ({placeholders})",
            source_ids,
        ):
            source_map[int(row["id"])] = SourceRef(
                source_id=int(row["id"]),
                web_url=row["web_url"],
                locator_note=str(row["locator_note"] or ""),
                source_label=str(row["source_label"] or ""),
                access_kind=str(row["access_kind"] or "unknown"),
                check_status=row["check_status"],
            )

    root_evidence: list[EvidenceRef] = []
    duplicate_children_count = 0
    source_only_count = 0
    for row in evidence_rows:
        if row["duplicate_of"] is not None:
            duplicate_children_count += 1
            continue
        source = source_map.get(int(row["source_id"]))
        if source is None:  # defensive: FK guarantees presence
            continue
        root_evidence.append(
            EvidenceRef(
                evidence_id=str(row["id"]),
                claim_id=row["claim_id"],
                summary=str(row["summary"] or ""),
                raw_quote=str(row["quoted_excerpt"] or ""),
                published_at=row["published_at"],
                captured_at=row["captured_at"],
                author_type=str(row["author_type"] or "unknown"),
                is_duplicate_child=False,
                sources=(source,),
            )
        )
        if not _is_meaningful_evidence(str(row["summary"] or ""), str(row["quoted_excerpt"] or "")):
            source_only_count += 1

    root_evidence.sort(key=lambda ref: ref.evidence_id)
    all_source_ids = tuple(sorted({s.source_id for ref in root_evidence for s in ref.sources}))

    return MerchantPresentationPackage(
        merchant_id=str(merchant["id"]),
        canonical_name=str(merchant["canonical_name"]),
        city=str(merchant["city"]).strip() or None,
        category=str(merchant["category"]).strip() or None,
        aliases=tuple(str(row["alias"]) for row in alias_rows),
        identifiers=identifiers,
        allowed_identifier_matches=tuple(
            sorted(
                {
                    role
                    for item in identifiers
                    if (role := _identifier_role(item["kind"], item["normalized_value"]))
                    not in (None, "external_reference")
                }
            )
        ),
        root_evidence=tuple(root_evidence),
        duplicate_children_count=duplicate_children_count,
        source_only_count=source_only_count,
        all_source_ids=all_source_ids,
    )


# --------------------------------------------------------------------------
# Evidence-set fingerprint
# --------------------------------------------------------------------------

def _hashable_identifiers(identifiers: tuple[dict, ...]) -> list[dict]:
    return sorted(
        (dict(item) for item in identifiers),
        key=lambda item: (item["kind"], item["normalized_value"]),
    )


def _hashable_root_evidence(root_evidence: tuple[EvidenceRef, ...]) -> list[dict]:
    return [
        {
            "evidence_id": ref.evidence_id,
            "claim_id": ref.claim_id,
            "summary": ref.summary,
            "raw_quote": ref.raw_quote,
            "published_at": ref.published_at,
            "captured_at": ref.captured_at,
            "author_type": ref.author_type,
            "sources": [
                {
                    "source_id": s.source_id,
                    "web_url": s.web_url,
                    "locator_note": s.locator_note,
                    "source_label": s.source_label,
                    "access_kind": s.access_kind,
                    "check_status": s.check_status,
                }
                for s in sorted(ref.sources, key=lambda s: s.source_id)
            ],
        }
        for ref in sorted(root_evidence, key=lambda ref: ref.evidence_id)
    ]


def evidence_set_hash(pkg: MerchantPresentationPackage) -> str:
    """Stable fingerprint of the currently eligible evidence set.

    sha256 over a canonical ``json.dumps(sort_keys=True, ensure_ascii=False,
    separators=(',', ':'))`` of the merchant id, sorted displayable
    identifiers, every root evidence ref with its per-source citation fields,
    and the source-only / duplicate-children counts. Hex digest, first 32
    characters. Stable across process restarts.
    """
    payload = {
        "merchant_id": pkg.merchant_id,
        "identifiers": _hashable_identifiers(pkg.identifiers),
        "root_evidence": _hashable_root_evidence(pkg.root_evidence),
        "source_only_count": pkg.source_only_count,
        "duplicate_children_count": pkg.duplicate_children_count,
    }
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]


# --------------------------------------------------------------------------
# Identity certainty boundary
# --------------------------------------------------------------------------


def identity_certainty_boundary(pkg: MerchantPresentationPackage) -> str:
    """Conservative identity boundary mirrored from the webapp's
    ``assessIdentity`` identifier logic (state/name-conflict forcing is
    re-applied by the renderer, which still owns the full assessment).

    Two distinct high-signal roles → ``identified``; one high-signal or two
    supporting roles → ``partial``; otherwise ``unverified``. Never emits a
    numeric confidence.
    """
    roles = set(pkg.allowed_identifier_matches)
    high = roles & {"contact", "owned_site", "social_profile", "registration"}
    supporting = roles & {"marketplace_profile", "location"}
    if len(high) >= 2:
        return "identified"
    if high or len(supporting) >= 2:
        return "partial"
    return "unverified"


# --------------------------------------------------------------------------
# Strict brief validator
# --------------------------------------------------------------------------

_MAX_BULLETS = 6
_VERDICT_WORDS = ("مضمون", "موثوق", "غير موثوق")
_SCORE_PATTERNS = (
    re.compile(r"\d+\s*%"),
    re.compile(r"\b\d+\s*/\s*(?:10|100)\b"),
    re.compile(r"\b\d+\s*من\s*(?:10|100)\b"),
)


def _text_issues(section: str, text: Any, issues: list[str]) -> None:
    if not isinstance(text, str) or not text.strip():
        issues.append(f"{section}.text must be a non-empty string")
        return
    for word in _VERDICT_WORDS:
        if word in text:
            issues.append(f"{section}.text contains the verdict word {word!r}")
    for pattern in _SCORE_PATTERNS:
        if pattern.search(text):
            issues.append(f"{section}.text contains a score or percentage")


def _evidence_ids_issues(
    section: str,
    value: Any,
    *,
    allowed_ids: set[str],
    allow_empty: bool,
    issues: list[str],
) -> None:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        issues.append(f"{section}.evidence_ids must be a list of strings")
        return
    if not allow_empty and not value:
        issues.append(f"{section}.evidence_ids must not be empty")
        return
    for item in value:
        if item not in allowed_ids:
            issues.append(f"{section} cites evidence id {item!r} which is not in the supplied root evidence")


def validate_brief_payload(payload: Any, pkg: MerchantPresentationPackage) -> list[str]:
    """Validate a model-drafted brief against the supplied package.

    Returns a list of violation strings; an empty list means the payload is
    publishable. The validator is deterministic and never calls a model.
    """
    issues: list[str] = []
    if not isinstance(payload, dict):
        return ["payload must be a JSON object"]

    allowed_ids = {ref.evidence_id for ref in pkg.root_evidence}

    # identity_message
    identity = payload.get("identity_message")
    if not isinstance(identity, dict):
        issues.append("identity_message must be an object")
    else:
        _text_issues("identity_message", identity.get("text"), issues)
        _evidence_ids_issues(
            "identity_message", identity.get("evidence_ids"), allowed_ids=allowed_ids, allow_empty=False, issues=issues
        )
        certainty = identity.get("certainty")
        if certainty not in ("identified", "partial", "unverified"):
            issues.append(
                f"identity_message.certainty must be one of identified|partial|unverified, got {certainty!r}"
            )
        elif certainty != identity_certainty_boundary(pkg):
            issues.append(
                f"identity_message.certainty {certainty!r} does not match the conservative identity "
                f"boundary {identity_certainty_boundary(pkg)!r}"
            )

    # reputation_message
    reputation = payload.get("reputation_message")
    if not isinstance(reputation, dict):
        issues.append("reputation_message must be an object")
    else:
        _text_issues("reputation_message", reputation.get("text"), issues)
        _evidence_ids_issues(
            "reputation_message", reputation.get("evidence_ids"), allowed_ids=allowed_ids, allow_empty=False, issues=issues
        )

    # bullets
    bullets = payload.get("bullets")
    if not isinstance(bullets, list) or not all(isinstance(item, dict) for item in bullets):
        issues.append("bullets must be a list of objects")
    else:
        if len(bullets) > _MAX_BULLETS:
            issues.append(f"bullets must contain at most {_MAX_BULLETS} items, got {len(bullets)}")
        for index, bullet in enumerate(bullets):
            _text_issues(f"bullets[{index}]", bullet.get("text"), issues)
            _evidence_ids_issues(
                f"bullets[{index}]", bullet.get("evidence_ids"), allowed_ids=allowed_ids, allow_empty=False, issues=issues
            )

    # unknowns
    unknowns = payload.get("unknowns")
    if not isinstance(unknowns, list) or not all(isinstance(item, dict) for item in unknowns):
        issues.append("unknowns must be a list of objects")
    else:
        for index, unknown in enumerate(unknowns):
            _text_issues(f"unknowns[{index}]", unknown.get("text"), issues)
            _evidence_ids_issues(
                f"unknowns[{index}]", unknown.get("evidence_ids"), allowed_ids=allowed_ids, allow_empty=True, issues=issues
            )

    return issues


def package_as_dict(pkg: MerchantPresentationPackage) -> dict[str, Any]:
    """JSON-safe projection of a package for model prompts."""
    return asdict(pkg)
