#!/usr/bin/env python3
"""Ingest a batch of new evidence rows and/or new merchants into the DB.

Input: JSONL file. One JSON object per line.

Line kinds:
  {"kind":"source", "url":..., "platform":..., "source_type":..., "source_label":..., "locator_note":..., "access_kind":...}
  {"kind":"merchant", "canonical_name":..., "normalized_name":..., "category":..., "city":..., "governorate":..., "identity_confidence":..., "state":...}
  {"kind":"evidence", "merchant_id":"<uuid>" | "merchant_normalized_name":"<name>",
                    "source_canonical_url":..., "claim_type":..., "sentiment":...,
                    "summary":..., "quoted_excerpt":..., "author_type":...,
                    "transaction_evidence":0|1, "confidence":0..1,
                    "reliability_band":..., "language":..., "published_at":ISO|null,
                    "claim_id":null, "fingerprint":..., "content_fingerprint":...,
                    "independent":1, "raw_json":{...}}

The script is idempotent: re-running on the same file is a no-op for rows
already present (matched by canonical_url for sources; fingerprint for
evidence; normalized_name for merchants).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "merchant_intelligence.db"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def fingerprint(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


def canonicalize_url(url: str) -> str:
    # Light canonicalization; full pipeline has a stronger version.
    if not url:
        return url
    u = url.strip().rstrip("/").lower()
    # strip scheme
    for pre in ("https://", "http://"):
        if u.startswith(pre):
            u = u[len(pre):]
            break
    # strip trailing ? and &
    u = u.split("?")[0].split("#")[0]
    return u


def upsert_source(cur: sqlite3.Cursor, s: dict) -> int:
    canonical = canonicalize_url(s.get("canonical_url") or s["url"])
    row = cur.execute(
        "SELECT id FROM sources WHERE canonical_url=?", (canonical,)
    ).fetchone()
    now = utcnow()
    if row:
        src_id = row[0]
        cur.execute("UPDATE sources SET last_seen_at=? WHERE id=?", (now, src_id))
        return src_id
    cur.execute(
        """
        INSERT INTO sources (url, canonical_url, platform, source_type,
                             first_seen_at, last_seen_at, web_url, source_label,
                             locator_note, access_kind)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        """,
        (
            s["url"],
            canonical,
            s.get("platform", "web"),
            s.get("source_type", "web"),
            now,
            now,
            s.get("web_url") or s["url"],
            s.get("source_label", ""),
            s.get("locator_note", ""),
            s.get("access_kind", "web"),
        ),
    )
    return cur.lastrowid


def upsert_merchant(cur: sqlite3.Cursor, m: dict) -> str:
    norm = (m.get("normalized_name") or m["canonical_name"]).strip().lower()
    row = cur.execute(
        "SELECT id FROM merchants WHERE normalized_name=?", (norm,)
    ).fetchone()
    now = utcnow()
    if row:
        return row[0]
    mid = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO merchants (id, canonical_name, normalized_name, category,
                               city, governorate, identity_confidence, state,
                               first_seen_round, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            mid,
            m["canonical_name"],
            norm,
            m.get("category", ""),
            m.get("city", ""),
            m.get("governorate", ""),
            float(m.get("identity_confidence", 0.5)),
            m.get("state", "INSUFFICIENT_DATA"),
            int(m.get("first_seen_round", 0)),
            now,
            now,
        ),
    )
    return mid


def insert_evidence(cur: sqlite3.Cursor, e: dict) -> str | None:
    # resolve merchant_id
    mid = e.get("merchant_id")
    if not mid:
        norm = (e.get("merchant_normalized_name") or "").strip().lower()
        if not norm:
            return None
        row = cur.execute(
            "SELECT id FROM merchants WHERE normalized_name=?", (norm,)
        ).fetchone()
        if not row:
            return None
        mid = row[0]

    src_url = e.get("source_canonical_url") or e.get("source_url")
    if not src_url:
        return None
    src_canonical = canonicalize_url(src_url)
    src_row = cur.execute(
        "SELECT id FROM sources WHERE canonical_url=?", (src_canonical,)
    ).fetchone()
    if not src_row:
        # auto-create the source row if missing
        src_id = upsert_source(
            cur,
            {
                "url": e.get("source_url") or src_url,
                "canonical_url": src_canonical,
                "platform": e.get("platform", "web"),
                "source_type": e.get("source_type", "web"),
                "web_url": e.get("source_url") or src_url,
            },
        )
    else:
        src_id = src_row[0]

    fp = e.get("fingerprint") or fingerprint(mid, str(src_id), e.get("summary", ""))
    cfp = e.get("content_fingerprint") or fingerprint(e.get("summary", ""), e.get("quoted_excerpt", ""))

    # already exists?
    row = cur.execute("SELECT id FROM evidence WHERE fingerprint=?", (fp,)).fetchone()
    if row:
        return row[0]

    evid = str(uuid.uuid4())
    now = utcnow()

    raw_sent = str(e.get("sentiment") or "neutral").strip().lower()
    sent_aliases = {"pos": "positive", "neg": "negative", "neu": "neutral", "mixed": "neutral"}
    sentiment = sent_aliases.get(raw_sent, raw_sent if raw_sent in {"positive", "negative", "neutral"} else "neutral")

    raw_band = str(e.get("reliability_band") or "weak").strip().lower()
    band_aliases = {"low": "weak", "moderate": "medium", "high": "strong", "very_high": "very_strong"}
    reliability_band = band_aliases.get(raw_band, raw_band if raw_band in {"weak", "medium", "strong", "very_strong"} else "weak")

    raw_conf = float(e.get("confidence", 0.5))
    confidence = max(0.0, min(1.0, raw_conf))

    dup_of = e.get("duplicate_of")
    if dup_of:
        # Canonicalize to root and ensure same merchant
        seen_chain: set[str] = set()
        curr_dup = dup_of
        while curr_dup:
            parent_row = cur.execute("SELECT id, merchant_id, duplicate_of FROM evidence WHERE id=?", (curr_dup,)).fetchone()
            if not parent_row or parent_row[1] != mid:
                curr_dup = None
                break
            if not parent_row[2]:
                break
            if curr_dup in seen_chain:
                curr_dup = None
                break
            seen_chain.add(curr_dup)
            curr_dup = parent_row[2]
        dup_of = curr_dup

    independent = 0 if dup_of else int(e.get("independent", 1))

    cur.execute(
        """
        INSERT INTO evidence (
            id, merchant_id, source_id, claim_id, claim_type, sentiment,
            summary, quoted_excerpt, author_type, transaction_evidence,
            confidence, reliability_band, language, published_at,
            captured_at, fingerprint, content_fingerprint, independent,
            duplicate_of, agent_run_id, round_no, verified, raw_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            evid,
            mid,
            src_id,
            e.get("claim_id"),
            e.get("claim_type", "verified_business_information"),
            sentiment,
            e.get("summary", ""),
            e.get("quoted_excerpt", ""),
            e.get("author_type", "unknown"),
            int(e.get("transaction_evidence", 0)),
            confidence,
            reliability_band,
            e.get("language", "en"),
            e.get("published_at"),
            now,
            fp,
            cfp,
            independent,
            dup_of,
            e.get("agent_run_id"),
            int(e.get("round_no", 0)),
            int(e.get("verified", 0)),
            json.dumps(e.get("raw_json") or {}, ensure_ascii=False),
        ),
    )
    return evid


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("file", help="JSONL batch file")
    args = p.parse_args()

    con = sqlite3.connect(DB)
    cur = con.cursor()

    stats = {"sources": 0, "merchants": 0, "evidence": 0, "skipped": 0, "errors": 0}
    with open(args.file, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as ex:
                print(f"line {lineno}: bad json: {ex}", file=sys.stderr)
                stats["errors"] += 1
                continue

            kind = rec.get("kind")
            try:
                if kind == "source":
                    upsert_source(cur, rec)
                    stats["sources"] += 1
                elif kind == "merchant":
                    upsert_merchant(cur, rec)
                    stats["merchants"] += 1
                elif kind == "evidence":
                    if insert_evidence(cur, rec):
                        stats["evidence"] += 1
                    else:
                        stats["skipped"] += 1
                else:
                    stats["skipped"] += 1
            except Exception as ex:
                print(f"line {lineno}: {kind} failed: {ex}", file=sys.stderr)
                stats["errors"] += 1

    con.commit()
    print(json.dumps(stats))
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
