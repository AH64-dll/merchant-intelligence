"""Command-line entrypoint for the resumable merchant-intelligence pipeline."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

from merchant_intel.config import load_config
from merchant_intel.database import Database
from merchant_intel.export import export_dataset
from merchant_intel.logging_setup import configure_logging
from merchant_intel.omp.client import OmpClient
from merchant_intel.omp.mock import MockOmpClient
from merchant_intel.omp.models import assert_provider_pins
from merchant_intel.pipeline import Pipeline


def _db(cfg) -> Database:
    return Database(cfg.resolve(cfg.database_path))


def _add_config(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", default=argparse.SUPPRESS)


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
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
