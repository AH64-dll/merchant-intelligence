"""Pull a JSON object out of messy agent text. Never invent fields."""

from __future__ import annotations

import json
import re
from typing import Any

FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


class JsonExtractError(ValueError):
    pass


def _strip_trailing_commas(text: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", text)


def _largest_json_span(text: str) -> str | None:
    start = None
    depth = 0
    in_str = False
    escape = False
    best = None
    for i, ch in enumerate(text):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch in "{[":
            if depth == 0:
                start = i
            depth += 1
        elif ch in "}]":
            if depth == 0:
                continue
            depth -= 1
            if depth == 0 and start is not None:
                best = text[start : i + 1]
    return best


def extract_json_object(text: str) -> Any:
    if not text or not text.strip():
        raise JsonExtractError("empty agent output")

    candidates: list[str] = []
    for match in FENCE_RE.finditer(text):
        candidates.append(match.group(1).strip())
    span = _largest_json_span(text)
    if span:
        candidates.append(span)
    stripped = text.strip()
    if stripped not in candidates:
        candidates.append(stripped)

    errors: list[str] = []
    for raw in candidates:
        for variant in (raw, _strip_trailing_commas(raw)):
            try:
                parsed = json.loads(variant)
            except json.JSONDecodeError as exc:
                errors.append(str(exc))
                continue
            if isinstance(parsed, (dict, list)):
                return parsed
            errors.append(f"JSON root is {type(parsed).__name__}, not object/array")
    raise JsonExtractError("; ".join(errors[-3:]) or "no JSON object found")


extract_json_object = extract_json_object
JsonExtractError = JsonExtractError
