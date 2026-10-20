#!/usr/bin/env python3
"""Translation worker: translates one partition group via Nemotron 3 Ultra Free.

Processes the group's batch file in chunks of vendors, calling omp with
@file prompt transport, validating each response, and ingesting immediately.
Resumable: skips vendors whose translations already exist in the DB.

Usage: python3 scripts/translate_worker.py --group N
Exit codes: 0 = group complete; 1 = incomplete (items left untranslated, retries
exhausted); 2 = provider failure (retry later).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from translate_bilingual import connect, extract_vendor, N_GROUPS, WORK_DIR, TRANSLATE_MODEL

# Single source of truth: the id lives in translate_bilingual only, so the
# prompt payload header and the actual model call can never desynchronise.
MODEL = TRANSLATE_MODEL
GLOSSARY = (Path(__file__).parent.parent / "data" / "bilingual_glossary.md").read_text(encoding="utf-8")
CHUNK_ITEMS = 6           # items per omp call (Nemotron reasoning time scales with items)
RATE_SLEEP = 2            # seconds between calls


def build_prompt(items: list[dict]) -> str:
    compact = [{k: it[k] for k in ("record_id", "field_name", "target_lang", "source_text")}
               for it in items]
    return json.dumps({
        "instructions": [
            "You are a professional EN<->AR translator for a vendor-guide platform.",
            "Translate each item's source_text into its target_lang.",
            "RULES: preserve numbers, URLs, IDs, dates verbatim; preserve claim "
            "strength exactly (never escalate 'complaints' to 'fraud'; never soften "
            "'scam' when the source says scam); use the shared glossary below; "
            "clear Modern Standard Arabic; never invent, summarize, or omit; "
            "flag ambiguity as [AMBIGUOUS: reason] instead of guessing.",
            "GLOSSARY:\n" + GLOSSARY,
            'Return ONLY a JSON array: [{"record_id": "...", "field_name": "...", "translated_text": "..."}] '
            "with one entry per input item, same order.",
        ],
        "items": compact,
    }, ensure_ascii=False)


def call_model(items: list[dict]) -> list[dict] | None:
    # Unique prompt file per process: the four supervisor workers share
    # WORK_DIR, so a millisecond timestamp can collide and one worker would
    # truncate / unlink the file another's `omp @file` is still reading.
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    pfile = tempfile.NamedTemporaryFile(
        "w", dir=WORK_DIR, suffix=".json", delete=False, encoding="utf-8"
    )
    try:
        pfile.write(build_prompt(items))
        pfile.close()
        r = subprocess.run(
            ["timeout", "900", "omp", "-p", "--mode", "json", "--no-session", "--no-tools",
             "--model", MODEL, f"@{pfile.name}"],
            capture_output=True, text=True,
        )
    finally:
        pfile.close()
        try:
            os.unlink(pfile.name)
        except OSError:
            pass
    result_text = None
    for line in r.stdout.splitlines():
        try:
            e = json.loads(line)
        except Exception:
            continue
        # Nemotron emits multiple assistant message_end events (thinking pass
        # then final answer). Keep the LAST one with non-empty text.
        if e.get("type") == "message_end" and e.get("message", {}).get("role") == "assistant":
            c = e["message"].get("content")
            text = "".join(x.get("text", "") for x in c
                           if isinstance(x, dict) and x.get("type") == "text")
            if text.strip():
                result_text = text
    if not result_text:
        return None
    # strip markdown fences if present
    result_text = re.sub(r"^```(json)?|```$", "", result_text.strip(), flags=re.M).strip()
    try:
        parsed = json.loads(result_text)
    except json.JSONDecodeError:
        # model sometimes emits invalid escapes; extract entries defensively
        parsed = []
        for m in re.finditer(r'\{[^{}]*\}', result_text, re.S):
            try:
                entry = json.loads(m.group(0))
                if isinstance(entry, dict) and "translated_text" in entry:
                    parsed.append(entry)
            except json.JSONDecodeError:
                continue
        if not parsed:
            return None
    return parsed if isinstance(parsed, list) else None


def already_done(db, rid: str, field: str, lang: str) -> bool:
    return db.execute(
        "SELECT 1 FROM translations WHERE table_name IN ('evidence','claims','merchant_briefs') "
        "AND record_id=? AND field_name=? AND lang=? AND content != ''",
        (rid, field, lang)).fetchone() is not None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", type=int, required=True)
    args = ap.parse_args()

    db = connect(readonly=True)
    bins_mids = None
    # rebuild partition deterministically
    from translate_bilingual import partition
    bins_mids = partition(db)
    mids = bins_mids[args.group]
    print(f"group {args.group}: {len(mids)} merchants", flush=True)

    # build full work queue, skipping completed items
    queue: list[dict] = []
    for mid in mids:
        doc = extract_vendor(db, mid)
        for it in doc["items"]:
            if not already_done(db, it["record_id"], it["field_name"], it["target_lang"]):
                queue.append(it)
    db.close()
    total = len(queue)
    print(f"remaining items in group: {total}", flush=True)
    if total == 0:
        print("group complete", flush=True)
        return 0

    MAX_CHUNK_ATTEMPTS = 3
    db_w = connect()
    done = 0
    errors = 0
    attempts: dict[int, int] = {}
    pending = list(range(0, len(queue), CHUNK_ITEMS))
    while pending:
        i = pending.pop(0)
        chunk = queue[i:i + CHUNK_ITEMS]
        result = call_model(chunk)
        if result is None:
            attempts[i] = attempts.get(i, 0) + 1
            errors += 1
            print(f"chunk {i//CHUNK_ITEMS}: model failure "
                  f"(consecutive {errors}, attempt {attempts[i]}/{MAX_CHUNK_ATTEMPTS})", flush=True)
            if errors >= 3:
                db_w.close()
                print("aborting: 3 consecutive model failures", flush=True)
                return 2
            if attempts[i] < MAX_CHUNK_ATTEMPTS:
                pending.append(i)
            time.sleep(30)
            continue
        errors = 0  # a success breaks the consecutive-failure streak
        by_key = {}
        for item in chunk:
            by_key[(item["record_id"], item["field_name"])] = item
        ingested = 0
        for t in result:
            key = (t.get("record_id"), t.get("field_name"))
            src = by_key.get(key)
            if not src or not (t.get("translated_text") or "").strip():
                continue
            # Echo guard: a "translation" identical to its source adds nothing
            # and poisons the validator's identity check.
            if t["translated_text"].strip() == src["source_text"].strip():
                print(f"  echo rejected: {key[0][:8]}/{key[1][:8]}", flush=True)
                continue
            db_w.execute("""
                INSERT INTO translations (table_name, record_id, field_name, lang, content, model)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(table_name, record_id, field_name, lang)
                DO UPDATE SET content=excluded.content
            """, (src["table_name"], src["record_id"], src["field_name"],
                  src["target_lang"], t["translated_text"], MODEL))
            ingested += 1
        db_w.commit()
        done += ingested
        print(f"chunk {i//CHUNK_ITEMS}: {ingested}/{len(chunk)} ingested "
              f"(total {done}/{total})", flush=True)
        time.sleep(RATE_SLEEP)
    db_w.close()
    if done < total:
        exhausted = sorted(n // CHUNK_ITEMS for n, a in attempts.items()
                           if a >= MAX_CHUNK_ATTEMPTS)
        print(f"group {args.group} incomplete: {done}/{total} translated; "
              f"chunks exhausted retries: {exhausted}", flush=True)
        return 1
    print(f"group {args.group} complete: {done} translated", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
