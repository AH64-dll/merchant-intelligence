"""CLI wiring tests for the v4 source backfill and the source-link audit.

Both commands are dry-run by default, so these tests pin the property that
matters: without ``--apply`` nothing is written, with ``--apply`` the write
lands once and a second run is a no-op. The audit is exercised through an
injected ``run_audit``, so no request ever leaves the process. Every database
is a temp file built with the real ``Database`` class and, where the
pre-migration path matters, degraded back to schema v3.
"""

import hashlib
import importlib
import io
import json
import sqlite3
import sys
import types
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import pytest

from merchant_intel import cli
from merchant_intel.database import Database
from merchant_intel.sources import classify_source_locator

# The 16 known non-browser-safe locators, verbatim from the master dataset:
# ten ``whois:`` registry lookups and six annotated http(s) URLs. They are the
# migration fixtures, so the backfill report must classify them exactly.
WHOIS_IDS = (1081, 1119, 1123, 1129, 1130, 1133, 1174, 1180, 1203, 1962)
ANNOTATED_WEB_IDS = (1442, 1456, 1457, 1466, 1559, 1567)

NON_BROWSER_LOCATORS: dict[int, tuple[str, str]] = {
    1081: (
        "whois://fitandfix.com (Verisign registry output)",
        "whois://fitandfix.com (verisign registry output)",
    ),
    1119: ("whois://ecc-alex.com", "whois://ecc-alex.com"),
    1123: ("whois://elhamdstore.com", "whois://elhamdstore.com"),
    1129: ("whois://elmhnds.com", "whois://elmhnds.com"),
    1130: ("whois://elmahllawy.com", "whois://elmahllawy.com"),
    1133: ("whois://fathallamarket.com", "whois://fathallamarket.com"),
    1174: (
        "whois://oscarstores.com (Verisign .com registry via whois CLI)",
        "whois://oscarstores.com (verisign .com registry via whois cli)",
    ),
    1180: (
        "whois://samehmouradpharmacy.com (Verisign .com registry via whois CLI)",
        "whois://samehmouradpharmacy.com (verisign .com registry via whois cli)",
    ),
    1203: ("whois:turbo-computer.com", "https://whois:turbo-computer.com"),
    1442: (
        "https://whois.verisign-grs.com/ (record: highendstore.net)",
        "https://whois.verisign-grs.com/ (record: highendstore.net)",
    ),
    1456: (
        "https://www.cpa.gov.eg (site-restricted query: راية / Raya / Rayashop)",
        "https://cpa.gov.eg (site-restricted query: راية / Raya / Rayashop)",
    ),
    1457: (
        "https://whois.verisign-grs.com/ (record: elfergany.com)",
        "https://whois.verisign-grs.com/ (record: elfergany.com)",
    ),
    1466: (
        "https://cpa.gov.eg (site-restricted query: iGenius / آي جينيوس)",
        "https://cpa.gov.eg (site-restricted query: igenius / آي جينيوس)",
    ),
    1559: (
        "https://cpa.gov.eg/ar-eg/قضايا-وأحكام/PgrID/628/PageID/1 … PageID/7"
        " (plus CategoryID/20 view)",
        "https://cpa.gov.eg/ar-eg/قضايا-وأحكام/PgrID/628/PageID/1 … PageID/7"
        " (plus CategoryID/20 view)",
    ),
    1567: (
        "https://fixawy.com/ar/contact (also /ar/help, /ar, /en, /en/contact,"
        " /en/help)",
        "https://fixawy.com/ar/contact (also /ar/help, /ar, /en, /en/contact,"
        " /en/help)",
    ),
    1962: ("whois://fixawy.com", "whois://fixawy.com"),
}

CLEAN_LOCATORS: dict[int, tuple[str, str]] = {
    1: ("https://Example.com/ar/1?b=2#c", "https://example.com/ar/1?b=2#c"),
    2: ("http://shop.test/", "http://shop.test/"),
}

CHECK_STATUSES: tuple[str, ...] = (
    "reachable",
    "redirected",
    "not_found",
    "access_limited",
    "server_error",
    "network_error",
    "not_checked",
)


def _write_config(path: Path, db_path: Path) -> Path:
    config = path / "config.yaml"
    config.write_text(f"database:\n  path: {db_path.as_posix()}\n", encoding="utf-8")
    return config


def _insert_sources(path: Path, rows: dict[int, tuple[str, str]]) -> None:
    conn = sqlite3.connect(path)
    for source_id, (url, canonical_url) in rows.items():
        conn.execute(
            "INSERT INTO sources (id, url, canonical_url, platform, source_type,"
            " first_seen_at, last_seen_at)"
            " VALUES (?, ?, ?, 'web', 'other', '2026-01-01T00:00:00',"
            " '2026-01-01T00:00:00')",
            (source_id, url, canonical_url),
        )
    conn.commit()
    conn.close()


def _v3_database(path: Path) -> Path:
    """Real v4 database degraded back to the v3 shape, with the fixture rows."""
    db = Database(path)
    conn = db._conn
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("DROP TABLE merchant_briefs")
    conn.execute("DROP TABLE source_link_checks")
    for column in ("web_url", "source_label", "locator_note", "access_kind"):
        conn.execute(f"ALTER TABLE sources DROP COLUMN {column}")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("DELETE FROM schema_version")
    conn.execute("INSERT INTO schema_version(version) VALUES (3)")
    db.close()
    _insert_sources(path, {**CLEAN_LOCATORS, **NON_BROWSER_LOCATORS})
    return path


def _columns(path: Path, table: str) -> set[str]:
    conn = sqlite3.connect(path)
    names = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    conn.close()
    return names


def _tables(path: Path) -> set[str]:
    conn = sqlite3.connect(path)
    names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master")}
    conn.close()
    return names


def _source_rows(path: Path) -> list[tuple]:
    """Read sources rows, tolerating both the v3 and v4 column sets.

    The v4 columns are only present once ``--apply`` has migrated the file,
    and the dry-run tests rely on reading the rows *before* that happens.
    """
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    names = {row[1] for row in conn.execute("PRAGMA table_info(sources)")}
    v4_columns = [name for name in ("web_url", "source_label", "locator_note", "access_kind") if name in names]
    columns = ["id", "url", "canonical_url", *v4_columns]
    rows = [
        tuple(row)
        for row in conn.execute(
            f"SELECT {', '.join(columns)} FROM sources ORDER BY id"
        )
    ]
    conn.close()
    return rows

def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def _last_json_object(text: str) -> dict | None:
    """Return the last complete pretty-printed JSON object in ``text``.

    CLI reports use ``indent=2`` so a single-line scan never sees a whole
    document; walk back from the last top-level closer to its matching
    column-0 opener.
    """
    for end in range(len(text) - 1, -1, -1):
        if text[end] != "}":
            continue
        for start in range(end, -1, -1):
            if text[start] == "{" and (start == 0 or text[start - 1] == "\n"):
                try:
                    candidate = json.loads(text[start : end + 1])
                except ValueError:
                    break
                if isinstance(candidate, dict):
                    return candidate
    return None


def _run(argv: list[str]) -> tuple[int, dict | None, str]:
    """Invoke the CLI, returning (exit code, last JSON payload, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = cli.main(argv)
    return code, _last_json_object(out.getvalue()), err.getvalue()


class FakeAudit:
    """Stand-in for ``merchant_intel.source_audit``: no sockets, real SQL."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def select_sources_to_check(self, conn, *, limit=None, stale_after_days=30):
        pending = []
        for row in conn.execute(
            "SELECT id, web_url FROM sources"
            " WHERE web_url IS NOT NULL AND TRIM(web_url) <> '' ORDER BY id"
        ):
            source_id, web_url = int(row[0]), row[1]
            seen = conn.execute(
                "SELECT 1 FROM source_link_checks WHERE source_id=?", (source_id,)
            ).fetchone()
            if seen is None:
                pending.append((source_id, web_url))
        return pending[:limit] if limit else pending

    def run_audit(
        self,
        db,
        *,
        limit=None,
        delay_sec=1.5,
        timeout=12.0,
        max_redirects=3,
        stale_after_days=30,
        dry_run=True,
        progress=None,
    ):
        self.calls.append(
            {
                "limit": limit,
                "delay_sec": delay_sec,
                "timeout": timeout,
                "max_redirects": max_redirects,
                "stale_after_days": stale_after_days,
                "dry_run": dry_run,
            }
        )
        pending = self.select_sources_to_check(
            db, limit=limit, stale_after_days=stale_after_days
        )
        by_status = {name: 0 for name in CHECK_STATUSES}
        for source_id, web_url in pending:
            by_status["reachable"] += 1
            if not dry_run:
                db.execute(
                    "INSERT OR REPLACE INTO source_link_checks"
                    " (source_id, status, checked_at, final_url, http_status, detail)"
                    " VALUES (?, 'reachable', '2026-09-01T00:00:00+00:00', ?, 200, '')",
                    (source_id, web_url),
                )
        return {
            "checked": len(pending),
            "dry_run": dry_run,
            "by_status": by_status,
            "errors": 0,
            "elapsed_sec": 0.5,
        }


@pytest.fixture
def fake_audit(monkeypatch):
    """Install :class:`FakeAudit` as the audit module the CLI resolves."""
    try:
        module = importlib.import_module("merchant_intel.source_audit")
    except ImportError:
        module = types.ModuleType("merchant_intel.source_audit")
        module.CHECK_STATUSES = CHECK_STATUSES
        module.STALE_AFTER_DAYS = 30
        module.DEFAULT_DELAY_SEC = 1.5
        module.DEFAULT_TIMEOUT_SEC = 12.0
        module.DEFAULT_MAX_REDIRECTS = 3
        monkeypatch.setitem(sys.modules, "merchant_intel.source_audit", module)
    fake = FakeAudit()
    monkeypatch.setattr(module, "run_audit", fake.run_audit)
    monkeypatch.setattr(module, "select_sources_to_check", fake.select_sources_to_check)
    monkeypatch.setattr(cli, "source_audit", module)
    return fake


def test_backfill_dry_run_reports_without_writing(tmp_path):
    db_path = _v3_database(tmp_path / "v3.db")
    digest_before = _digest(db_path)
    rows_before = _source_rows(db_path)

    code, payload, _ = _run(["backfill-source-metadata", "--db", str(db_path)])

    assert code == 0
    assert payload["mode"] == "dry-run"
    assert payload["schema_version"] == 3
    assert payload["sources_total"] == 18
    assert payload["by_access_kind"] == {
        "web": 8,  # 2 clean + 6 annotated
        "whois": 10,
        "offline": 0,
        "unknown": 0,
    }
    assert payload["with_web_url"] == 8
    # All ten whois locators keep a non-empty note (the bare domain), and the
    # six annotated web URLs keep their explanatory tail: 16 in total.
    assert payload["with_locator_note"] == 16
    # Nothing was written: still v3, no v4 columns, byte-identical file.
    assert _digest(db_path) == digest_before
    assert _source_rows(db_path) == rows_before
    assert "web_url" not in _columns(db_path, "sources")
    assert "source_link_checks" not in _tables(db_path)

    fixtures = {item["source_id"]: item for item in payload["non_browser_locators"]}
    assert set(fixtures) == set(NON_BROWSER_LOCATORS)
    for source_id in WHOIS_IDS:
        assert fixtures[source_id]["access_kind"] == "whois"
        assert fixtures[source_id]["web_url"] is None
        assert fixtures[source_id]["locator_note"]
    for source_id in ANNOTATED_WEB_IDS:
        assert fixtures[source_id]["access_kind"] == "web"
        assert fixtures[source_id]["web_url"].startswith("http")
        assert fixtures[source_id]["locator_note"]


def test_backfill_dry_run_uses_the_configured_database(tmp_path):
    db_path = _v3_database(tmp_path / "configured.db")
    config = _write_config(tmp_path, db_path)
    digest_before = _digest(db_path)

    code, payload, _ = _run(["--config", str(config), "backfill-source-metadata"])

    assert code == 0
    assert payload["database"] == str(db_path)
    assert payload["mode"] == "dry-run"
    assert _digest(db_path) == digest_before
    assert "web_url" not in _columns(db_path, "sources")


def test_backfill_apply_writes_once_and_then_noops(tmp_path):
    db_path = _v3_database(tmp_path / "apply.db")

    code, payload, _ = _run(["backfill-source-metadata", "--db", str(db_path), "--apply"])

    assert code == 0
    assert payload["mode"] == "apply"
    assert payload["schema_version"] == 4
    assert payload["by_access_kind"]["web"] == 8
    assert payload["by_access_kind"]["whois"] == 10

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, url, web_url, source_label, locator_note, access_kind"
        " FROM sources ORDER BY id"
    ).fetchall()
    version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    conn.close()
    assert version == 4
    assert len(rows) == 18
    for row in rows:
        locator = classify_source_locator(row["url"])
        assert row["web_url"] == locator.web_url
        assert row["locator_note"] == locator.locator_note
        assert row["access_kind"] == locator.access_kind
        assert row["source_label"] == "", "source_label must never be backfilled"

    # ``url``/``canonical_url`` survive byte-for-byte.
    raw = _source_rows(db_path)
    assert {
        row[0]: (row[1], row[2]) for row in raw
    } == {**CLEAN_LOCATORS, **NON_BROWSER_LOCATORS}

    # A second apply is a no-op: skipped, exit 0, identical rows.
    code, payload, _ = _run(["backfill-source-metadata", "--db", str(db_path), "--apply"])
    assert code == 0
    assert payload["mode"] == "skipped"
    assert payload["stored_mismatch_count"] == 0
    assert _source_rows(db_path) == raw

    # A dry-run against the migrated file is also a no-op and reports drift.
    code, payload, _ = _run(["backfill-source-metadata", "--db", str(db_path)])
    assert code == 0
    assert payload["mode"] == "skipped"
    assert payload["stored_mismatch_count"] == 0
    assert _source_rows(db_path) == raw




def test_backfill_dry_run_reports_stored_drift(tmp_path):
    db_path = _v3_database(tmp_path / "drift.db")
    _run(["backfill-source-metadata", "--db", str(db_path), "--apply"])

    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE sources SET access_kind='unknown' WHERE id=1081")
    conn.commit()
    conn.close()
    rows_before = _source_rows(db_path)

    code, payload, _ = _run(["backfill-source-metadata", "--db", str(db_path)])

    assert code == 0
    assert payload["mode"] == "skipped"
    assert payload["stored_mismatch_count"] == 1
    mismatch = payload["stored_mismatches"][0]
    assert mismatch["source_id"] == 1081
    assert mismatch["stored_access_kind"] == "unknown"
    assert mismatch["computed_access_kind"] == "whois"
    assert _source_rows(db_path) == rows_before


def test_audit_source_links_refuses_unmigrated_database(tmp_path):
    db_path = _v3_database(tmp_path / "audit-v3.db")

    code, _, stderr = _run(["audit-source-links", "--db", str(db_path)])

    assert code == 2
    assert "backfill-source-metadata --apply" in stderr
    assert "schema v3" in stderr


def test_audit_source_links_refuses_when_web_url_unpopulated(tmp_path):
    db_path = tmp_path / "no-web.db"
    db = Database(db_path)
    db.close()
    _insert_sources(db_path, {1081: NON_BROWSER_LOCATORS[1081]})

    code, _, stderr = _run(["audit-source-links", "--db", str(db_path)])

    assert code == 2
    assert "web_url" in stderr


def test_audit_source_links_dry_run_writes_nothing(tmp_path, fake_audit):
    db_path = _v3_database(tmp_path / "audit.db")
    _run(["backfill-source-metadata", "--db", str(db_path), "--apply"])
    digest_before = _digest(db_path)

    code, payload, _ = _run(["audit-source-links", "--db", str(db_path)])

    assert code == 0
    assert payload["mode"] == "dry-run"
    assert payload["checked"] == 8
    assert payload["by_status"]["reachable"] == 8
    assert payload["sources_still_unchecked"] == 8
    assert [call["dry_run"] for call in fake_audit.calls] == [True]
    assert fake_audit.calls[0]["delay_sec"] == 1.5
    assert fake_audit.calls[0]["timeout"] == 12.0
    assert fake_audit.calls[0]["max_redirects"] == 3
    assert fake_audit.calls[0]["stale_after_days"] == 30

    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT COUNT(*) FROM source_link_checks").fetchone()[0] == 0
    conn.close()
    assert _digest(db_path) == digest_before


def test_audit_source_links_apply_persists_and_resumes(tmp_path, fake_audit):
    db_path = _v3_database(tmp_path / "audit-apply.db")
    _run(["backfill-source-metadata", "--db", str(db_path), "--apply"])

    code, payload, _ = _run(["audit-source-links", "--db", str(db_path), "--apply"])

    assert code == 0
    assert payload["mode"] == "apply"
    assert payload["checked"] == 8
    assert payload["sources_still_unchecked"] == 0
    conn = sqlite3.connect(db_path)
    stored = conn.execute("SELECT COUNT(*) FROM source_link_checks").fetchone()[0]
    conn.close()
    assert stored == 8

    # Resume: the next run has nothing left to check.
    code, payload, _ = _run(["audit-source-links", "--db", str(db_path), "--apply"])

    assert code == 0
    assert payload["checked"] == 0
    assert payload["sources_still_unchecked"] == 0
    assert [call["dry_run"] for call in fake_audit.calls] == [False, False]


def test_audit_source_links_passes_limit_and_flags(tmp_path, fake_audit):
    db_path = _v3_database(tmp_path / "audit-limit.db")
    _run(["backfill-source-metadata", "--db", str(db_path), "--apply"])

    code, payload, _ = _run(
        [
            "audit-source-links",
            "--db",
            str(db_path),
            "--limit",
            "2",
            "--delay",
            "0.25",
            "--timeout",
            "3.5",
            "--max-redirects",
            "1",
            "--stale-days",
            "7",
            "--apply",
        ]
    )

    assert code == 0
    assert payload["checked"] == 2
    assert payload["sources_still_unchecked"] == 6
    call = fake_audit.calls[-1]
    assert call["limit"] == 2
    assert call["delay_sec"] == 0.25
    assert call["timeout"] == 3.5
    assert call["max_redirects"] == 1
    assert call["stale_after_days"] == 7
