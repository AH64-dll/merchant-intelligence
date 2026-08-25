"""Conservative canonicalization and duplicate fingerprints."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from difflib import SequenceMatcher
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_TRACKING = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "igshid",
    "si",
    "ref",
}
_NON_DIGIT = re.compile(r"\D+")
_SPACE = re.compile(r"\s+")
_COMPANY = re.compile(
    r"\b(llc|ltd|inc|co|company|store|shop|stores|trading|electronics|"
    r"شركة|متجر|محل|للتجارة|الكترونيات)\b",
    re.IGNORECASE,
)


def canonicalize_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    if not re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.I):
        raw = "https://" + raw
    parts = urlsplit(raw)
    scheme = parts.scheme.lower() or "https"
    netloc = parts.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in _TRACKING
    ]
    query.sort()
    path = parts.path.rstrip("/") or ""
    return urlunsplit((scheme, netloc, path, urlencode(query), ""))


def canonicalize_eg_phone(value: str) -> str | None:
    digits = _NON_DIGIT.sub("", value or "")
    if not digits:
        return None
    if digits.startswith("0020"):
        digits = digits[4:]
    elif digits.startswith("20") and len(digits) >= 11:
        digits = digits[2:]
    if digits.startswith("0"):
        digits = digits[1:]
    if len(digits) >= 9:
        return "+20" + digits
    return None


def canonicalize_name(name: str) -> str:
    text = unicodedata.normalize("NFKC", name or "").strip().lower()
    text = _COMPANY.sub(" ", text)
    text = re.sub(r"[^\w\u0600-\u06FF]+", " ", text, flags=re.UNICODE)
    return _SPACE.sub(" ", text).strip()


def normalize_claim_text(text: str) -> str:
    """Normalize reposted prose without retaining personal-data decoration."""
    text = unicodedata.normalize("NFKC", text or "").casefold()
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[\u200b-\u200f\ufeff]", "", text)
    text = re.sub(r"[^\w\u0600-\u06FF]+", " ", text, flags=re.UNICODE)
    return _SPACE.sub(" ", text).strip()


def text_hash(text: str) -> str:
    return hashlib.sha256(normalize_claim_text(text).encode("utf-8")).hexdigest()


def claim_fingerprint(merchant_key: str, claim_type: str, summary: str, quote: str = "") -> str:
    """Fingerprint claim content independent of the URL.

    This intentionally collapses copied screenshots/quotes across platforms;
    the second source is retained as a non-independent evidence row.
    """
    payload = "|".join(
        [canonicalize_name(merchant_key), claim_type, text_hash(summary + " " + quote)]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def evidence_fingerprint(merchant_key: str, claim_type: str, summary: str, url: str) -> str:
    """Exact evidence fingerprint including canonical source URL."""
    payload = "|".join(
        [
            canonicalize_name(merchant_key),
            claim_type,
            canonicalize_url(url),
            text_hash(summary),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def similar(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, normalize_claim_text(a), normalize_claim_text(b)).ratio()

