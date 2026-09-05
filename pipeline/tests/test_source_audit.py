"""Tests for the read-only source-link availability audit.

No test reaches the public internet: every HTTP path is served by a
``ThreadingHTTPServer`` bound to ``127.0.0.1`` on an ephemeral port, and the
injected ``fetcher`` seam covers the outcomes no local server can produce.
"""

from __future__ import annotations

import threading
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

import pytest

from merchant_intel import source_audit
from merchant_intel.database import Database
from merchant_intel.source_audit import (
    ACCESS_LIMITED_STATUSES,
    CHECK_STATUSES,
    DEFAULT_MAX_REDIRECTS,
    LinkCheckResult,
    check_url,
    persist_check,
    run_audit,
    select_sources_to_check,
)

CAPTCHA_BODY = (
    b"<!doctype html><html><body><h1>Verify you are human</h1>"
    b"<div class='g-recaptcha' data-sitekey='x'></div>"
    b"<p>Enable JavaScript and cookies to continue.</p></body></html>"
)

# path -> (status, body, extra_headers, head_status)
# ``head_status`` overrides the status for HEAD only; a server that rejects HEAD
# is what forces the bounded GET fallback.
ROUTES: dict[str, tuple[int, bytes, dict[str, str], int | None]] = {
    "/ok": (200, b"ok", {}, None),
    "/moved": (302, b"", {"Location": "/ok"}, None),
    "/gone": (404, b"gone", {}, None),
    "/forbidden": (403, b"forbidden", {}, None),
    "/bot": (200, CAPTCHA_BODY, {}, 405),
    "/boom": (500, b"boom", {}, None),
    "/headless": (200, b"ok", {}, 405),
    "/toomany": (429, b"slow down", {}, None),
    "/loopa": (302, b"", {"Location": "/loopb"}, None),
    "/loopb": (302, b"", {"Location": "/loopa"}, None),
}


class _AuditHandler(BaseHTTPRequestHandler):
    """Serves the fixed audit fixtures for both HEAD and GET."""

    protocol_version = "HTTP/1.1"
    server_version = "source-audit-fixture/1.0"

    def log_message(self, *args: Any) -> None:  # silence stderr noise
        return None

    def do_HEAD(self) -> None:  # noqa: N802 - http.server naming
        self._dispatch(head_only=True)

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        self._dispatch(head_only=False)

    def _dispatch(self, *, head_only: bool) -> None:
        path = urlsplit(self.path).path
        route = ROUTES.get(path)
        if route is None:
            self._send(404, b"no such fixture", head_only=head_only)
            return
        status, body, headers, head_status = route
        code = head_status if (head_only and head_status is not None) else status
        self._send(code, body, extra_headers=headers, head_only=head_only)

    def _send(
        self,
        code: int,
        body: bytes,
        *,
        extra_headers: dict[str, str] | None = None,
        head_only: bool,
    ) -> None:
        self.send_response(code)
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body and not head_only:
            self.wfile.write(body)


@pytest.fixture(scope="module")
def server():
    """Base URL of the local fixture server (127.0.0.1, ephemeral port)."""
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _AuditHandler)
    httpd.daemon_threads = True
    port = int(httpd.server_address[1])
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    # Local requests must never be routed through an environment proxy.
    original = source_audit._OPENER
    source_audit._OPENER = urllib.request.build_opener(
        source_audit._NoRedirectHandler, urllib.request.ProxyHandler({})
    )
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        source_audit._OPENER = original
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def _add_source(
    db: Database,
    *,
    url: str,
    web_url: str | None,
    access_kind: str = "web",
) -> int:
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO sources
               (url, canonical_url, platform, source_type,
                first_seen_at, last_seen_at, web_url, access_kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (url, url, "web", "official", now, now, web_url, access_kind),
    )
    row = db.query_one("SELECT last_insert_rowid() AS id")
    assert row is not None
    return int(row["id"])


def _check_row(db: Database, source_id: int, status: str, checked_at: str) -> None:
    db.execute(
        """INSERT INTO source_link_checks
               (source_id, status, checked_at, final_url, http_status, detail)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (source_id, status, checked_at, None, 200, "seeded"),
    )


# --------------------------------------------------------------------------
# 2. Classification of each served response
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path, expected_status, expected_http",
    [
        ("/ok", "reachable", 200),
        ("/moved", "redirected", 200),
        ("/gone", "not_found", 404),
        ("/forbidden", "access_limited", 403),
        ("/bot", "access_limited", 200),
        ("/boom", "server_error", 500),
        ("/headless", "reachable", 200),
    ],
)
def test_status_for_each_fixture_path(
    server: str, path: str, expected_status: str, expected_http: int
):
    result = check_url(f"{server}{path}")
    assert result.status == expected_status
    assert result.http_status == expected_http
    assert result.status in CHECK_STATUSES
    assert result.detail
    assert len(result.detail) <= 300


def test_redirect_records_final_url(server: str):
    result = check_url(f"{server}/moved")
    assert result.status == "redirected"
    assert result.final_url is not None
    assert result.final_url.endswith("/ok")
    assert f"{server}/ok" == result.final_url
    assert "/moved" not in (result.final_url or "")


def test_headless_get_fallback_reads_body_markers(server: str):
    """HEAD 405 forces the bounded GET; a clean body stays reachable."""
    result = check_url(f"{server}/headless")
    assert result.status == "reachable"
    assert result.http_status == 200


def test_anti_bot_body_is_availability_not_a_broken_link(server: str):
    result = check_url(f"{server}/bot")
    assert result.status == "access_limited"
    assert result.http_status == 200
    assert "credential" in result.detail


def test_redirect_limit_is_exhausted_classified_as_redirected(server: str):
    result = check_url(f"{server}/loopa", max_redirects=2)
    assert result.status == "redirected"
    assert result.http_status == 302
    assert "2 hop" in result.detail


def test_default_max_redirects_is_conservative():
    assert DEFAULT_MAX_REDIRECTS == 3


# --------------------------------------------------------------------------
# 3. Selection of sources that need checking
# --------------------------------------------------------------------------


def test_select_sources_to_check_filters_and_orders(tmp_path):
    db = Database(tmp_path / "select.sqlite3")
    now = datetime.now(timezone.utc)

    fresh = _add_source(db, url="https://fresh.example/page", web_url="https://fresh.example/page")
    recent = _add_source(db, url="https://recent.example/page", web_url="https://recent.example/page")
    stale40 = _add_source(db, url="https://stale40.example/page", web_url="https://stale40.example/page")
    stale90 = _add_source(db, url="https://stale90.example/page", web_url="https://stale90.example/page")
    offline = _add_source(db, url="whois:shop.example", web_url=None, access_kind="whois")
    offline_with_url = _add_source(
        db, url="whois:other.example", web_url="https://other.example/x", access_kind="whois"
    )
    blank = _add_source(db, url="https://blank.example/page", web_url="")

    _check_row(db, recent, "reachable", now.isoformat())
    _check_row(db, stale40, "reachable", (now - timedelta(days=40)).isoformat())
    _check_row(db, stale90, "reachable", (now - timedelta(days=90)).isoformat())

    selected = select_sources_to_check(db)
    assert [source_id for source_id, _ in selected] == [fresh, stale90, stale40]
    assert dict(selected)[stale40] == "https://stale40.example/page"

    assert [source_id for source_id, _ in select_sources_to_check(db, limit=1)] == [fresh]
    assert [source_id for source_id, _ in select_sources_to_check(db, limit=2)] == [
        fresh,
        stale90,
    ]

    excluded = {offline, offline_with_url, blank, recent}
    assert excluded.isdisjoint({source_id for source_id, _ in selected})


def test_select_sources_to_check_respects_stale_window(tmp_path):
    db = Database(tmp_path / "stale.sqlite3")
    now = datetime.now(timezone.utc)
    ten_days = _add_source(db, url="https://ten.example/p", web_url="https://ten.example/p")
    _check_row(db, ten_days, "reachable", (now - timedelta(days=10)).isoformat())

    assert select_sources_to_check(db) == []
    assert [sid for sid, _ in select_sources_to_check(db, stale_after_days=5)] == [ten_days]


def test_select_sources_to_check_treats_unparseable_timestamp_as_stale(tmp_path):
    db = Database(tmp_path / "junk.sqlite3")
    source_id = _add_source(db, url="https://junk.example/p", web_url="https://junk.example/p")
    _check_row(db, source_id, "reachable", "not-a-timestamp")
    assert [sid for sid, _ in select_sources_to_check(db)] == [source_id]


# --------------------------------------------------------------------------
# 4. Persistence: latest check only
# --------------------------------------------------------------------------


def test_persist_check_upserts_latest(tmp_path):
    db = Database(tmp_path / "upsert.sqlite3")
    source_id = _add_source(db, url="https://up.example/p", web_url="https://up.example/p")

    persist_check(
        db,
        LinkCheckResult(source_id, "reachable", "https://up.example/p", 200, "first"),
        checked_at="2026-01-01T00:00:00+00:00",
    )
    persist_check(
        db,
        LinkCheckResult(source_id, "server_error", "https://up.example/p", 503, "second"),
    )

    rows = db.query("SELECT * FROM source_link_checks WHERE source_id=?", (source_id,))
    assert len(rows) == 1
    row = rows[0]
    assert row["status"] == "server_error"
    assert row["http_status"] == 503
    assert row["detail"] == "second"
    assert row["checked_at"] != "2026-01-01T00:00:00+00:00"
    assert row["checked_at"].startswith(datetime.now(timezone.utc).date().isoformat())


# --------------------------------------------------------------------------
# 5. run_audit: dry run versus apply
# --------------------------------------------------------------------------


def _seed_audit_db(tmp_path, server: str, paths: list[str]) -> Database:
    db = Database(tmp_path / "audit.sqlite3")
    for path in paths:
        url = f"{server}{path}"
        _add_source(db, url=url, web_url=url)
    return db


def test_run_audit_dry_run_writes_nothing(tmp_path, server: str):
    db = _seed_audit_db(tmp_path, server, ["/ok", "/gone", "/boom"])

    summary = run_audit(db, delay_sec=0, dry_run=True)

    assert summary["checked"] == 3
    assert summary["dry_run"] is True
    assert summary["errors"] == 0
    assert summary["elapsed_sec"] >= 0
    nonzero = {status: count for status, count in summary["by_status"].items() if count}
    assert nonzero == {"reachable": 1, "not_found": 1, "server_error": 1}
    assert db.query("SELECT COUNT(*) AS n FROM source_link_checks")[0]["n"] == 0


def test_run_audit_apply_persists_every_checked_source(tmp_path, server: str):
    db = _seed_audit_db(tmp_path, server, ["/ok", "/gone", "/boom", "/forbidden"])
    seen: list[LinkCheckResult] = []

    summary = run_audit(db, delay_sec=0, dry_run=False, progress=seen.append)

    assert summary["checked"] == 4
    assert summary["dry_run"] is False
    assert len(seen) == 4
    rows = db.query("SELECT source_id, status, http_status, checked_at FROM source_link_checks")
    assert len(rows) == 4
    assert sorted(row["status"] for row in rows) == [
        "access_limited",
        "not_found",
        "reachable",
        "server_error",
    ]
    assert all(row["checked_at"] for row in rows)

    # Every source now holds a fresh check, so a second run is a no-op: the
    # audit is resumable rather than repetitive.
    assert run_audit(db, delay_sec=0, dry_run=False)["checked"] == 0


def test_run_audit_honours_limit(tmp_path, server: str):
    db = _seed_audit_db(tmp_path, server, ["/ok", "/gone", "/boom"])
    summary = run_audit(db, limit=2, delay_sec=0, dry_run=False)
    assert summary["checked"] == 2
    assert db.query("SELECT COUNT(*) AS n FROM source_link_checks")[0]["n"] == 2


def test_run_audit_counts_network_errors(tmp_path, monkeypatch):
    """An unreachable host is a classified outcome, never an aborted audit."""
    db = Database(tmp_path / "offline.sqlite3")
    _add_source(db, url="https://offline.example/x", web_url="https://offline.example/x")

    def boom(url: str, **_kwargs: Any) -> LinkCheckResult:
        raise source_audit._TransportFailure("gaierror: name or service not known")

    monkeypatch.setattr(source_audit, "check_url", boom)
    summary = run_audit(db, delay_sec=0, dry_run=True)

    assert summary["checked"] == 1
    assert summary["errors"] == 1
    assert summary["by_status"]["network_error"] == 1
    assert db.query("SELECT COUNT(*) AS n FROM source_link_checks")[0]["n"] == 0


# --------------------------------------------------------------------------
# 6. Vocabulary and safety rules
# --------------------------------------------------------------------------


def test_no_status_name_calls_a_page_broken_or_dead():
    for status in CHECK_STATUSES:
        assert "broken" not in status.lower()
        assert "dead" not in status.lower()


@pytest.mark.parametrize("path", ["/forbidden", "/toomany"])
def test_blocked_responses_are_never_not_found(server: str, path: str):
    result = check_url(f"{server}{path}")
    assert result.status == "access_limited"
    assert result.status != "not_found"
    assert result.http_status in (403, 429)


@pytest.mark.parametrize("status", [401, 403, 429])
def test_injected_blocked_statuses_are_access_limited(status: int):
    def fetcher(url: str, method: str) -> tuple[int, str, str]:
        return status, url, ""

    result = check_url("https://blocked.example/page", fetcher=fetcher)
    assert result.status == "access_limited"
    assert result.http_status == status
    assert status in ACCESS_LIMITED_STATUSES


def test_non_web_locator_is_not_checked_without_network():
    result = check_url("whois://example.test")
    assert result.status == "not_checked"
    assert result.http_status is None
    assert result.final_url is None


def test_transport_failure_is_network_error():
    def fetcher(url: str, method: str) -> tuple[int, str, str]:
        raise source_audit._TransportFailure("gaierror: name or service not known")

    result = check_url("https://example.test/page", fetcher=fetcher)
    assert result.status == "network_error"
    assert result.http_status is None


def test_detail_is_bounded_and_never_leaks_query_secrets():
    def fetcher(url: str, method: str) -> tuple[int, str, str]:
        raise source_audit._TransportFailure(
            "failed at https://host.test/p?token=abc123&sig=zzz"
        )

    result = check_url("https://host.test/p?token=abc123&sig=zzz", fetcher=fetcher)
    assert result.status == "network_error"
    assert "abc123" not in result.detail
    assert "zzz" not in result.detail
    assert "token=" not in result.detail
    assert len(result.detail) <= 300


def test_redirect_detail_drops_the_query_string():
    target = "https://host.test/landing?token=abc123&utm=x"

    def fetcher(url: str, method: str) -> tuple[int, str, str]:
        if url.endswith("/start"):
            return 302, target, ""
        return 200, url, ""

    result = check_url("https://host.test/start", fetcher=fetcher)
    assert result.status == "redirected"
    assert result.final_url == target
    assert "abc123" not in result.detail


def test_injected_anti_bot_body_is_access_limited():
    def fetcher(url: str, method: str) -> tuple[int, str, str]:
        return 200, url, "please complete the recaptcha challenge"

    result = check_url("https://host.test/p", fetcher=fetcher)
    assert result.status == "access_limited"
    assert result.http_status == 200
