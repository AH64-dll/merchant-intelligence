"""Parse OMP `--mode json` JSONL into assistant text, usage, and session id."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    cost: float = 0.0
    model: str = ""

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cached_tokens += other.cached_tokens
        self.cost += other.cost
        if other.model:
            self.model = other.model


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _as_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _usage_from_mapping(data: dict[str, Any]) -> Usage:
    tokens = data.get("tokens") if isinstance(data.get("tokens"), dict) else {}
    return Usage(
        input_tokens=_as_int(
            data.get("input")
            or data.get("input_tokens")
            or data.get("prompt_tokens")
            or tokens.get("input")
            or tokens.get("prompt")
        ),
        output_tokens=_as_int(
            data.get("output")
            or data.get("output_tokens")
            or data.get("completion_tokens")
            or tokens.get("output")
            or tokens.get("completion")
        ),
        cached_tokens=_as_int(
            data.get("cacheRead")
            or data.get("cache_read")
            or data.get("cached_tokens")
            or tokens.get("cached")
            or tokens.get("cacheRead")
        ),
        cost=_as_float(data.get("cost") or data.get("total_cost") or data.get("totalCost")),
        model=str(data.get("model") or data.get("model_id") or data.get("modelId") or ""),
    )


def _text_from_message(message: Any) -> str:
    if message is None:
        return ""
    if isinstance(message, str):
        return message
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(message.get("text"), str):
        return message["text"]
    parts: list[str] = []
    if isinstance(content, list):
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if item.get("type") in {"text", "output_text", "input_text"} and item.get("text"):
                    parts.append(str(item["text"]))
                elif "text" in item:
                    parts.append(str(item["text"]))
    return "".join(parts)


@dataclass
class ParsedOmpRun:
    session_id: str | None = None
    texts: list[str] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    events: list[dict[str, Any]] = field(default_factory=list)
    parse_errors: int = 0

    @property
    def assistant_text(self) -> str:
        return "\n\n".join(t for t in self.texts if t).strip()


def _capture_message(parsed: ParsedOmpRun, message: Any) -> None:
    if isinstance(message, dict) and message.get("role") not in {None, "assistant"}:
        return
    text = _text_from_message(message)
    if text:
        parsed.texts.append(text)
    if isinstance(message, dict) and isinstance(message.get("usage"), dict):
        parsed.usage.add(_usage_from_mapping(message["usage"]))


def parse_jsonl(stream: str) -> ParsedOmpRun:
    parsed = ParsedOmpRun()
    for raw_line in stream.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            parsed.parse_errors += 1
            continue
        if not isinstance(event, dict):
            continue
        parsed.events.append(event)
        etype = str(event.get("type") or event.get("event") or "").lower()
        candidate_session = (
            event.get("session_id")
            or event.get("sessionId")
            or (event.get("id") if etype in {"session", "session_start", "session_created"} else None)
        )
        if candidate_session:
            parsed.session_id = str(candidate_session)
        for key in ("usage", "usage_stats", "usageStats"):
            if isinstance(event.get(key), dict):
                parsed.usage.add(_usage_from_mapping(event[key]))
        if etype in {"message_end", "turn_end", "message", "assistant", "output"}:
            _capture_message(parsed, event.get("message") or event.get("data") or event)
        elif etype in {"message_update", "text_delta"}:
            if isinstance(event.get("usage"), dict):
                parsed.usage.add(_usage_from_mapping(event["usage"]))
            # Deltas are only used when no final message event is present.
            delta = event.get("delta") or event.get("text")
            if isinstance(delta, str):
                parsed.texts.append(delta)
        elif etype == "agent_end":
            messages = event.get("messages") or event.get("data", {}).get("messages", [])
            for message in messages if isinstance(messages, list) else []:
                _capture_message(parsed, message)
    return parsed

