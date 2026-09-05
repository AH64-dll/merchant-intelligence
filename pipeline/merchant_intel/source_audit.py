"""Read-only, resumable link-availability audit for web source locators.

The audit answers exactly one question: *can an unauthenticated browser open
this address right now?* It never judges a merchant, a source's credibility, or
the truth of a claim. Blocked, throttled, paywalled, or anti-bot protected
pages are reported as availability outcomes (``access_limited``), never as
broken links: the word "broken" or "dead" appears in no status name.

No cookies, ``Authorization`` headers, Facebook sessions, or any other
credential are sent. Each address gets one attempt, plus a single bounded
``GET`` retry when ``HEAD`` is unsupported or the transport fails.

Only ``sources.web_url`` values are probed. Offline locators (``whois:``) and
unclassified ones are never requested, and no source row is rewritten: results
land in ``source_link_checks``, keeping the immutable locator in ``sources``.
"""

from __future__ import annotations

import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Sequence
from urllib.parse import urljoin, urlsplit, urlunsplit

from merchant_intel.sources import safe_http_url

#: Controlled result vocabulary. Ordered from success to unavailability.
CHECK_STATUSES: tuple[str, ...] = (
    "reachable",
    "redirected",
    "not_found",
    "access_limited",
    "server_error",
    "network_error",
    "not_checked",
)

#: A stored check older than this is re-run by :func:`select_sources_to_check`.
STALE_AFTER_DAYS: int = 30

#: Politeness delay between two remote requests.
DEFAULT_DELAY_SEC: float = 1.5
DEFAULT_TIMEOUT_SEC: float = 12.0
DEFAULT_MAX_REDIRECTS: int = 3

USER_AGENT: str = "merchant-intelligence-source-audit/1.0 (+read-only link check)"

#: Redirect codes followed manually, one hop at a time.
REDIRECT_STATUSES: tuple[int, ...] = (301, 302, 303, 307, 308)

#: ``HEAD`` is rejected or unsupported; retry once with a bounded ``GET``.
FALLBACK_GET_STATUSES: tuple[int, ...] = (405, 501, 403)

#: Server replies that mean "you may not look", never "the page is gone".
ACCESS_LIMITED_STATUSES: tuple[int, ...] = (401, 403, 429)

#: Statuses that mean the server reports no content at this address.
NOT_FOUND_STATUSES: tuple[int, ...] = (404, 410)

#: Anti-bot / interstitial markers, matched case-insensitively in the excerpt.
ANTI_BOT_MARKERS: tuple[str, ...] = (
    "captcha",
    "recaptcha",
    "cf-browser-verification",
    "enable javascript and cookies to continue",
    "access denied",
    "are you a robot",
    "unusual traffic",
)

_MAX_BODY_BYTES = 65536  # hard ceiling per response; the body is never stored.
_EXCERPT_CHARS = 4096  # transient lowercase slice used only for marker matching.
_MAX_DETAIL_CHARS = 300

# Credential-bearing query parameters are redacted from any diagnostic text.
_SECRET_QUERY_KEYS = (
    "token",
    "access_token",
    "api_key",
    "apikey",
    "key",
    "secret",
    "password",
    "passwd",
    "auth",
    "sig",
    "signature",
    "session",
)
_SECRET_QUERY_RE = re.compile(
    r"(?i)\b(" + "|".join(_SECRET_QUERY_KEYS) + r")=([^&\s\"']+)"
)
_URL_IN_TEXT_RE = re.compile(r"(?i)\bhttps?://\S+")


@dataclass(frozen=True)
class LinkCheckResult:
    """One availability observation for one source locator.

    ``source_id`` is ``0`` for a standalone :func:`check_url` call;
    :func:`run_audit` rebinds it to the audited source before persisting.
    """

    source_id: int
    status: str
    final_url: str | None
    http_status: int | None
    detail: str


class _TransportFailure(Exception):
    """Non-HTTP failure (DNS, TLS, timeout, reset) raised by the fetcher."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Disable automatic redirect following.

    Every redirect method returns ``None``, so ``urllib`` re-dispatches to
    ``http_error_default`` and raises :class:`urllib.error.HTTPError` carrying
    the ``Location`` header. :func:`_http_fetch` then follows that single hop
    itself, which is how the final URL gets recorded.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None

    def http_error_301(self, req, fp, code, msg, headers):
        return None

    def http_error_302(self, req, fp, code, msg, headers):
        return None

    def http_error_303(self, req, fp, code, msg, headers):
        return None

    def http_error_307(self, req, fp, code, msg, headers):
        return None

    def http_error_308(self, req, fp, code, msg, headers):
        return None


_OPENER = urllib.request.build_opener(_NoRedirectHandler)


@dataclass(frozen=True)
class _Probe:
    """One round of requests (all ``HEAD`` hops, or all ``GET`` hops)."""

    status: int | None
    final_url: str
    excerpt: str
    hops: int
    method: str
    exhausted: bool


def _read_excerpt(fp: Any) -> str:
    """Read at most 64 KiB and return a lowercase marker-matching slice.

    The response is closed immediately and the payload is dropped: only the
    bounded lowercase excerpt survives this function.
    """
    try:
        raw = fp.read(_MAX_BODY_BYTES)
    except (OSError, ValueError):
        return ""
    finally:
        close = getattr(fp, "close", None)
        if close is not None:
            try:
                close()
            except OSError:
                pass
    if isinstance(raw, str):  # pragma: no cover - defensive
        return raw[:_EXCERPT_CHARS].casefold()
    return raw[:_EXCERPT_CHARS].decode("utf-8", "replace").casefold()


def _safe_detail_url(url: str | None) -> str:
    """Scheme, host, and path only: query strings and fragments are dropped."""
    if not url:
        return ""
    parts = urlsplit(url)
    netloc = parts.netloc
    if "@" in netloc:
        netloc = netloc.rsplit("@", 1)[1]
    return urlunsplit((parts.scheme, netloc, parts.path or "/", "", ""))


def _redact(text: str) -> str:
    """Strip credential-bearing query values from a diagnostic string."""
    without_urls = _URL_IN_TEXT_RE.sub(lambda m: _safe_detail_url(m.group(0)), text)
    return _SECRET_QUERY_RE.sub(lambda m: f"{m.group(1)}=[redacted]", without_urls)


def _detail(text: str) -> str:
    """Bound and sanitize a diagnostic string."""
    return _redact(" ".join(str(text).split()))[:_MAX_DETAIL_CHARS]


def _http_fetch(
    url: str, method: str, *, timeout: float = DEFAULT_TIMEOUT_SEC
) -> tuple[int | None, str, str]:
    """Perform exactly one request and return ``(status, resolved_url, excerpt)``.

    A redirect is reported as its 3xx status with ``resolved_url`` set to the
    absolute ``Location`` target; the caller decides whether to follow it. The
    excerpt is non-empty only for a ``GET``, and is discarded by the caller once
    anti-bot markers have been matched.
    """
    request = urllib.request.Request(
        url,
        method=method,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "Accept-Language": "en",
        },
    )
    try:
        response = _OPENER.open(request, timeout=timeout)
    except urllib.error.HTTPError as err:
        headers = err.headers or {}
        if err.code in REDIRECT_STATUSES:
            location = headers.get("Location") or headers.get("location")
            if location:
                return err.code, urljoin(url, location.strip()), ""
        excerpt = _read_excerpt(err) if method == "GET" else ""
        return err.code, url, excerpt
    except urllib.error.URLError as err:
        reason = getattr(err, "reason", err)
        raise _TransportFailure(f"{type(reason).__name__}: {reason}") from err
    except TimeoutError as err:
        raise _TransportFailure(f"TimeoutError: {err}") from err
    except OSError as err:  # socket-level failures not wrapped by urllib
        raise _TransportFailure(f"{type(err).__name__}: {err}") from err

    with response:
        status = int(getattr(response, "status", 0) or 0)
        final_url = response.geturl() or url
        excerpt = _read_excerpt(response) if method == "GET" else ""
    return status, final_url, excerpt


def _coerce_fetcher(
    fetcher: Callable[[str, str], tuple[int | None, str, str]] | None, timeout: float
) -> Callable[[str, str], tuple[int | None, str, str]]:
    """Return the injected fetcher, or the real one bound to ``timeout``."""
    if fetcher is not None:
        return fetcher
    return lambda url, method: _http_fetch(url, method, timeout=timeout)


def _looks_like_anti_bot(excerpt: str) -> bool:
    return any(marker in excerpt for marker in ANTI_BOT_MARKERS)


def _probe(
    fetch: Callable[[str, str], tuple[int | None, str, str]],
    start_url: str,
    method: str,
    max_redirects: int,
) -> _Probe:
    """Follow at most ``max_redirects`` hops for one HTTP method."""
    hops = 0
    current = start_url
    while True:
        status, final_url, excerpt = fetch(current, method)
        resolved = (final_url or current).strip() or current
        if status in REDIRECT_STATUSES and resolved != current:
            if hops >= max_redirects:
                return _Probe(status, resolved, excerpt, hops, method, True)
            hops += 1
            current = resolved
            continue
        return _Probe(status, resolved, excerpt, hops, method, False)


def _classify(probe: _Probe, start_url: str, source_id: int = 0) -> LinkCheckResult:
    """Map one probe to a :class:`LinkCheckResult`."""
    status = probe.status
    final_url = probe.final_url or start_url

    if probe.exhausted:
        return LinkCheckResult(
            source_id,
            "redirected",
            final_url,
            status,
            _detail(
                f"redirect limit reached after {probe.hops} hop(s); "
                f"stopped before {_safe_detail_url(final_url)}"
            ),
        )
    if status is None:
        return LinkCheckResult(
            source_id, "network_error", final_url, None, _detail("no HTTP response")
        )
    if 200 <= status < 300:
        if _looks_like_anti_bot(probe.excerpt):
            return LinkCheckResult(
                source_id,
                "access_limited",
                final_url,
                status,
                _detail(
                    "anti-bot interstitial detected; automated access not permitted "
                    "(no credentials are ever sent)"
                ),
            )
        if probe.hops and final_url != start_url:
            return LinkCheckResult(
                source_id,
                "redirected",
                final_url,
                status,
                _detail(
                    f"HTTP {status} after {probe.hops} redirect hop(s) -> "
                    f"{_safe_detail_url(final_url)}"
                ),
            )
        return LinkCheckResult(
            source_id,
            "reachable",
            final_url,
            status,
            _detail(f"HTTP {status} ({probe.method})"),
        )
    if status in NOT_FOUND_STATUSES:
        return LinkCheckResult(
            source_id,
            "not_found",
            final_url,
            status,
            _detail(f"HTTP {status}; the server reports no content at this address"),
        )
    if status in ACCESS_LIMITED_STATUSES:
        return LinkCheckResult(
            source_id,
            "access_limited",
            final_url,
            status,
            _detail(
                f"HTTP {status}; automated access not permitted "
                "(no credentials are ever sent)"
            ),
        )
    if 300 <= status < 400:
        if final_url != start_url:
            return LinkCheckResult(
                source_id,
                "redirected",
                final_url,
                status,
                _detail(
                    f"HTTP {status} redirect to {_safe_detail_url(final_url)} "
                    "not followed"
                ),
            )
        return LinkCheckResult(
            source_id,
            "reachable",
            final_url,
            status,
            _detail(f"HTTP {status} ({probe.method}); no redirect target supplied"),
        )
    if 500 <= status < 600:
        return LinkCheckResult(
            source_id,
            "server_error",
            final_url,
            status,
            _detail(f"HTTP {status}; the server reported an error"),
        )
    return LinkCheckResult(
        source_id,
        "access_limited",
        final_url,
        status,
        _detail(f"HTTP {status}; the request was not served (unclassified outcome)"),
    )


def check_url(
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT_SEC,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    fetcher: Callable[[str, str], tuple[int | None, str, str]] | None = None,
) -> LinkCheckResult:
    """Classify the availability of one browser-openable URL.

    ``fetcher(url, method) -> (http_status, resolved_url, body_excerpt)`` is an
    injection seam used by tests; it must perform a single request and return
    the 3xx status with the absolute ``Location`` target for a redirect. It may
    raise :class:`_TransportFailure` to model a transport-layer error.
    """
    start = (url or "").strip()
    if not start:
        return LinkCheckResult(
            0, "not_checked", None, None, _detail("empty locator; nothing to check")
        )
    if safe_http_url(start) is None:
        return LinkCheckResult(
            0,
            "not_checked",
            None,
            None,
            _detail("locator is not a browser-openable http(s) URL"),
        )

    fetch = _coerce_fetcher(fetcher, timeout)
    try:
        probe = _probe(fetch, start, "HEAD", max_redirects)
        if probe.status is None or probe.status in FALLBACK_GET_STATUSES:
            # HEAD unsupported or refused: one bounded GET, body never stored.
            try:
                retry = _probe(fetch, probe.final_url, "GET", max_redirects)
            except _TransportFailure:
                retry = None
            if retry is not None and retry.status not in FALLBACK_GET_STATUSES:
                probe = replace(
                    probe,
                    status=retry.status,
                    final_url=retry.final_url,
                    excerpt=retry.excerpt,
                    hops=probe.hops + retry.hops,
                    method=retry.method,
                    exhausted=probe.exhausted or retry.exhausted,
                )
    except _TransportFailure as err:
        # Single retry on a transient network failure, then report it.
        try:
            probe = _probe(fetch, start, "GET", max_redirects)
        except _TransportFailure as retry_err:
            return LinkCheckResult(
                0,
                "network_error",
                start,
                None,
                _detail(f"transport failure: {retry_err.message}"),
            )
        if probe.status is None:
            return LinkCheckResult(
                0,
                "network_error",
                start,
                None,
                _detail(f"transport failure: {err.message}"),
            )
    return _classify(probe, start)


def _query(conn: Any, sql: str, params: Sequence[Any] = ()) -> list[Any]:
    """Run a read query against a ``Database`` or a raw sqlite3 connection."""
    if hasattr(conn, "query"):
        return list(conn.query(sql, tuple(params)))
    return list(conn.execute(sql, tuple(params)).fetchall())


def _write(conn: Any, sql: str, params: Sequence[Any] = ()) -> None:
    """Run one write against a ``Database`` or a raw sqlite3 connection.

    A raw connection commits immediately so an interrupted audit stays
    resumable; ``Database`` is autocommit by construction.
    """
    if hasattr(conn, "query"):
        conn.execute(sql, tuple(params))
        return
    with conn:
        conn.execute(sql, tuple(params))


def select_sources_to_check(
    conn: Any,
    *,
    limit: int | None = None,
    stale_after_days: int = STALE_AFTER_DAYS,
) -> list[tuple[int, str]]:
    """Return ``(source_id, web_url)`` pairs that need an availability check.

    A source qualifies when ``access_kind='web'`` with a non-empty
    ``web_url``, and it has either no check row or a check row older than
    ``stale_after_days``. Never-checked sources come first, then the oldest
    check, then the lowest id, so a capped run makes steady forward progress.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=stale_after_days)).isoformat()
    sql = """
        SELECT s.id AS source_id, s.web_url AS web_url
        FROM sources s
        LEFT JOIN source_link_checks c ON c.source_id = s.id
        WHERE s.access_kind = 'web'
          AND s.web_url IS NOT NULL
          AND TRIM(s.web_url) <> ''
          AND (
                c.source_id IS NULL
                OR c.checked_at IS NULL
                OR datetime(c.checked_at) IS NULL
                OR datetime(c.checked_at) < datetime(?)
              )
        ORDER BY (c.checked_at IS NULL) DESC, c.checked_at ASC, s.id ASC
        LIMIT ?
    """
    rows = _query(conn, sql, (cutoff, -1 if limit is None else int(limit)))
    return [(int(row["source_id"]), str(row["web_url"])) for row in rows]


def persist_check(
    conn: Any, result: LinkCheckResult, checked_at: str | None = None
) -> None:
    """Store the latest check for a source, replacing any earlier result."""
    stamp = checked_at or datetime.now(timezone.utc).isoformat()
    _write(
        conn,
        """
        INSERT INTO source_link_checks
            (source_id, status, checked_at, final_url, http_status, detail)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
            status = excluded.status,
            checked_at = excluded.checked_at,
            final_url = excluded.final_url,
            http_status = excluded.http_status,
            detail = excluded.detail
        """,
        (
            int(result.source_id),
            result.status,
            stamp,
            result.final_url,
            result.http_status,
            _detail(result.detail),
        ),
    )


def run_audit(
    db: Any,
    *,
    limit: int | None = None,
    delay_sec: float = DEFAULT_DELAY_SEC,
    timeout: float = DEFAULT_TIMEOUT_SEC,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    stale_after_days: int = STALE_AFTER_DAYS,
    dry_run: bool = True,
    progress: Callable[[LinkCheckResult], None] | None = None,
) -> dict[str, Any]:
    """Check every qualifying web source and return a summary.

    With ``dry_run=True`` (the default) every request is still performed and
    every result computed, but nothing is written. Sources are checked oldest
    first; ``delay_sec`` separates consecutive remote requests and no sleep
    follows the final one.
    """
    by_status = {status: 0 for status in CHECK_STATUSES}
    pending = select_sources_to_check(db, limit=limit, stale_after_days=stale_after_days)
    checked = 0
    errors = 0
    started = time.monotonic()

    for index, (source_id, web_url) in enumerate(pending):
        if not web_url or safe_http_url(web_url) is None:
            continue
        if index and delay_sec > 0:
            time.sleep(delay_sec)
        try:
            result = check_url(
                web_url, timeout=timeout, max_redirects=max_redirects
            )
        except Exception as err:  # a bad URL must not abort the whole audit
            result = LinkCheckResult(
                int(source_id),
                "network_error",
                web_url,
                None,
                _detail(f"unexpected failure: {type(err).__name__}: {err}"),
            )
        result = replace(result, source_id=int(source_id))
        by_status[result.status] = by_status.get(result.status, 0) + 1
        if result.status == "network_error":
            errors += 1
        checked += 1
        if progress is not None:
            progress(result)
        if not dry_run:
            persist_check(db, result)

    return {
        "checked": checked,
        "dry_run": bool(dry_run),
        "by_status": by_status,
        "errors": errors,
        "elapsed_sec": round(time.monotonic() - started, 3),
    }
