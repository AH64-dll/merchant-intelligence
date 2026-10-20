#!/usr/bin/env python3
"""Bilingual translation orchestrator.

Extracts translatable fields per vendor, partitions vendors into 4
workload-balanced groups, writes batch JSON payloads for translation agents,
and ingests agent output back into the `translations` table.

Usage:
  python3 scripts/translate_bilingual.py extract --group 0..3  # write batch file
  python3 scripts/translate_bilingual.py ingest --file <path>  # ingest results
  python3 scripts/translate_bilingual.py status               # coverage report
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "data" / "merchant_intelligence.db"
WORK_DIR = Path(__file__).resolve().parent.parent / "data" / "bilingual"
N_GROUPS = 4

TRANSLATE_MODEL = "merge-gateway/glm-5.3-flash"

# Every translations row must name a table the extractor can emit; a missing or
# unknown table_name is refused rather than defaulted (a wrong table
# misattributes the row and manufactures phantom coverage gaps).
VALID_TABLES = {"evidence", "claims", "merchant_briefs"}
REQUIRED_ITEM_KEYS = ("record_id", "field_name", "target_lang", "translated_text")


def connect(readonly: bool = False) -> sqlite3.Connection:
    uri = f"file:{DB}?mode=ro" if readonly else f"file:{DB}"
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row
    return db


def vendor_workload(db: sqlite3.Connection) -> dict[str, int]:
    """Translation workload per merchant (evidence + claims + brief fields)."""
    rows = db.execute("""
        SELECT m.id,
          COALESCE((SELECT SUM(LENGTH(summary)) FROM evidence WHERE merchant_id=m.id), 0) +
          COALESCE((SELECT SUM(LENGTH(summary)) FROM claims WHERE merchant_id=m.id), 0) +
          COALESCE((SELECT LENGTH(payload_json) FROM merchant_briefs WHERE merchant_id=m.id), 0)
          AS bytes
        FROM merchants m
    """).fetchall()
    return {r["id"]: (r["bytes"] or 0) for r in rows}


def partition(db: sqlite3.Connection) -> list[list[str]]:
    """Greedy 4-way partition by workload bytes; stable, deterministic order."""
    work = vendor_workload(db)
    ids = sorted(work)  # deterministic
    bins: list[list[str]] = [[] for _ in range(N_GROUPS)]
    loads = [0] * N_GROUPS
    for mid in sorted(ids, key=lambda x: -work[x]):  # heaviest first
        i = loads.index(min(loads))
        bins[i].append(mid)
        loads[i] += work[mid]
    return bins



def extract_vendor(db: sqlite3.Connection, mid: str) -> dict:
    """Collect all translatable fields for one vendor."""
    doc: dict = {"merchant_id": mid, "items": []}

    def add(table: str, rid: str, field: str, source_lang: str, text: str, target: str):
        if not text or not text.strip():
            return
        doc["items"].append({
            "table_name": table,
            "record_id": rid,
            "field_name": field,
            "source_lang": source_lang,
            "target_lang": target,
            "source_text": text,
        })

    latin = re.compile(r"[A-Za-z]")
    arabic = re.compile(r"[\u0600-\u06FF]")

    for r in db.execute(
        "SELECT id, summary, language FROM evidence WHERE merchant_id=? AND summary != ''", (mid,)
    ):
        s = r["summary"]
        has_ar = bool(arabic.search(s))
        has_la = bool(latin.search(s))
        if has_ar and not has_la:
            add("evidence", r["id"], "summary", "ar", s, "en")   # Arabic source → English
        elif has_la and not has_ar:
            add("evidence", r["id"], "summary", "en", s, "ar")   # Pure-Latin → Arabic
        # Mixed-script (Arabic-dominant + Latin brand names): source is already
        # valid Arabic for an Arabic-first site — queueing ar "translation"
        # just asks the model to echo. Skip.

    for r in db.execute(
        "SELECT id, summary FROM claims WHERE merchant_id=? AND summary != ''", (mid,)
    ):
        s = r["summary"]
        has_ar = bool(arabic.search(s))
        has_la = bool(latin.search(s))
        if has_ar and not has_la:
            add("claims", r["id"], "summary", "ar", s, "en")
        elif has_la and not has_ar:
            add("claims", r["id"], "summary", "en", s, "ar")

    br = db.execute(
        "SELECT payload_json FROM merchant_briefs WHERE merchant_id=?", (mid,)
    ).fetchone()
    if br:
        payload = json.loads(br["payload_json"])
        for key in ("identity_message", "reputation_message"):
            t = payload.get(key, {}).get("text", "")
            # Briefs are Arabic-authored → ar→en. Skip Latin-dominant fields
            # (English brand blurbs) — queueing them for ar is an echo.
            if t.strip() and arabic.search(t):
                add("merchant_briefs", f"{mid}::{key}", "text", "ar", t, "en")
        for i, b in enumerate(payload.get("bullets", [])):
            t = b.get("text", "")
            if t.strip() and arabic.search(t):
                add("merchant_briefs", f"{mid}::bullet_{i}", "text", "ar", t, "en")

    return doc


def cmd_extract(group: int) -> int:
    db = connect(readonly=True)
    bins = partition(db)
    mids = bins[group]
    WORK_DIR.mkdir(exist_ok=True)
    out_path = WORK_DIR / f"batch_{group}.json"
    docs = [extract_vendor(db, mid) for mid in mids]
    payload = {
        "group": group,
        "model": TRANSLATE_MODEL,
        "merchants": len(mids),
        "docs": docs,
    }
    # Atomic: agents read this file; a torn write would hand them half a batch.
    tmp_path = WORK_DIR / (out_path.name + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp_path, out_path)
    items = sum(len(d["items"]) for d in docs)
    print(f"group {group}: {len(mids)} merchants, {items} fields -> {out_path.name} "
          f"({out_path.stat().st_size/1024:.0f} KB)")
    db.close()
    return 0


def cmd_ingest(file: str) -> int:
    data = json.loads(Path(file).read_text(encoding="utf-8"))
    translations = data.get("translations")
    if not isinstance(translations, list):
        print(f"ingest error: {file} has no 'translations' list", file=sys.stderr)
        return 1
    # Validate the required keys up front: a KeyError halfway down a batch would
    # abort the file after some rows were already inserted.
    for n, item in enumerate(translations):
        if not isinstance(item, dict):
            print(f"ingest error: translations[{n}] is not an object", file=sys.stderr)
            return 1
        missing = [k for k in REQUIRED_ITEM_KEYS if not item.get(k)]
        if missing:
            print(f"ingest error: translations[{n}] missing required {missing}", file=sys.stderr)
            return 1
    db = connect()
    count = 0
    skipped = 0
    for item in translations:
        # Never default a missing/unknown table_name to 'evidence': that
        # misattributes the row and manufactures phantom coverage gaps.
        if item.get("table_name") not in VALID_TABLES:
            skipped += 1
            continue
        db.execute("""
            INSERT INTO translations (table_name, record_id, field_name, lang, content, model)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(table_name, record_id, field_name, lang)
            DO UPDATE SET content=excluded.content, model=excluded.model
        """, (item["table_name"], item["record_id"], item["field_name"],
              item["target_lang"], item["translated_text"], item.get("model", TRANSLATE_MODEL)))
        count += 1
    db.commit()
    total = db.execute("SELECT COUNT(*) FROM translations").fetchone()[0]
    print(f"ingested {count} translations; table total now {total}"
          + (f"; skipped {skipped} with missing/unknown table_name" if skipped else ""))
    db.close()
    return 0


def cmd_status() -> int:
    db = connect(readonly=True)
    total_ev = db.execute("SELECT COUNT(*) FROM evidence WHERE summary != ''").fetchone()[0]
    total_cl = db.execute("SELECT COUNT(*) FROM claims WHERE summary != ''").fetchone()[0]
    for lang in ("ar", "en"):
        n_ev = db.execute(
            "SELECT COUNT(*) FROM translations WHERE lang=? AND table_name='evidence'", (lang,)
        ).fetchone()[0]
        n_cl = db.execute(
            "SELECT COUNT(*) FROM translations WHERE lang=? AND table_name='claims'", (lang,)
        ).fetchone()[0]
        n_br = db.execute(
            "SELECT COUNT(*) FROM translations WHERE lang=? AND table_name='merchant_briefs'", (lang,)
        ).fetchone()[0]
        print(f"{lang}: evidence {n_ev}/{total_ev} | claims {n_cl}/{total_cl} | briefs {n_br}")
    db.close()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("extract")
    p1.add_argument("--group", type=int, required=True)
    p2 = sub.add_parser("ingest")
    p2.add_argument("--file", required=True)
    sub.add_parser("status")
    args = ap.parse_args()
    if args.cmd == "extract":
        return cmd_extract(args.group)
    if args.cmd == "ingest":
        return cmd_ingest(args.file)
    return cmd_status()


if __name__ == "__main__":
    sys.exit(main())
