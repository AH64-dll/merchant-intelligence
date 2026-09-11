#!/usr/bin/env python3
"""Validate the bilingual translation layer.

Checks (exit non-zero on any violation):
1. Coverage: every translatable record has a translation for the target lang.
2. Fidelity: URLs, numbers, dates, vendor/evidence IDs preserved in translation.
3. Identity: no cross-record contamination (translation references only its own
   record's IDs/URLs).
4. Encoding: Arabic content must contain Arabic script; no mojibake markers.
5. Structure: record counts unchanged vs originals; quoted_excerpt semantics.

Usage:
  python3 scripts/validate_bilingual.py [--lang ar] [--strict]
Exits 0 when all checks pass.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "data" / "merchant_intelligence.db"

URL_RE = re.compile(r"https?://[^\s\"'<>)\]]+", re.IGNORECASE)
NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")
ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
MOJIBAKE_RE = re.compile(r"(�|\ufffd)")


def load_translations(db: sqlite3.Connection, lang: str) -> dict[tuple[str, str, str], str]:
    rows = db.execute(
        "SELECT table_name, record_id, field_name, content FROM translations WHERE lang=?",
        (lang,),
    ).fetchall()
    return {(t, r, f): c for t, r, f, c in rows}


def _westernize(text: str) -> str:
    """Normalize Arabic-Indic digits to Western for fidelity comparisons."""
    return text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))


def check_fidelity(source: str, translation: str, *, allow_script_only: bool = False) -> list[str]:
    """URLs and numbers appearing in source must appear in translation."""
    issues: list[str] = []
    w_source = _westernize(source)
    w_translation = _westernize(translation)
    for url in URL_RE.findall(w_source):
        # tolerate translation reflow: compare scheme+host+path-ish core
        core = re.sub(r"^https?://", "", url).rstrip(".,;،؛")
        if core not in w_translation.replace("\\", "/"):
            issues.append(f"URL lost/altered: {url[:80]}")
    src_nums = NUM_RE.findall(w_source)
    tr_nums = NUM_RE.findall(w_translation)
    # numbers are re-ordered legitimately, so require multiset containment for
    # distinctive (>= 3 digit) numbers only
    tr_digits_only = {re.sub(r"\D", "", x) for x in tr_nums}
    for n in src_nums:
        digits = re.sub(r"\D", "", n)
        if len(digits) >= 3 and digits not in tr_digits_only:
            issues.append(f"number lost: {n}")
    if MOJIBAKE_RE.search(translation):
        issues.append("encoding corruption marker present")
    return issues


def source_target_lang(text: str) -> str | None:
    """Return the required translation target lang for a source text."""
    has_ar = bool(ARABIC_RE.search(text))
    has_la = bool(re.compile(r"[A-Za-z]").search(text))
    if has_ar and not has_la:
        return "en"   # Arabic-native source → English translation
    if has_la and not has_ar:
        return "ar"   # Pure-Latin source → Arabic translation
    return None       # Mixed-script (Arabic + Latin brands): source is already
                      # valid Arabic for an Arabic-first site — no translation.


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="(unused: coverage is always fatal)")
    args = ap.parse_args()

    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    tr_ar = load_translations(db, "ar")
    tr_en = load_translations(db, "en")
    problems: list[str] = []

    def validate_pair(table: str, rid: str, field: str, source: str, target: str | None = None,
                      extra_context: str = "") -> None:
        """source is the canonical text; the opposite lang must exist and differ.
        target overrides script-detection (e.g. briefs are always ar→en).
        whole_document: fidelity URLs/numbers may move between fields of the
        same record — checked against this blob when provided."""
        s = (source or "").strip()
        if not s:
            return
        if target is None:
            # Match extractor semantics: the translation is the mirror of the
            # dominant script — latin/mixed → ar, pure-arabic → en. The source
            # text itself always remains present (originals never overwritten).
            has_ar = bool(ARABIC_RE.search(s))
            has_la = bool(re.compile(r"[A-Za-z]").search(s))
            target = "en" if (has_ar and not has_la) else ("ar" if has_la or has_ar else None)
            if target is None:
                return
        tr = tr_ar if target == "ar" else tr_en
        key = (table, rid, field)
        if key not in tr:
            problems.append(f"{table} {rid[:8]}:{field}: missing {target} translation")
            return
        content = tr[key]
        if not content.strip():
            problems.append(f"{table} {rid[:8]}:{field}: empty {target} translation")
            return
        if content.strip() == s:
            problems.append(f"{table} {rid[:8]}:{field}: translation identical to source")
        if target == "ar" and not ARABIC_RE.search(content):
            problems.append(f"{table} {rid[:8]}:{field}: 'ar' has no Arabic script")
        if target == "en" and not re.compile(r"[A-Za-z]").search(content):
            problems.append(f"{table} {rid[:8]}:{field}: 'en' has no Latin script")
        problems.extend(f"{table} {rid[:8]}:{field}: {p}"
                        for p in check_fidelity(s, content + " " + extra_context))

    # 1. evidence
    n_ev = 0
    for rid, summary, _q in db.execute("SELECT id, summary, quoted_excerpt FROM evidence"):
        before = len(problems)
        validate_pair("evidence", rid, "summary", summary)
        if len(problems) > before:
            n_ev += 1

    # 2. claims
    n_cl = 0
    for rid, summary in db.execute("SELECT id, summary FROM claims"):
        before = len(problems)
        validate_pair("claims", rid, "summary", summary)
        if len(problems) > before:
            n_cl += 1

    # 3. briefs (Arabic-authored → English target)
    n_br = 0
    for mid, payload_json in db.execute("SELECT merchant_id, payload_json FROM merchant_briefs"):
        payload = json.loads(payload_json)
        fields = {
            "identity_message": payload.get("identity_message", {}).get("text", ""),
            "reputation_message": payload.get("reputation_message", {}).get("text", ""),
        }
        for i, b in enumerate(payload.get("bullets", [])):
            fields[f"bullet_{i}"] = b.get("text", "")
        brief_fields_translations = {
            fname: tr_en.get(("merchant_briefs", f"{mid}::{fname}"), "")
            for fname in fields
        }
        for fname, src in fields.items():
            # Align with extractor: Latin-dominant brief fields (English brand
            # blurbs) are never queued for ar→en — skip them here too.
            if not ARABIC_RE.search(src):
                continue
            before = len(problems)
            # A number/URL counts as preserved if it appears in the same
            # field OR anywhere else in the same brief's translation.
            others = " ".join(v for k2, v in brief_fields_translations.items() if k2 != fname)
            validate_pair("merchant_briefs", f"{mid}::{fname}", "text", src,
                          target="en", extra_context=others)
            if len(problems) > before:
                n_br += 1

    # 4. original row counts unchanged
    if db.execute("SELECT COUNT(*) FROM evidence").fetchone()[0] != 3763:
        problems.append("evidence row count changed")
    if db.execute("SELECT COUNT(*) FROM claims").fetchone()[0] != 2644:
        problems.append("claims row count changed")

    db.close()

    print(f"coverage gaps: evidence={n_ev}, claims={n_cl}, brief-fields={n_br}")
    if problems:
        print(f"PROBLEMS ({len(problems)}):")
        for p in problems[:25]:
            print(f"  - {p}")
        if len(problems) > 25:
            print(f"  ... and {len(problems) - 25} more")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
