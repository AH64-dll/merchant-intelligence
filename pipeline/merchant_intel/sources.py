"""Presentation-safe classification of raw source locators.

Pure helpers: no database, no network, no logging side effects. The raw
``sources.url`` (and evidence) values in the master DB are historical and are
never rewritten by this module; classification only derives a browser-openable
``web_url`` plus a human ``locator_note`` and a controlled ``access_kind``.

Classification is always driven by the raw locator, never by ``canonical_url``
(row 1203 in the master DB proves ``canonical_url`` can be a mangled
``https://whois:...`` form).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

#: Controlled locator modes stored in ``sources.access_kind``.
ACCESS_KINDS: tuple[str, ...] = ("web", "whois", "offline", "unknown")

#: Generic ingest fallback that carries no source-grounded information.
PLACEHOLDER_SUMMARY: str = "Source cited without a model-supplied summary."

_HTTP_SCHEMES = ("http", "https")

# ``whois:`` and ``whois://`` both mark an offline registry lookup.
_WHOIS_PREFIX = re.compile(r"^whois:", re.IGNORECASE)

# A leading absolute http(s) URL followed by an explanatory annotation. ``\S+``
# cannot span a whitespace run, so the split lands on the first one; ``\s+``
# (rather than the pinned ``\s*``) merely states that a real separator exists.
_ANNOTATED_URL = re.compile(r"^(https?://\S+)\s+(.+)$", re.IGNORECASE)

# Whitespace (including non-breaking) and C0/C1 controls never appear in a URL.
_UNSAFE_URL_CHARS = re.compile(r"[\s\x00-\x1f\x7f]")


@dataclass(frozen=True)
class SourceLocator:
    """Derived, presentation-safe view of one raw source locator."""

    web_url: str | None
    locator_note: str
    access_kind: str


def safe_http_url(value: str | None) -> str | None:
    """Return a normalized absolute ``http``/``https`` URL, else ``None``.

    Strict by construction: the scheme must be exactly ``http`` or ``https``,
    the netloc must be non-empty, and the value must contain no whitespace or
    control characters. Anything else (``javascript:``, ``data:``,
    protocol-relative or bare-host values, an annotated URL string) is
    rejected. Credentials in the netloc are accepted.
    """
    if not value:
        return None
    if _UNSAFE_URL_CHARS.search(value):
        return None
    if value != value.strip():
        return None
    parts = urlsplit(value)
    scheme = parts.scheme.lower()
    if scheme not in _HTTP_SCHEMES or not parts.netloc:
        return None
    # Normalization only re-cases the scheme; path/query/fragment are preserved
    # verbatim (canonicalize_url is deliberately unused: it synthesizes an
    # ``https://`` scheme for bare hostnames and rewrites host/query/path).
    return urlunsplit((scheme, parts.netloc, parts.path, parts.query, parts.fragment))


def _whois_remainder(text: str) -> str:
    """Remainder of a ``whois:``/``whois://`` locator, trimmed and de-slashed."""
    remainder = text[_WHOIS_PREFIX.match(text).end() :].strip()
    if remainder.startswith("//"):
        remainder = remainder[2:].strip()
    return remainder


def classify_source_locator(raw_url: str | None) -> SourceLocator:
    """Classify one raw locator into a :class:`SourceLocator`.

    Rules, in order:

    1. ``None``/empty/whitespace-only -> ``(None, '', 'unknown')``.
    2. case-insensitive ``whois:`` prefix -> ``(None, remainder, 'whois')``
       with a leading ``//`` stripped from the remainder.
    3. the whole value is a strict http(s) URL -> ``(url, '', 'web')``.
    4. a leading absolute http(s) URL plus a trailing annotation ->
       ``(url, annotation, 'web')``.
    5. anything else -> ``(None, value, 'unknown')``; the locator is retained
       as a note so no provenance is lost.
    """
    if raw_url is None:
        return SourceLocator(None, "", "unknown")
    text = raw_url.strip()
    if not text:
        return SourceLocator(None, "", "unknown")

    if _WHOIS_PREFIX.match(text):
        return SourceLocator(None, _whois_remainder(text), "whois")

    direct = safe_http_url(text)
    if direct is not None:
        return SourceLocator(direct, "", "web")

    annotated = _ANNOTATED_URL.match(text)
    if annotated is not None:
        head = safe_http_url(annotated.group(1))
        if head is not None:
            return SourceLocator(head, annotated.group(2).strip(), "web")

    return SourceLocator(None, text, "unknown")


def is_placeholder_summary(text: str | None) -> bool:
    """True when a summary carries no source-grounded information."""
    if text is None:
        return True
    stripped = text.strip()
    if not stripped:
        return True
    return stripped.casefold() == PLACEHOLDER_SUMMARY.casefold()
