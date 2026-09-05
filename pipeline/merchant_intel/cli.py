"""Command-line entrypoint for the resumable merchant-intelligence pipeline."""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Mapping

from merchant_intel.config import load_config
from merchant_intel.database import Database
from merchant_intel.export import export_dataset
from merchant_intel.logging_setup import configure_logging
from merchant_intel.omp.client import OmpClient
from merchant_intel.omp.mock import MockOmpClient
from merchant_intel.omp.models import assert_provider_pins
from merchant_intel.pipeline import Pipeline
from merchant_intel.sources import ACCESS_KINDS, SourceLocator, classify_source_locator

# The live link audit lives in a sibling module. Import it here so the pinned
# contract is visible at module level, but keep the failure non-fatal: every
# other command (and `--help`) must keep working while that file is landing.
# `_load_source_audit()` retries once before the audit command gives up.
try:  # pragma: no cover - exercised through whichever slice lands first
    from merchant_intel import source_audit
except ImportError as exc:  # pragma: no cover
    source_audit = None
    _SOURCE_AUDIT_IMPORT_ERROR: ImportError | None = exc
else:  # pragma: no cover
    _SOURCE_AUDIT_IMPORT_ERROR = None

# Pinned defaults of the source-audit contract, used as argparse fallbacks when
# `merchant_intel.source_audit` is not importable yet.
CHECK_STATUSES: tuple[str, ...] = (
    "reachable",
    "redirected",
    "not_found",
    "access_limited",
    "server_error",
    "network_error",
    "not_checked",
)
STALE_AFTER_DAYS: int = 30
DEFAULT_DELAY_SEC: float = 1.5
DEFAULT_TIMEOUT_SEC: float = 12.0
DEFAULT_MAX_REDIRECTS: int = 3

# Source rows whose raw locator is not a browser-openable URL. They are the
# migration fixtures: the backfill report always prints their classification.
KNOWN_NON_BROWSER_SOURCE_IDS: tuple[int, ...] = (
    1081,
    1119,
    1123,
    1129,
    1130,
    1133,
    1174,
    1180,
    1203,
    1442,
    1456,
    1457,
    1466,
    1559,
    1567,
    1962,
)


def _db(cfg) -> Database:
    return Database(cfg.resolve(cfg.database_path))


def _add_config(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", default=argparse.SUPPRESS)


def _resolve_db_path(cfg, override: str | None) -> Path:
    """Database path from ``--db`` when given, otherwise the configured one."""
    if override:
        return Path(override).expanduser()
    return cfg.resolve(cfg.database_path)


def _readonly_conn(path: str | Path) -> sqlite3.Connection:
    """Open ``path`` strictly read-only.

    ``Database.__init__`` runs every pending migration, so any inspection that
    must not mutate the file (dry-runs and pre-flight checks) goes through
    this instead.
    """
    conn = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _schema_version(conn: sqlite3.Connection) -> int:
    try:
        row = conn.execute("SELECT MAX(version) AS version FROM schema_version").fetchone()
    except sqlite3.OperationalError:
        return 0
    return int(row["version"] or 0) if row else 0


def _audit_default(name: str, pinned: Any) -> Any:
    """Prefer the audit module's constant, falling back to the pinned value."""
    module = source_audit or _load_source_audit()
    return getattr(module, name, pinned) if module is not None else pinned


def _load_source_audit():
    """Return ``merchant_intel.source_audit``, retrying the import once.

    The module is produced by a parallel slice; a missing file must not break
    unrelated commands, so the import is retried at the point of use and the
    caller reports a clear blocker when it is still absent.
    """
    global source_audit, _SOURCE_AUDIT_IMPORT_ERROR
    if source_audit is not None:
        return source_audit
    try:
        source_audit = importlib.import_module("merchant_intel.source_audit")
    except ImportError as exc:
        _SOURCE_AUDIT_IMPORT_ERROR = exc
        importlib.invalidate_caches()
        try:
            source_audit = importlib.import_module("merchant_intel.source_audit")
        except ImportError as exc2:
            _SOURCE_AUDIT_IMPORT_ERROR = exc2
            return None
    _SOURCE_AUDIT_IMPORT_ERROR = None
    return source_audit


async def _run(args: argparse.Namespace) -> int:
    smoke = bool(getattr(args, "run_smoke", False) or getattr(args, "root_smoke", False))
    resume = bool(getattr(args, "run_resume", False) or getattr(args, "root_resume", False))
    mock = bool(getattr(args, "run_mock", False) or getattr(args, "root_mock", False))
    cfg = load_config(getattr(args, "config", None), smoke=smoke)
    configure_logging(cfg.resolve(cfg.log_dir), cfg.log_level)
    db = _db(cfg)
    client: Any
    if mock:
        client = MockOmpClient(
            {
                "discovery": cfg.models.discovery,
                "coordinator": cfg.models.coordinator,
                "analyst": cfg.models.analyst,
                "verifier": cfg.models.verifier,
            },
            gemini_provider=cfg.models.gemini_provider,
            gpt_provider=cfg.models.gpt_provider,
            allow_fallback=cfg.models.allow_fallback,
        )
    else:
        client = OmpClient(cfg)
    pipe = Pipeline(cfg, client, db)
    try:
        if resume:
            pipe.resume(getattr(args, "run_id", None) or getattr(args, "root_run_id", None))
        await pipe.run()
        metrics = db.latest_metrics(pipe.state.run_id) or {}
        print(
            "FINAL:",
            json.dumps(
                {
                    "run_id": pipe.state.run_id,
                    "stage": pipe.state.stage,
                    "stop_reason": pipe.state.stop_reason,
                    "metrics": metrics,
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
        )
        return 0 if pipe.state.stage == "complete" else 2
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        import traceback
        traceback.print_exc()
        sys.stderr.flush()
        print(f"merchant-intel: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        close = getattr(client, "close", None)
        if close is not None:
            await close()
        db.close()


def cmd_status(args: argparse.Namespace) -> int:
    cfg = load_config(getattr(args, "config", None))
    db = _db(cfg)
    try:
        run_id = getattr(args, "run_id", None) or db.latest_run_id()
        if not run_id:
            print("no runs")
            return 0
        row = db.query_one("SELECT * FROM pipeline_runs WHERE id=?", (run_id,))
        checkpoint = db.load_checkpoint(run_id)
        counts = db.query(
            "SELECT status, COUNT(*) AS n FROM agent_runs WHERE run_id=? GROUP BY status",
            (run_id,),
        )
        print(
            json.dumps(
                {
                    "run": dict(row) if row else None,
                    "checkpoint": checkpoint,
                    "agent_counts": {item["status"]: item["n"] for item in counts},
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            )
        )
        return 0
    finally:
        db.close()


def cmd_metrics(args: argparse.Namespace) -> int:
    cfg = load_config(getattr(args, "config", None))
    db = _db(cfg)
    try:
        run_id = getattr(args, "run_id", None) or db.latest_run_id()
        if not run_id:
            print("no runs")
            return 0
        rows = db.query(
            "SELECT stage, round_no, payload_json, created_at FROM quality_metrics WHERE run_id=? ORDER BY id",
            (run_id,),
        )
        for row in rows:
            print(
                json.dumps(
                    {
                        "created_at": row["created_at"],
                        "stage": row["stage"],
                        "round": row["round_no"],
                        "metrics": json.loads(row["payload_json"]),
                    },
                    ensure_ascii=False,
                    default=str,
                )
            )
        return 0
    finally:
        db.close()


def cmd_export(args: argparse.Namespace) -> int:
    cfg = load_config(getattr(args, "config", None))
    db = _db(cfg)
    try:
        path = export_dataset(
            db,
            cfg.resolve(cfg.export_dir),
            args.format,
            sanitized=not bool(getattr(args, "include_raw", False)),
        )
        print(path)
        return 0
    finally:
        db.close()


def cmd_fb_seed_groups(args: argparse.Namespace) -> int:
    from merchant_intel.fbgroups import ensure_group_registry, resolve_group_list

    cfg = load_config(getattr(args, "config", None))
    db = _db(cfg)
    try:
        groups = resolve_group_list(cfg.research.fb_groups)
        if not groups:
            print("no groups configured: add research.fb_groups in config.yaml")
            return 1
        inserted = ensure_group_registry(db, groups)
        total = int(db.query_one("SELECT COUNT(*) AS n FROM fb_group_registry")["n"])
        print(f"groups resolved: {len(groups)}; newly registered: {inserted}; registry total: {total}")
        for row in db.query("SELECT url, name FROM fb_group_registry"):
            print(f"  - {row['url']} ({row['name']})")
        return 0
    finally:
        pass


def cmd_fb_gen_tasks(args: argparse.Namespace) -> int:
    from merchant_intel.fbgroups import build_fb_tasks

    cfg = load_config(getattr(args, "config", None))
    db = _db(cfg)
    inserted = build_fb_tasks(db, args.run_id, cfg_groups=cfg.research.fb_groups)
    total = int(
        db.query_one(
            "SELECT COUNT(*) AS n FROM verification_tasks WHERE title LIKE 'FB community feedback:%'"
        )["n"]
    )
    print(f"fb tasks inserted: {inserted}; total fb tasks: {total}")
    return 0


async def cmd_fb_swarm(args: argparse.Namespace) -> int:
    from merchant_intel.fb_swarm import run_fb_swarm

    return await run_fb_swarm(
        getattr(args, "config", None),
        luna_agents=args.luna_agents,
        gemini_agents=args.gemini_agents,
        tasks_per_agent=args.tasks_per_agent,
    )




async def cmd_verify(args: argparse.Namespace) -> int:
    cfg = load_config(getattr(args, "config", None))
    client = OmpClient(cfg)
    try:
        caps = await client.probe()
        print(f"omp binary: {caps.binary}")
        print(f"omp version: {caps.version}")
        print(f"json mode: {caps.supports_json_mode}; resume: {caps.supports_resume}; session-dir: {caps.supports_session_dir}")
        catalog = await client.list_models()
        print(f"catalog models: {len(catalog)}")
        models = await client.resolve_models()
        assert_provider_pins(
            models,
            gemini_provider=cfg.models.gemini_provider,
            gpt_provider=cfg.models.gpt_provider,
        )
        for role, model in models.items():
            print(f"{role}: {model}")
        print("provider pins ok: Gemini=Antigravity, GPT=Codex")
        return 0
    finally:
        await client.close()


def cmd_merge_sellers(args: argparse.Namespace) -> int:
    from merchant_intel.merchant_merge import merge_sellers

    cfg = load_config(getattr(args, "config", None))
    db = _db(cfg)
    try:
        report = merge_sellers(
            db,
            apply=bool(args.apply),
            report_path=args.report,
        )
        print(
            json.dumps(
                {
                    "mode": report["mode"],
                    "report_path": report["report_path"],
                    "before_counts": report["before_counts"],
                    "after_counts": report.get("after_counts"),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    finally:
        db.close()


async def cmd_reanalyze_merchants(args: argparse.Namespace) -> int:
    from merchant_intel.reanalysis import reanalyze_merchants

    cfg = load_config(getattr(args, "config", None))
    configure_logging(cfg.resolve(cfg.log_dir), cfg.log_level)
    db = _db(cfg)
    client = OmpClient(cfg)
    try:
        result = await reanalyze_merchants(cfg, client, db, args.merchant_ids)
        print(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
        return 0
    finally:
        await client.close()
        db.close()


def _classify_sources(conn: sqlite3.Connection) -> dict[int, SourceLocator]:
    """Classify every source row from ``sources.url`` alone."""
    return {
        int(row["id"]): classify_source_locator(row["url"])
        for row in conn.execute("SELECT id, url FROM sources ORDER BY id")
    }


def _count_by_kind(classified: Mapping[int, SourceLocator]) -> dict[str, int]:
    counts = {kind: 0 for kind in ACCESS_KINDS}
    for locator in classified.values():
        counts[locator.access_kind] = counts.get(locator.access_kind, 0) + 1
    return counts


def _non_browser_report(classified: Mapping[int, SourceLocator]) -> list[dict[str, Any]]:
    """Classification of the known non-browser-safe locators (migration fixtures)."""
    entries: list[dict[str, Any]] = []
    for source_id in KNOWN_NON_BROWSER_SOURCE_IDS:
        locator = classified.get(source_id)
        if locator is None:
            entries.append({"source_id": source_id, "present": False})
            continue
        entries.append(
            {
                "source_id": source_id,
                "access_kind": locator.access_kind,
                "web_url": locator.web_url,
                "locator_note": locator.locator_note,
            }
        )
    return entries


def _stored_mismatches(
    conn: sqlite3.Connection, classified: Mapping[int, SourceLocator]
) -> list[dict[str, Any]]:
    """Rows whose stored v4 columns disagree with the computed classification."""
    mismatches: list[dict[str, Any]] = []
    for row in conn.execute("SELECT id, web_url, access_kind FROM sources ORDER BY id"):
        locator = classified.get(int(row["id"]))
        if locator is None:
            continue
        stored_url = row["web_url"] or None
        stored_kind = row["access_kind"] or "web"
        if stored_url != locator.web_url or stored_kind != locator.access_kind:
            mismatches.append(
                {
                    "source_id": int(row["id"]),
                    "stored_web_url": stored_url,
                    "computed_web_url": locator.web_url,
                    "stored_access_kind": stored_kind,
                    "computed_access_kind": locator.access_kind,
                }
            )
    return mismatches


def cmd_backfill_source_metadata(args: argparse.Namespace) -> int:
    """Classify and backfill the v4 source locator metadata.

    Dry-run is the default and never opens the file for writing: the
    ``Database`` constructor applies pending migrations, so inspection and the
    pre-flight read use a read-only connection, and an already-migrated v4
    database short-circuits before any write path is touched. Apply runs the
    schema-v4 migration through the normal ``Database`` path and then writes
    ``web_url``/``locator_note``/``access_kind`` in one transaction, aborting
    and rolling back if ``url`` or ``canonical_url`` changed by so much as a
    byte. ``source_label`` is never written.
    """
    cfg = load_config(getattr(args, "config", None))
    db_path = _resolve_db_path(cfg, getattr(args, "db", None))
    apply_changes = bool(getattr(args, "apply", False))

    conn = _readonly_conn(db_path)
    try:
        version = _schema_version(conn)
        classified = _classify_sources(conn)
        report: dict[str, Any] = {
            "database": str(db_path),
            "schema_version": version,
            "sources_total": len(classified),
            "by_access_kind": _count_by_kind(classified),
            "with_web_url": sum(1 for item in classified.values() if item.web_url),
            "with_locator_note": sum(
                1 for item in classified.values() if item.locator_note
            ),
            "non_browser_locators": _non_browser_report(classified),
        }
        if version >= 4:
            mismatches = _stored_mismatches(conn, classified)
            report["mode"] = "skipped"
            report["message"] = (
                f"schema v{version} already carries the source locator metadata;"
                " no backfill needed"
            )
            report["stored_mismatch_count"] = len(mismatches)
            report["stored_mismatches"] = mismatches[:20]
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0
        report["mode"] = "apply" if apply_changes else "dry-run"
        if not apply_changes:
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0
        raw_before = [
            (int(row["id"]), row["url"], row["canonical_url"])
            for row in conn.execute(
                "SELECT id, url, canonical_url FROM sources ORDER BY id"
            )
        ]
    finally:
        conn.close()

    updates = [
        (locator.web_url, locator.locator_note, locator.access_kind, source_id)
        for source_id, locator in sorted(classified.items())
    ]
    db = Database(db_path)
    try:
        with db.transaction() as tconn:
            if updates:
                tconn.executemany(
                    "UPDATE sources SET web_url=?, locator_note=?, access_kind=?"
                    " WHERE id=?",
                    updates,
                )
            raw_after = [
                (int(row["id"]), row["url"], row["canonical_url"])
                for row in tconn.execute(
                    "SELECT id, url, canonical_url FROM sources ORDER BY id"
                )
            ]
            if raw_after != raw_before:
                raise RuntimeError(
                    "source locator backfill altered sources.url or"
                    " sources.canonical_url; transaction rolled back"
                )
        report["schema_version"] = int(
            db.query("SELECT MAX(version) AS version FROM schema_version")[0]["version"]
            or 0
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(f"merchant-intel: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


def cmd_audit_source_links(args: argparse.Namespace) -> int:
    """Run the resumable, read-only source link audit.

    Dry-run is the default. The command refuses to run before the v4 backfill
    has populated ``sources.web_url``, because there is nothing browser-safe
    to check and an un-migrated file must not be opened for writing here.
    """
    cfg = load_config(getattr(args, "config", None))
    db_path = _resolve_db_path(cfg, getattr(args, "db", None))

    conn = _readonly_conn(db_path)
    try:
        version = _schema_version(conn)
        if version < 4:
            print(
                f"merchant-intel: database is schema v{version}; run"
                " `backfill-source-metadata --apply` before auditing source links",
                file=sys.stderr,
            )
            return 2
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM sources"
            " WHERE web_url IS NOT NULL AND TRIM(web_url) <> ''"
        ).fetchone()
    finally:
        conn.close()
    if not int(row["n"] or 0):
        print(
            "merchant-intel: no sources carry a browser-openable web_url; run"
            " `backfill-source-metadata --apply` before auditing source links",
            file=sys.stderr,
        )
        return 2

    module = source_audit or _load_source_audit()
    if module is None:
        print(
            "merchant-intel: merchant_intel.source_audit is unavailable"
            f" ({_SOURCE_AUDIT_IMPORT_ERROR}); cannot audit source links",
            file=sys.stderr,
        )
        return 2

    db = Database(db_path)
    try:
        result = module.run_audit(
            db,
            limit=args.limit,
            delay_sec=args.delay,
            timeout=args.timeout,
            max_redirects=args.max_redirects,
            stale_after_days=args.stale_days,
            dry_run=not bool(getattr(args, "apply", False)),
        )
        statuses = tuple(getattr(module, "CHECK_STATUSES", CHECK_STATUSES))
        remaining = module.select_sources_to_check(
            db, stale_after_days=args.stale_days
        )
        by_status = dict(result.get("by_status") or {})
        ordered = {name: int(by_status.pop(name, 0)) for name in statuses}
        ordered.update({name: int(count) for name, count in sorted(by_status.items())})
        print(
            json.dumps(
                {
                    "database": str(db_path),
                    "mode": "apply" if getattr(args, "apply", False) else "dry-run",
                    "checked": int(result.get("checked", 0)),
                    "elapsed_sec": round(float(result.get("elapsed_sec", 0.0)), 3),
                    "by_status": ordered,
                    "errors": int(result.get("errors", 0)),
                    "sources_still_unchecked": len(remaining),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    finally:
        db.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="merchant-intel")
    parser.add_argument("--config", default=None)
    # Top-level aliases make `python main.py --resume` and the equivalent
    # root-level mock/smoke commands work without pretending they are commands.
    parser.add_argument("--resume", dest="root_resume", action="store_true")
    parser.add_argument("--run-id", dest="root_run_id")
    parser.add_argument("--mock", dest="root_mock", action="store_true")
    parser.add_argument("--smoke-test", "--smoke", dest="root_smoke", action="store_true")
    sub = parser.add_subparsers(dest="cmd")

    run = sub.add_parser("run")
    _add_config(run)
    run.add_argument("--resume", dest="run_resume", action="store_true")
    run.add_argument("--run-id")
    run.add_argument("--mock", dest="run_mock", action="store_true")
    run.add_argument("--smoke-test", "--smoke", dest="run_smoke", action="store_true")

    status = sub.add_parser("status")
    _add_config(status)
    status.add_argument("--run-id")
    metrics = sub.add_parser("metrics")
    _add_config(metrics)
    metrics.add_argument("--run-id")
    export = sub.add_parser("export")
    export.add_argument("--format", choices=["json", "jsonl", "csv"], default="json")
    export.add_argument("--include-raw", action="store_true")
    verify = sub.add_parser("verify")
    merge = sub.add_parser("merge-sellers")
    _add_config(merge)
    merge.add_argument("--apply", action="store_true")
    merge.add_argument("--report")
    reanalyze = sub.add_parser("reanalyze-merchants")
    _add_config(reanalyze)
    reanalyze.add_argument("merchant_ids", nargs="+", metavar="UUID")


    fb_seed = sub.add_parser("fb-seed-groups")
    _add_config(fb_seed)
    fb_gen = sub.add_parser("fb-gen-tasks")
    _add_config(fb_gen)
    fb_gen.add_argument("--run-id", required=True)
    fb_swarm = sub.add_parser("fb-swarm")
    _add_config(fb_swarm)
    fb_swarm.add_argument("--luna-agents", type=int, default=10)
    fb_swarm.add_argument("--gemini-agents", type=int, default=10)
    fb_swarm.add_argument("--tasks-per-agent", type=int, default=3)

    backfill = sub.add_parser(
        "backfill-source-metadata",
        help="classify and backfill v4 source locator metadata (dry-run by default)",
    )
    _add_config(backfill)
    backfill.add_argument("--apply", action="store_true")
    backfill.add_argument("--db", metavar="PATH")

    audit = sub.add_parser(
        "audit-source-links",
        help="resumable read-only reachability check of sources.web_url (dry-run by default)",
    )
    _add_config(audit)
    audit.add_argument("--limit", type=int, default=None, metavar="N")
    audit.add_argument(
        "--delay", type=float, default=_audit_default("DEFAULT_DELAY_SEC", DEFAULT_DELAY_SEC)
    )
    audit.add_argument(
        "--timeout",
        type=float,
        default=_audit_default("DEFAULT_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC),
    )
    audit.add_argument(
        "--max-redirects",
        type=int,
        default=_audit_default("DEFAULT_MAX_REDIRECTS", DEFAULT_MAX_REDIRECTS),
    )
    audit.add_argument(
        "--stale-days", type=int, default=_audit_default("STALE_AFTER_DAYS", STALE_AFTER_DAYS)
    )
    audit.add_argument("--apply", action="store_true")
    audit.add_argument("--db", metavar="PATH")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    # Root-level flags (`python main.py --resume`) act as `run` aliases.
    if getattr(args, "cmd", None) is None:
        args.cmd = "run"
    if args.cmd == "run":
        return asyncio.run(_run(args))
    if args.cmd == "status":
        return cmd_status(args)
    if args.cmd == "metrics":
        return cmd_metrics(args)
    if args.cmd == "export":
        return cmd_export(args)
    if args.cmd == "verify":
        return asyncio.run(cmd_verify(args))
    if args.cmd == "merge-sellers":
        return cmd_merge_sellers(args)
    if args.cmd == "reanalyze-merchants":
        return asyncio.run(cmd_reanalyze_merchants(args))
    if args.cmd == "fb-seed-groups":
        return cmd_fb_seed_groups(args)
    if args.cmd == "fb-gen-tasks":
        return cmd_fb_gen_tasks(args)
    if args.cmd == "fb-swarm":
        return asyncio.run(cmd_fb_swarm(args))
    if args.cmd == "backfill-source-metadata":
        return cmd_backfill_source_metadata(args)
    if args.cmd == "audit-source-links":
        return cmd_audit_source_links(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
