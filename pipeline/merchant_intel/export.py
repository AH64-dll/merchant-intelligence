"""Sanitized exports that retain source URLs and evidence provenance."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from merchant_intel.database import Database


_INTERNAL_FIELDS = {"raw_json", "quoted_excerpt"}


def _clean(row: Any, *, sanitized: bool) -> dict[str, Any]:
    value = dict(row)
    if sanitized:
        for key in _INTERNAL_FIELDS:
            value.pop(key, None)
    return value


def export_dataset(
    db: Database,
    dest: Path,
    fmt: str,
    *,
    sanitized: bool = True,
) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    merchants = db.query("SELECT * FROM merchants ORDER BY canonical_name")
    evidence = db.query(
        """SELECT e.*, m.canonical_name AS merchant_name, s.url AS source_url,
                  s.canonical_url, s.platform, s.source_type
           FROM evidence e JOIN merchants m ON m.id=e.merchant_id
           JOIN sources s ON s.id=e.source_id
           ORDER BY m.canonical_name, e.captured_at"""
    )
    analyses = db.query(
        "SELECT * FROM merchant_analyses ORDER BY merchant_id, created_at"
    )
    tasks = db.query(
        "SELECT id, run_id, merchant_id, title, instruction, priority, status, attempts, result_json FROM verification_tasks"
    )
    if fmt == "json":
        path = dest / "merchants.json"
        payload = {
            "merchants": [_clean(row, sanitized=sanitized) for row in merchants],
            "evidence": [_clean(row, sanitized=sanitized) for row in evidence],
            "analyses": [_clean(row, sanitized=sanitized) for row in analyses],
            "verification_tasks": [_clean(row, sanitized=sanitized) for row in tasks],
        }
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )
        return path
    if fmt == "jsonl":
        path = dest / "evidence.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            for row in evidence:
                handle.write(
                    json.dumps(_clean(row, sanitized=sanitized), ensure_ascii=False, default=str)
                    + "\n"
                )
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
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in evidence:
            clean = _clean(row, sanitized=sanitized)
            writer.writerow({key: clean.get(key, "") for key in fields})
    return path

