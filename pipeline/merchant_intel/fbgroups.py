"""Facebook group corpus: registry seeding and community-feedback task generation.

Groups come from config.yaml research.fb_groups (user's own memberships) unioned with
SEED_GROUPS already present in the dataset. Task generation caps at MAX_FB_TASKS to
keep the swarm bounded; merchants with pending/unresolved verification tasks get
priority when capping.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from merchant_intel.fbsession import fb_get
from merchant_intel.database import Database

SEED_GROUPS = ["https://www.facebook.com/groups/hardware.market.eg/"]
MAX_FB_TASKS = 600
TASK_TITLE_PREFIX = "FB community feedback:"


def normalize_group_url(url: str) -> str:
    slug_match = re.search(r"/groups/([A-Za-z0-9_.-]+)", url or "")
    return f"https://www.facebook.com/groups/{slug_match.group(1)}/" if slug_match else ""


def group_slug(url: str) -> str:
    slug_match = re.search(r"/groups/([A-Za-z0-9_.-]+)", url or "")
    return slug_match.group(1) if slug_match else ""


def resolve_group_list(cfg_groups: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for url in [*cfg_groups, *SEED_GROUPS]:
        normalized = normalize_group_url(url)
        if normalized and normalized not in seen:
            seen.add(normalized)
            ordered.append(normalized)
    return ordered[:30]


def fetch_group_identity(group_url: str) -> dict | None:
    """Return {url, name} when the group page renders server-side; None when
    blocked or deleted. Member counts are JS-rendered; not extracted."""
    status, html = fb_get(group_url, timeout=25)
    if status != 200:
        return None
    lowered = html.lower()
    if "you must log in" in lowered and "logout" not in lowered:
        return None
    slug = group_slug(group_url)
    name_match = re.search(r'"group_name":"((?:[^"\\]|\\.)*)"', html)
    name = ""
    if name_match:
        try:
            import json

            name = json.loads(f'"{name_match.group(1)}"')
        except Exception:
            name = name_match.group(1)
    return {"url": group_url, "name": name or slug}


def ensure_group_registry(db: Database, groups: list[str]) -> int:
    """Insert resolved group identities; returns inserted count."""
    inserted = 0
    now = datetime.now(timezone.utc).isoformat()
    for url in groups:
        identity = fetch_group_identity(url)
        if identity is None:
            continue
        cur = db.execute(
            """INSERT OR IGNORE INTO fb_group_registry(url, name, joined, checked_at)
               VALUES (?, ?, 1, ?)""",
            (identity["url"], identity["name"], now),
        )
        inserted += cur.rowcount
    return inserted


def _merchant_search_terms(db: Database) -> list[dict]:
    rows = db.query(
        """SELECT m.id, m.canonical_name FROM merchants m
           WHERE EXISTS (SELECT 1 FROM merchant_identifiers i
                         WHERE i.merchant_id = m.id AND i.kind = 'facebook')"""
    )
    merchants = []
    for row in rows:
        alias_rows = db.query(
            "SELECT alias FROM merchant_aliases WHERE merchant_id = ? LIMIT 3",
            (row["id"],),
        )
        aliases = [r["alias"] for r in alias_rows]
        terms = [row["canonical_name"], *aliases]
        fb_pages = [
            r["value"]
            for r in db.query(
                "SELECT value FROM merchant_identifiers WHERE merchant_id = ? AND kind = 'facebook'",
                (row["id"],),
            )
        ]
        merchants.append(
            {
                "merchant_id": row["id"],
                "canonical_name": row["canonical_name"],
                "aliases": aliases,
                "fb_pages": fb_pages,
                "search_terms": terms[:4],
            }
        )
    return merchants


def build_fb_tasks(db: Database, run_id: str, *, cfg_groups: list[str] | None = None) -> int:
    """Create one verification task per (merchant, accessible group), capped at
    MAX_FB_TASKS. Merchants that already have pending/unresolved tasks come
    first when capping. Returns inserted count. Idempotent: skips pairs whose
    title already exists for this run."""
    groups = resolve_group_list(cfg_groups or [])
    registered = db.query("SELECT url, name FROM fb_group_registry WHERE url IS NOT NULL")
    accessible = [(r["url"], r["name"] or group_slug(r["url"])) for r in registered]
    if not accessible:
        accessible = [(url, group_slug(url)) for url in groups]
    if not accessible:
        return 0
    merchants = _merchant_search_terms(db)
    priority_ids = {
        row["merchant_id"]
        for row in db.query(
            """SELECT DISTINCT merchant_id FROM verification_tasks
               WHERE status IN ('pending','unresolved')"""
        )
    }
    merchants.sort(key=lambda m: (m["merchant_id"] not in priority_ids, m["merchant_id"]))
    instruction = (
        "Search group posts mentioning the merchant name or aliases; classify buyer-experience "
        "feedback; community-only evidence; author identities prohibited"
    )
    inserted = 0
    for merchant in merchants:
        for url, name in accessible:
            if inserted >= MAX_FB_TASKS:
                return inserted
            title = f"{TASK_TITLE_PREFIX} {merchant['canonical_name']} in {name}"
            exists = db.query_one(
                "SELECT id FROM verification_tasks WHERE run_id = ? AND title = ?",
                (run_id, title),
            )
            if exists:
                continue
            now = datetime.now(timezone.utc).isoformat()
            db.execute(
                """INSERT INTO verification_tasks
                   (id, run_id, merchant_id, title, instruction, excluded_sources_json,
                    claim_ids_json, priority, status, attempts, last_attempt_round,
                    created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, '[]', '[]', 'medium', 'pending', 0, 0, ?, ?)""",
                (str(uuid.uuid4()), run_id, merchant["merchant_id"], title, instruction, now, now),
            )
            inserted += 1
    return inserted
