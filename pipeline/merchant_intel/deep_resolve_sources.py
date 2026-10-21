"""Deep link resolution and citation specificity pass for merchant-intelligence.

Resolves page-level and stale pre-redirect sources in the master dataset:
1. Public resolvable redirects: upgrade web_url to deeper/more specific final_url.
2. Redirect-to-home: keep original specific path and record explanatory locator_note.
3. Facebook vendor pages on claim evidence: mark honest locator_note and source_label.
4. Identity/contact/presence claims: skip page-level links (they are correct).
5. Dead / unreachable links: record explanatory locator_note.
6. Recompute canonical_url when web_url changes for audit consistency.
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import urlsplit

from merchant_intel.config import load_config
from merchant_intel.normalize import canonicalize_url
from merchant_intel.source_audit import (
    FALLBACK_GET_STATUSES,
    LinkCheckResult,
    check_url,
    persist_check,
)
from merchant_intel.sources import safe_http_url

logger = logging.getLogger(__name__)

#: Identity / contact / presence claim types where page-level / domain-root link is correct.
IDENTITY_CLAIM_TYPES: frozenset[str] = frozenset(
    {
        "verified_business_information",
        "physical_presence",
        "contact_information",
        "store_identity",
        "official_warning",
        "company_profile",
    }
)

#: Common site language roots that represent home / portal pages rather than specific content.
LANG_ROOTS: frozenset[str] = frozenset(
    {"ar", "en", "ar-eg", "en-eg", "eg-ar", "eg-en", "eg"}
)

NOTE_DEAD: str = "Original post no longer reachable"
NOTE_FB_VENDOR_PAGE: str = "Vendor page — the specific post is not publicly linkable"
LABEL_FB_VENDOR_PAGE: str = "Vendor page"
NOTE_REDIRECT_TO_HOME: str = "Redirect resolved to site root; original path kept"


def path_segments(url: str | None) -> tuple[int, list[str]]:
    """Return count and list of non-empty path segments."""
    if not url:
        return 0, []
    parts = urlsplit(url)
    p = parts.path.strip("/")
    if not p:
        return 0, []
    segs = [s for s in p.split("/") if s]
    return len(segs), segs


def is_facebook_host(netloc: str) -> bool:
    """Return True if netloc is Facebook / fb."""
    host = netloc.lower().split(":")[0]
    return (
        host == "facebook.com"
        or host.endswith(".facebook.com")
        or host == "fb.com"
        or host.endswith(".fb.com")
    )


def is_facebook_vendor_page(
    url: str, path_count: int, path: str, query: str
) -> bool:
    """Return True if Facebook URL is a vendor page root/mentions/photos/ref."""
    path_lower = path.lower()
    query_lower = query.lower()

    # Explicit mentions, photos, plugins, about sections
    if "/mentions" in path_lower or "/photos" in path_lower or "/plugins/" in path_lower:
        return True
    if "/about" in path_lower or "/about_details" in path_lower:
        return True

    # Embedded ref queries
    if "ref=" in query_lower or "ref=" in url.lower():
        if (
            "/posts/" not in path_lower
            and "/videos/" not in path_lower
            and "/reel/" not in path_lower
        ):
            return True

    # Root / handle / profile / people / p pages
    if path_count <= 1:
        return True
    if path_lower.startswith("/p/") or path_lower.startswith("/people/"):
        return True

    return False


def is_redirect_to_home(orig_url: str, final_url: str) -> bool:
    """True if final_url dropped from deep path (orig > 1) to site root / language root (<= 1)."""
    orig_count, _ = path_segments(orig_url)
    fin_count, fin_segs = path_segments(final_url)
    is_lang = fin_count == 1 and fin_segs[0].lower() in LANG_ROOTS
    return orig_count > 1 and (fin_count <= 1 or is_lang)


def is_deeper_url(orig_url: str, final_url: str) -> bool:
    """True if final_url is deeper/more specific than orig_url and not a language home root."""
    orig_count, _ = path_segments(orig_url)
    fin_count, fin_segs = path_segments(final_url)
    is_lang = fin_count == 1 and fin_segs[0].lower() in LANG_ROOTS
    if is_lang:
        return False
    return fin_count > orig_count


@dataclass
class DeepResolveSummary:
    """Audit counts from deep resolve execution."""

    total_web_sources: int = 0
    candidate_page_level: int = 0
    rows_upgraded_deeper: int = 0
    rows_redirect_home_kept: int = 0
    rows_dead_noted: int = 0
    rows_fb_vendor_page_noted: int = 0
    rows_identity_skipped: int = 0
    network_probes_run: int = 0
    dry_run: bool = False
    details: list[dict[str, Any]] = field(default_factory=list)


def deep_resolve_sources(
    conn: sqlite3.Connection,
    *,
    dry_run: bool = False,
    limit: int | None = None,
    probe_network: bool = False,
    network_limit: int | None = None,
    delay_sec: float = 1.0,
) -> DeepResolveSummary:
    """Execute the deep-resolve pass against an open SQLite connection."""
    summary = DeepResolveSummary(dry_run=dry_run)

    # 1. Evidence map: source_id -> set of claim_types
    src_claims: dict[int, set[str]] = {}
    for r in conn.execute("SELECT source_id, claim_type FROM evidence").fetchall():
        src_claims.setdefault(r["source_id"], set()).add(r["claim_type"])

    # 2. Existing link checks
    checks = {
        r["source_id"]: dict(r)
        for r in conn.execute("SELECT * FROM source_link_checks").fetchall()
    }

    # 3. Sources with valid http(s) web_url
    sources = conn.execute(
        """SELECT id, url, canonical_url, web_url, source_label, locator_note, access_kind
           FROM sources
           WHERE web_url IS NOT NULL AND TRIM(web_url) != ''
           ORDER BY id ASC"""
    ).fetchall()

    summary.total_web_sources = len(sources)

    # Optional network probing for unprobed candidate public-resolvable sources
    if probe_network and (network_limit is None or network_limit > 0):
        probed_count = 0
        for s in sources:
            if network_limit is not None and probed_count >= network_limit:
                break
            sid = s["id"]
            if sid in checks:
                continue
            url = s["web_url"]
            if not url or safe_http_url(url) is None:
                continue
            parts = urlsplit(url)
            if is_facebook_host(parts.netloc):
                continue
            path_count, _ = path_segments(url)
            if path_count > 1:
                continue
            claims = src_claims.get(sid, set())
            if not bool(claims - IDENTITY_CLAIM_TYPES):
                continue  # skip identity-only sources from network probing

            # Probe URL
            if probed_count and delay_sec > 0:
                time.sleep(delay_sec)
            try:
                res = check_url(url, timeout=8.0)
            except Exception as err:
                res = LinkCheckResult(
                    sid,
                    "network_error",
                    url,
                    None,
                    f"probe failure: {type(err).__name__}: {err}"[:300],
                )
            probed_count += 1
            summary.network_probes_run += 1
            checks[sid] = {
                "source_id": sid,
                "status": res.status,
                "final_url": res.final_url,
                "http_status": res.http_status,
                "detail": res.detail,
            }
            if not dry_run:
                persist_check(conn, res)

    # Cache existing canonical_url values to protect UNIQUE constraint
    existing_canonical_urls = {
        r["canonical_url"]: r["id"]
        for r in conn.execute("SELECT id, canonical_url FROM sources").fetchall()
    }

    # Process all sources
    processed_count = 0
    for s in sources:
        if limit is not None and processed_count >= limit:
            break

        sid = s["id"]
        current_web_url = s["web_url"]
        current_canonical = s["canonical_url"]
        current_note = (s["locator_note"] or "").strip()
        current_label = (s["source_label"] or "").strip()

        claims = src_claims.get(sid, set())
        chk = checks.get(sid)

        parts = urlsplit(current_web_url)
        path_count, segs = path_segments(current_web_url)
        is_page_level = path_count <= 1
        if is_page_level:
            summary.candidate_page_level += 1

        new_web_url = current_web_url
        new_note = current_note
        new_label = current_label
        new_canonical = current_canonical

        modified = False

        # (e) Check if dead / access limited in source_link_checks
        if chk and chk["status"] in ("not_found", "dead", "access_limited"):
            if not new_note:
                new_note = NOTE_DEAD
                modified = True
                summary.rows_dead_noted += 1

        # (b) Public resolvable redirect upgrades and redirect-to-home
        if chk and chk["status"] == "redirected" and chk.get("final_url"):
            final_url = chk["final_url"]
            if final_url != current_web_url:
                if is_redirect_to_home(current_web_url, final_url):
                    if not new_note:
                        new_note = NOTE_REDIRECT_TO_HOME
                        modified = True
                        summary.rows_redirect_home_kept += 1
                elif is_deeper_url(current_web_url, final_url):
                    new_web_url = final_url
                    new_canon_candidate = canonicalize_url(final_url)
                    # Protect UNIQUE(canonical_url) constraint
                    collision_id = existing_canonical_urls.get(new_canon_candidate)
                    if collision_id is None or collision_id == sid:
                        new_canonical = new_canon_candidate
                        existing_canonical_urls[new_canon_candidate] = sid
                        if current_canonical in existing_canonical_urls and existing_canonical_urls[current_canonical] == sid:
                            del existing_canonical_urls[current_canonical]
                    modified = True
                    summary.rows_upgraded_deeper += 1

        # (d) Identity / contact / presence claims check
        has_non_identity = bool(claims - IDENTITY_CLAIM_TYPES)
        if is_page_level and not has_non_identity:
            summary.rows_identity_skipped += 1
            # Page-level link is correct for identity/contact claims; skip FB vendor page tagging
        else:
            # (c) Facebook vendor page on claim-type evidence
            if is_facebook_host(parts.netloc) and has_non_identity:
                if is_facebook_vendor_page(
                    current_web_url, path_count, parts.path, parts.query
                ):
                    changed_fb = False
                    if not new_note:
                        new_note = NOTE_FB_VENDOR_PAGE
                        changed_fb = True
                    if not new_label:
                        new_label = LABEL_FB_VENDOR_PAGE
                        changed_fb = True
                    if changed_fb:
                        modified = True
                        summary.rows_fb_vendor_page_noted += 1

        # Apply updates if modified
        if modified:
            summary.details.append(
                {
                    "id": sid,
                    "orig_web_url": current_web_url,
                    "new_web_url": new_web_url,
                    "orig_note": current_note,
                    "new_note": new_note,
                    "orig_label": current_label,
                    "new_label": new_label,
                    "orig_canonical": current_canonical,
                    "new_canonical": new_canonical,
                }
            )
            if not dry_run:
                conn.execute(
                    """UPDATE sources
                       SET web_url = ?, canonical_url = ?, locator_note = ?, source_label = ?
                       WHERE id = ?""",
                    (new_web_url, new_canonical, new_note, new_label, sid),
                )
        processed_count += 1

    return summary


def build_parser() -> argparse.ArgumentParser:
    """CLI argument parser for deep_resolve_sources."""
    parser = argparse.ArgumentParser(
        prog="deep_resolve_sources",
        description="Deep-resolve evidence source links in merchant-intelligence master DB.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Simulate resolution and output projected statistics without writing to DB.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of sources processed.",
    )
    parser.add_argument(
        "--db",
        type=str,
        default=None,
        help="Override database path (defaults to config or data/merchant_intelligence.db).",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to pipeline config yaml.",
    )
    parser.add_argument(
        "--network",
        action="store_true",
        default=False,
        help="Perform network checks for unprobed candidate public resolvable sources.",
    )
    parser.add_argument(
        "--network-limit",
        type=int,
        default=50,
        help="Maximum number of network requests to issue when --network is enabled (default: 50).",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Politeness delay between remote network requests in seconds (default: 1.0).",
    )
    return parser


def resolve_default_db_path(override: str | None = None, config_path: str | None = None) -> Path:
    if override:
        return Path(override).expanduser().resolve()
    candidate = Path.cwd() / "data" / "merchant_intelligence.db"
    if candidate.exists():
        return candidate.resolve()
    repo_root = Path(__file__).resolve().parent.parent.parent
    candidate = repo_root / "data" / "merchant_intelligence.db"
    if candidate.exists():
        return candidate.resolve()
    try:
        cfg_file = Path(config_path) if config_path else (repo_root / "config.yaml")
        cfg = load_config(cfg_file if cfg_file.exists() else None)
        resolved = cfg.resolve(cfg.database_path)
        if resolved.exists():
            return resolved
    except Exception:
        pass
    return candidate


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    db_path = resolve_default_db_path(args.db, args.config)
    if not db_path.exists():
        logger.error("Database not found at %s", db_path)
        return 1

    logger.info("Opening database at %s (dry_run=%s)", db_path, args.dry_run)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 10000;")

    try:
        if args.dry_run:
            summary = deep_resolve_sources(
                conn,
                dry_run=True,
                limit=args.limit,
                probe_network=args.network,
                network_limit=args.network_limit,
                delay_sec=args.delay,
            )
        else:
            with conn:
                summary = deep_resolve_sources(
                    conn,
                    dry_run=False,
                    limit=args.limit,
                    probe_network=args.network,
                    network_limit=args.network_limit,
                    delay_sec=args.delay,
                )

        print("\n" + "=" * 60)
        print(f"Deep Resolve Sources Summary (dry_run={summary.dry_run})")
        print("=" * 60)
        print(f"Total web sources examined:        {summary.total_web_sources}")
        print(f"Candidate page-level sources:      {summary.candidate_page_level}")
        print(f"Rows upgraded to deeper URL:       {summary.rows_upgraded_deeper}")
        print(f"Rows redirect-to-home kept:        {summary.rows_redirect_home_kept}")
        print(f"Rows dead/unreachable noted:       {summary.rows_dead_noted}")
        print(f"Rows FB vendor page noted:         {summary.rows_fb_vendor_page_noted}")
        print(f"Rows identity page-level skipped:  {summary.rows_identity_skipped}")
        print(f"Network probes run:                {summary.network_probes_run}")
        print("=" * 60 + "\n")

        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
