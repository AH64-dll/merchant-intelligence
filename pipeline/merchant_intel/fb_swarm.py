"""Facebook community-feedback verification swarm.

Orchestrates Gemini (broad pass) and Luna (cross-check pass) agents over
"FB community feedback:" verification tasks. Stands alone from pipeline.py's
controller loop. Evidence ingestion reuses ingest_luna unchanged; round_no
>= 1000 marks community evidence so consumers can filter it apart from
pipeline rounds (which stay < 1000).

READ-ONLY policy: agents receive pre-fetched search/post content in their
task payloads; they never touch facebook.com. Only this runner fetches,
through fbsession.fb_get, paced by pace_between_fetches.
"""

from __future__ import annotations

import asyncio
import json
import re

from merchant_intel.omp.client import OmpClient, AgentRequest
from merchant_intel.config import load_config
from merchant_intel.database import Database
from merchant_intel.schemas import LunaAgentOutput, ReliabilityBand
from merchant_intel.ingest import ingest_luna, mark_tasks_assigned, release_tasks
from merchant_intel.pipeline import GOAL, _parse
from merchant_intel.prompts import render
from merchant_intel.fbsession import (
    fetch_post_text,
    pace_between_fetches,
    search_group_posts,
    verify_session,
)
from merchant_intel.fbgroups import TASK_TITLE_PREFIX

_HANDLE_RE = re.compile(r"facebook\.com/(?:profile\.php\?id=\d+|people/[^\"\s>]+)")


def scrub_author_handles(output: LunaAgentOutput) -> None:
    """Replace probable profile-handle substrings with [community member]."""
    for finding in output.findings:
        for evidence in finding.evidence:
            if _HANDLE_RE.search(evidence.summary):
                evidence.summary = _HANDLE_RE.sub("[community member]", evidence.summary)
            if _HANDLE_RE.search(evidence.raw_quote):
                evidence.raw_quote = _HANDLE_RE.sub("[community member]", evidence.raw_quote)
        if _HANDLE_RE.search(finding.summary):
            finding.summary = _HANDLE_RE.sub("[community member]", finding.summary)
        if _HANDLE_RE.search(finding.notes):
            finding.notes = _HANDLE_RE.sub("[community member]", finding.notes)


def _fetch_task_payload(
    task_row, groups: list[tuple[str, str]], *, posts_per_query: int = 6
) -> list[dict]:
    """Pre-fetch group-search results for one task. READ-ONLY; returns the
    fbsearch JSON block rendered into the prompt.

    The task title names the group ("... in <group name>"); fetch THAT group
    first (identity match), then pad with the top review groups so each
    payload carries the group the task was created for."""
    title = task_row["title"]
    name = title[len(TASK_TITLE_PREFIX) :].rsplit(" in ", 1)[0].strip()
    task_group = title.rsplit(" in ", 1)[-1].strip()
    ordered: list[tuple[str, str]] = []
    for url, gname in groups:
        if gname == task_group or url.rstrip("/").split("/")[-1] == task_group:
            ordered.append((url, gname))
            break
    for url, gname in groups:
        if (url, gname) not in ordered:
            ordered.append((url, gname))
    block: list[dict] = []
    for group_url, group_name in ordered[:3]:
        try:
            posts = search_group_posts(group_url, name, max_posts=posts_per_query)
        except Exception:  # noqa: BLE001 — a fetch failure must not kill the swarm
            posts = []
        enriched = []
        for post in posts:
            try:
                text = fetch_post_text(post["permalink"])
            except Exception:  # noqa: BLE001
                text = ""
            enriched.append({**post, "text": text})
            pace_between_fetches(1.5, 3.5)
        block.append(
            {"group_url": group_url, "group_name": group_name, "query": name, "posts": enriched}
        )
    return block


def _group_list(db: Database) -> list[tuple[str, str]]:
    """Review groups first (where buyer feedback demonstrably lives), then
    the seed hardware group, then the rest — deterministic order."""
    rows = db.query("SELECT url, name FROM fb_group_registry")
    priority = [
        "Dont.shop.here", "Askbeforeyoubuyinegypt", "cosumersexperience",
        "Dont.shop.here.new", "discoveregyptreviews", "gcmcomputer", "mallbostan",
        "yestahil", "EgyptPhonesCom", "Gaming.Trades", "trustedsellersmakeuptalk",
        "lpp000", "hardware.market.eg",
    ]
    def rank(row) -> tuple[int, int]:
        slug = row["url"].rstrip("/").split("/")[-1]
        return (0, priority.index(slug)) if slug in priority else (1, 0)
    ordered = sorted(rows, key=rank)
    return [(r["url"], r["name"]) for r in ordered]


def _clip_fbsearch(block: list[dict], *, max_bytes: int) -> list[dict]:
    """Trim post text fields until the JSON fits the byte budget."""
    import json as _json

    def encoded(obj: object) -> str:
        return _json.dumps(obj, ensure_ascii=False)

    while len(encoded(block).encode("utf-8")) > max_bytes:
        trimmed = False
        for group in block:
            for post in group.get("posts", []):
                text = post.get("text", "")
                if len(text) > 200:
                    post["text"] = text[:200] + "…"
                    trimmed = True
        if not trimmed:
            # Everything is short; drop posts from the tail until it fits.
            for group in block:
                if len(group.get("posts", [])) > 2:
                    group["posts"] = group["posts"][:2]
                    trimmed = True
                    break
        if not trimmed:
            break
    return block

async def _run_one(
    client: OmpClient,
    db: Database,
    *,
    agent_id: str,
    role: str,
    model: str,
    tasks: list,
    groups: list[tuple[str, str]],
    round_no: int,
    timeout_sec: int,
    prior_findings_json: str = "",
) -> dict | None:
    async with asyncio.Semaphore(5):
        task_ids = [str(row["id"]) for row in tasks]
        mark_tasks_assigned(db, task_ids, agent_id, round_no)
        task_payload = []
        for row in tasks:
            fetched = await asyncio.to_thread(_fetch_task_payload, row, groups)
            fetched = _clip_fbsearch(fetched, max_bytes=10000)
            task_payload.append(
                {
                    "task_id": row["id"],
                    "merchant_id": row["merchant_id"],
                    "title": row["title"],
                    "instruction": row["instruction"][:400],
                    "fbsearch": fetched,
                }
            )
        prompt = render(
            "fb_community.md",
            goal=GOAL,
            agent_id=agent_id,
            tasks=json.dumps(task_payload, ensure_ascii=False),
        )
        if prior_findings_json:
            prompt += (
                "\n\nGEMINI CROSS-CHECK INPUT (community findings already recorded for "
                "these merchants; verify rather than repeat; truncated):\n"
                + prior_findings_json[:40000]
            )
        print(
            f"[fbswarm] launching {agent_id} ({model}) with {len(tasks)} tasks, "
            f"prompt {len(prompt)} bytes",
            flush=True,
        )
        try:
            result = await client.run(
                AgentRequest(
                    prompt=prompt,
                    model=model,
                    name=agent_id,
                    role=role,
                    goal=GOAL,
                    workspace_id=f"fbswarm-{agent_id}",
                    timeout_sec=timeout_sec,
                )
            )
        except Exception as exc:  # noqa: BLE001
            release_tasks(db, task_ids, f"launch failed: {exc}")
            print(f"[fbswarm] {agent_id} LAUNCH FAILED: {exc}", flush=True)
            return None
        if not result.ok:
            release_tasks(db, task_ids, result.error or "fb agent failed")
            print(f"[fbswarm] {agent_id} FAILED: {result.error}", flush=True)
            return None
        try:
            parsed = _parse(LunaAgentOutput, result.payload, wrap_list_as="findings")
            parsed.agent_id = agent_id
        except ValueError as exc:
            release_tasks(db, task_ids, f"parse failed: {exc}")
            print(f"[fbswarm] {agent_id} PARSE FAILED: {exc}", flush=True)
            return None
        returned_ids = {finding.task_id for finding in parsed.findings}
        release_tasks(db, [tid for tid in task_ids if tid not in returned_ids], "fb agent omitted this task")
        scrub_author_handles(parsed)
        # Community anecdotes cap at medium reliability regardless of agent
        # enthusiasm (plan evidence rule); clamp before ingest.
        for finding in parsed.findings:
            for evidence in finding.evidence:
                if evidence.confidence > 0.8:
                    evidence.confidence = 0.8
                if evidence.reliability_band == ReliabilityBand.STRONG:
                    evidence.reliability_band = ReliabilityBand.MEDIUM
        added = ingest_luna(
            db,
            parsed,
            agent_run_id=f"fbswarm:{agent_id}",
            round_no=round_no,
        )
        print(f"[fbswarm] {agent_id} done: {len(parsed.findings)} findings, {added} new evidence", flush=True)
        return {"agent_id": agent_id, "findings": len(parsed.findings), "new_evidence": added}


def _gemini_findings_for(db: Database, task_rows: list) -> str:
    """Collect Gemini-wave finding JSON for the same merchants (Luna cross-check)."""
    merchant_ids = [str(row["merchant_id"]) for row in task_rows]
    placeholders = ",".join("?" for _ in merchant_ids)
    rows = db.query(
        f"""SELECT result_json FROM verification_tasks
            WHERE merchant_id IN ({placeholders})
            AND assigned_agent LIKE 'fbswarm-g-%' AND result_json != ''""",
        merchant_ids,
    )
    return "\n".join(r["result_json"] for r in rows[:10])


async def run_fb_swarm(
    config_path: str | None = None,
    *,
    luna_agents: int = 10,
    gemini_agents: int = 10,
    tasks_per_agent: int = 3,
    round_label: str = "fbswarm",
) -> int:
    """Launch the community-verification swarm. Exit 0 iff >=80% of launched
    agents returned parseable findings."""
    cfg = load_config(config_path)
    if not verify_session():
        print(
            "Facebook session dead. Re-extract: copy Zen cookies.sqlite to /tmp/.fbsess.sqlite "
            "then rerun. Exiting 3.",
            flush=True,
        )
        return 3
    client = OmpClient(cfg)
    db = Database(cfg.database_path)
    await client.probe()
    await client.resolve_models()
    gemini_model = client.model_for_role("analyst")
    luna_model = client.model_for_role("verifier")
    groups = _group_list(db)
    pending = db.query(
        f"""SELECT * FROM verification_tasks
            WHERE title LIKE '{TASK_TITLE_PREFIX}%'
            AND status IN ('pending','unresolved') AND attempts < 3
            ORDER BY id"""
    )
    if not pending:
        print("[fbswarm] no pending FB community tasks; run fb-gen-tasks first", flush=True)
        await client.close()
        return 0
    chunks = [pending[i : i + tasks_per_agent] for i in range(0, len(pending), tasks_per_agent)]
    gemini_chunks = chunks[:gemini_agents]
    luna_chunks = chunks[gemini_agents : gemini_agents + luna_agents]
    results: list[dict] = []
    if gemini_chunks:
        gem_results = await asyncio.gather(
            *[
                _run_one(
                    client,
                    db,
                    agent_id=f"{round_label}-g-{i:02d}",
                    role="analyst",
                    model=gemini_model,
                    tasks=chunk,
                    groups=groups,
                    round_no=1000,
                    timeout_sec=cfg.omp.analysis_timeout_sec,
                )
                for i, chunk in enumerate(gemini_chunks, start=1)
            ]
        )
        results.extend(r for r in gem_results if r)
    if luna_chunks:
        luna_results = await asyncio.gather(
            *[
                _run_one(
                    client,
                    db,
                    agent_id=f"{round_label}-l-{i:02d}",
                    role="verifier",
                    model=luna_model,
                    tasks=chunk,
                    groups=groups,
                    round_no=1001,
                    timeout_sec=cfg.omp.analysis_timeout_sec,
                    prior_findings_json=_gemini_findings_for(db, chunk),
                )
                for i, chunk in enumerate(luna_chunks, start=1)
            ]
        )
        results.extend(r for r in luna_results if r)
    launched = len(gemini_chunks) + len(luna_chunks)
    ok = len(results)
    print(f"[fbswarm] summary: {ok}/{launched} agents produced findings", flush=True)
    await client.close()
    return 0 if launched and ok / launched >= 0.8 else 1
