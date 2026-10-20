"""Sanitized exports that retain source URLs and evidence provenance."""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from typing import Any, Callable, TextIO

from merchant_intel.database import Database


# Internal model output: never emitted by a sanitized export. ``raw_json`` is
# the scraped payload, ``quoted_excerpt`` the raw quote, ``payload_json`` the
# verbatim merchant analysis (internal_state, risk signals, notes) and
# ``result_json`` the raw verification-task result.
_INTERNAL_FIELDS = {"raw_json", "quoted_excerpt", "payload_json", "result_json"}

# A spreadsheet treats a cell beginning with any of these as a formula (or a
# continuation), so scraped/model text that starts with one is prefixed with a
# single quote to force literal text.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _clean(row: Any, *, sanitized: bool) -> dict[str, Any]:
    value = dict(row)
    if sanitized:
        for key in _INTERNAL_FIELDS:
            value.pop(key, None)
    return value


def _neutralize(value: Any) -> Any:
    """Defuse spreadsheet formula injection for exported text cells.

    Excel, LibreOffice and Google Sheets execute a cell that begins with
    ``=``, ``+``, ``-``, ``@``, a tab or a carriage return, so a scraped
    summary or URL can run on open. Such a string gets a leading single quote,
    which spreadsheets read as a literal-text marker. Only strings are touched:
    numbers pass through unchanged, so ordinary negative numbers never become
    text.
    """
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def _atomic_write(
    path: Path, write: Callable[[TextIO], None], *, newline: str | None = None
) -> None:
    """Write ``path`` via a temp sibling and ``os.replace``.

    A crash or a full disk therefore never leaves a truncated file at the
    public name: readers see the previous complete file or the new one.
    """
    tmp = path.with_name(path.name + ".tmp")
    try:
        with tmp.open("w", encoding="utf-8", newline=newline) as handle:
            write(handle)
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def export_dataset(
    db: Database,
    dest: Path,
    fmt: str,
    *,
    sanitized: bool = True,
) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    # Unique tiebreakers on every sort so re-exporting an unchanged database is
    # byte-stable.
    merchants = db.query("SELECT * FROM merchants ORDER BY canonical_name, id")
    evidence = db.query(
        """SELECT e.*, m.canonical_name AS merchant_name, s.url AS source_url,
                  s.canonical_url, s.platform, s.source_type
           FROM evidence e JOIN merchants m ON m.id=e.merchant_id
           JOIN sources s ON s.id=e.source_id
           ORDER BY m.canonical_name, e.captured_at, e.id"""
    )
    analyses = db.query(
        "SELECT * FROM merchant_analyses a ORDER BY a.merchant_id, a.created_at, a.id"
    )
    tasks = db.query(
        "SELECT id, run_id, merchant_id, title, instruction, priority, status, attempts, result_json"
        " FROM verification_tasks ORDER BY id"
    )
    if fmt == "json":
        path = dest / "merchants.json"
        payload = {
            "merchants": [_clean(row, sanitized=sanitized) for row in merchants],
            "evidence": [_clean(row, sanitized=sanitized) for row in evidence],
            "analyses": [_clean(row, sanitized=sanitized) for row in analyses],
            "verification_tasks": [_clean(row, sanitized=sanitized) for row in tasks],
        }
        _atomic_write(
            path,
            lambda handle: handle.write(
                json.dumps(payload, ensure_ascii=False, indent=2, default=str)
            ),
        )
        return path
    if fmt == "jsonl":
        path = dest / "evidence.jsonl"

        def write_jsonl(handle: TextIO) -> None:
            for row in evidence:
                handle.write(
                    json.dumps(
                        _clean(row, sanitized=sanitized),
                        ensure_ascii=False,
                        default=str,
                    )
                    + "\n"
                )

        _atomic_write(path, write_jsonl)
        return path
    path = dest / "evidence.csv"
    fields = [
        "id",
        "merchant_id",
        "merchant_name",
        "source_url",
        "platform",
        "source_type",
        "claim_type",
        "sentiment",
        "summary",
        "confidence",
        "reliability_band",
        "published_at",
        "captured_at",
        "independent",
        "duplicate_of",
        "verified",
    ]

    def write_csv(handle: TextIO) -> None:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in evidence:
            clean = _clean(row, sanitized=sanitized)
            writer.writerow({key: _neutralize(clean.get(key, "")) for key in fields})

    _atomic_write(path, write_csv, newline="")
    return path
