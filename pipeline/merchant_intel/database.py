"""SQLite persistence with WAL, provenance, migrations, and checkpoints."""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

from merchant_intel.schemas import utcnow

SCHEMA = """
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 10000;

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    discovery_round INTEGER NOT NULL DEFAULT 0,
    verification_round INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS checkpoints (
    run_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    round_no INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    model TEXT NOT NULL,
    assignment_json TEXT NOT NULL,
    omp_session_id TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    error TEXT,
    raw_path TEXT,
    parsed_ok INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_run ON agent_runs(run_id, stage, round_no);

CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    governorate TEXT NOT NULL DEFAULT '',
    identity_confidence REAL NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    first_seen_round INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_merchants_name_city ON merchants(normalized_name, city);

CREATE TABLE IF NOT EXISTS merchant_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    UNIQUE(merchant_id, normalized_alias),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE TABLE IF NOT EXISTS merchant_identifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    UNIQUE(kind, normalized_value),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE INDEX IF NOT EXISTS idx_identifier_lookup ON merchant_identifiers(kind, normalized_value);

CREATE TABLE IF NOT EXISTS merchant_links (
    id TEXT PRIMARY KEY,
    left_merchant_id TEXT NOT NULL,
    right_merchant_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    confidence REAL NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(left_merchant_id, right_merchant_id, relation),
    FOREIGN KEY (left_merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (right_merchant_id) REFERENCES merchants(id)
);

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    canonical_url TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL,
    source_type TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    sentiment TEXT NOT NULL,
    summary TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    fingerprint TEXT NOT NULL UNIQUE,
    independent_source_count INTEGER NOT NULL DEFAULT 0,
    mention_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE INDEX IF NOT EXISTS idx_claims_merchant ON claims(merchant_id);

CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    claim_id TEXT,
    claim_type TEXT NOT NULL,
    sentiment TEXT NOT NULL,
    summary TEXT NOT NULL,
    quoted_excerpt TEXT NOT NULL DEFAULT '',
    author_type TEXT NOT NULL DEFAULT 'unknown',
    transaction_evidence INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL,
    reliability_band TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT '',
    published_at TEXT,
    captured_at TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    content_fingerprint TEXT NOT NULL,
    independent INTEGER NOT NULL DEFAULT 1,
    duplicate_of TEXT,
    agent_run_id TEXT,
    round_no INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (source_id) REFERENCES sources(id),
    FOREIGN KEY (claim_id) REFERENCES claims(id),
    FOREIGN KEY (duplicate_of) REFERENCES evidence(id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_merchant ON evidence(merchant_id);

CREATE TABLE IF NOT EXISTS claim_evidence (
    claim_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    PRIMARY KEY(claim_id, evidence_id),
    FOREIGN KEY (claim_id) REFERENCES claims(id),
    FOREIGN KEY (evidence_id) REFERENCES evidence(id)
);

CREATE TABLE IF NOT EXISTS verification_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    title TEXT NOT NULL,
    instruction TEXT NOT NULL,
    excluded_sources_json TEXT NOT NULL DEFAULT '[]',
    claim_ids_json TEXT NOT NULL DEFAULT '[]',
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'pending',
    assigned_agent TEXT,
    result_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_round INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE TABLE IF NOT EXISTS research_gaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    round_no INTEGER NOT NULL,
    gap_type TEXT NOT NULL,
    description TEXT NOT NULL,
    searches_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id)
);

CREATE TABLE IF NOT EXISTS merchant_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    round_no INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE INDEX IF NOT EXISTS idx_analyses_run_merchant ON merchant_analyses(run_id, merchant_id);

CREATE TABLE IF NOT EXISTS quality_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    round_no INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id)
);
"""

SCHEMA_VERSION = 2


class Database:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            self.path, check_same_thread=False, isolation_level=None
        )
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA busy_timeout = 10000")
        self.init_schema()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(SCHEMA)
            row = self._conn.execute(
                "SELECT MAX(version) AS version FROM schema_version"
            ).fetchone()
            current = int(row["version"] or 0) if row else 0
            if current == 0:
                self._conn.execute("INSERT INTO schema_version(version) VALUES (?)", (1,))
                current = 1
            if current < 2:
                self._ensure_column("sources", "last_seen_at", "TEXT")
                self._ensure_column(
                    "evidence", "content_fingerprint", "TEXT NOT NULL DEFAULT ''"
                )
                self._ensure_column("evidence", "claim_id", "TEXT")
                for name, definition in (
                    ("attempts", "INTEGER NOT NULL DEFAULT 0"),
                    ("last_attempt_round", "INTEGER NOT NULL DEFAULT 0"),
                    ("last_error", "TEXT NOT NULL DEFAULT ''"),
                    ("created_at", "TEXT NOT NULL DEFAULT ''"),
                    ("updated_at", "TEXT NOT NULL DEFAULT ''"),
                ):
                    self._ensure_column("verification_tasks", name, definition)
                now = utcnow().isoformat()
                self._conn.execute(
                    "UPDATE sources SET last_seen_at=COALESCE(last_seen_at, first_seen_at)"
                )
                self._conn.execute(
                    "UPDATE evidence SET content_fingerprint="
                    "COALESCE(content_fingerprint, fingerprint)"
                )
                self._conn.execute(
                    "UPDATE verification_tasks SET "
                    "created_at=COALESCE(NULLIF(created_at,''), ?), "
                    "updated_at=COALESCE(NULLIF(updated_at,''), ?)",
                    (now, now),
                )
                self._conn.execute("DELETE FROM schema_version")
                self._conn.execute(
                    "INSERT INTO schema_version(version) VALUES (?)", (SCHEMA_VERSION,)
                )
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_evidence_content_fingerprint "
                "ON evidence(content_fingerprint)"
            )
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_tasks_run_status "
                "ON verification_tasks(run_id, status, attempts)"
            )
    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        columns = {
            row["name"] for row in self._conn.execute(f"PRAGMA table_info({table})")
        }
        if column not in columns:
            self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                yield self._conn
            except Exception:
                self._conn.rollback()
                raise
            else:
                self._conn.commit()

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, tuple(params))

    def executemany(self, sql: str, rows: Iterable[Iterable[Any]]) -> None:
        with self._lock:
            self._conn.executemany(sql, [tuple(row) for row in rows])

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute(sql, tuple(params)))

    def query_one(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchone()

    def dumps(self, obj: Any) -> str:
        return json.dumps(obj, ensure_ascii=False, default=str, sort_keys=True)

    def upsert_run(
        self,
        run_id: str,
        status: str,
        stage: str,
        discovery_round: int,
        verification_round: int,
        config: dict[str, Any],
        notes: str = "",
    ) -> None:
        now = utcnow().isoformat()
        existing = self.query_one("SELECT id FROM pipeline_runs WHERE id = ?", (run_id,))
        if existing is None:
            self.execute(
                """INSERT INTO pipeline_runs
                   (id, started_at, updated_at, status, stage, discovery_round,
                    verification_round, config_json, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    now,
                    now,
                    status,
                    stage,
                    discovery_round,
                    verification_round,
                    self.dumps(config),
                    notes,
                ),
            )
        else:
            self.execute(
                """UPDATE pipeline_runs
                   SET updated_at=?, status=?, stage=?, discovery_round=?,
                       verification_round=?, config_json=?, notes=?
                   WHERE id=?""",
                (
                    now,
                    status,
                    stage,
                    discovery_round,
                    verification_round,
                    self.dumps(config),
                    notes,
                    run_id,
                ),
            )

    def save_checkpoint(self, run_id: str, payload: dict[str, Any]) -> None:
        self.execute(
            """INSERT INTO checkpoints(run_id, payload_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(run_id) DO UPDATE SET payload_json=excluded.payload_json,
                                                 updated_at=excluded.updated_at""",
            (run_id, self.dumps(payload), utcnow().isoformat()),
        )

    def load_checkpoint(self, run_id: str) -> dict[str, Any] | None:
        row = self.query_one("SELECT payload_json FROM checkpoints WHERE run_id = ?", (run_id,))
        return None if row is None else json.loads(row["payload_json"])

    def latest_run_id(self) -> str | None:
        row = self.query_one("SELECT id FROM pipeline_runs ORDER BY updated_at DESC LIMIT 1")
        return None if row is None else row["id"]

    def latest_resumable_run_id(self) -> str | None:
        row = self.query_one(
            """SELECT id FROM pipeline_runs
               WHERE status IN ('running', 'incomplete')
               ORDER BY updated_at DESC LIMIT 1"""
        )
        return None if row is None else row["id"]

    def save_metrics(self, run_id: str, stage: str, round_no: int, payload: dict[str, Any]) -> None:
        self.execute(
            """INSERT INTO quality_metrics(run_id, stage, round_no, payload_json, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (run_id, stage, round_no, self.dumps(payload), utcnow().isoformat()),
        )

    def latest_metrics(self, run_id: str) -> dict[str, Any] | None:
        row = self.query_one(
            """SELECT payload_json FROM quality_metrics
               WHERE run_id=? ORDER BY id DESC LIMIT 1""",
            (run_id,),
        )
        return None if row is None else json.loads(row["payload_json"])

