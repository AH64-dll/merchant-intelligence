"""Discover the installed OMP CLI before constructing subprocess arguments."""

from __future__ import annotations

import asyncio
import re
import shutil
from dataclasses import dataclass
from pathlib import Path


LONG_FLAG_RE = re.compile(r"(--[a-z0-9-]+)", re.IGNORECASE)
SHORT_FLAG_RE = re.compile(r"(?<![A-Za-z0-9])-([a-z])(?:[, =]|\b)", re.IGNORECASE)


@dataclass(frozen=True)
class OmpCapabilities:
    binary: str
    version: str
    help_text: str
    flags: frozenset[str]
    short_flags: frozenset[str]
    supports_print: bool
    supports_json_mode: bool
    supports_resume: bool
    supports_continue: bool
    supports_session_dir: bool
    supports_no_session: bool
    supports_thinking: bool
    supports_no_tools: bool
    supports_tools: bool
    supports_exclude_tools: bool
    supports_auto_approve: bool
    supports_no_pty: bool
    supports_no_extensions: bool
    supports_no_skills: bool
    supports_no_rules: bool
    supports_max_time: bool
    models_invocation: tuple[str, ...]
    raw_model_listing: str = ""
    # Compatibility fields retained for older mock clients. OMP 17 does not
    # expose these flags, so the live probe reports False for them.
    supports_session: bool = False
    supports_session_id: bool = False
    supports_fork: bool = False
    supports_approve: bool = False
    supports_name: bool = False

    def has(self, *names: str) -> bool:
        return any(name in self.flags or name in self.short_flags for name in names)


def _parse_flags(help_text: str) -> tuple[frozenset[str], frozenset[str]]:
    lowered = help_text.lower()
    return frozenset(LONG_FLAG_RE.findall(lowered)), frozenset(SHORT_FLAG_RE.findall(lowered))


def _pick_models_invocation(help_text: str, flags: frozenset[str]) -> tuple[str, ...]:
    lowered = help_text.lower()
    if re.search(r"\bmodels\b", lowered) and "--json" in flags:
        return ("models", "--json")
    if "--list-models" in flags:
        return ("--list-models",)
    if re.search(r"\bmodels\b", lowered):
        return ("models",)
    return ()


async def _run_text(
    binary: str, args: list[str], timeout: float = 20.0
) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        binary,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise
    return (
        proc.returncode or 0,
        stdout.decode("utf-8", "replace"),
        stderr.decode("utf-8", "replace"),
    )


async def probe_omp(binary: str = "omp") -> OmpCapabilities:
    resolved = shutil.which(binary) or binary
    if not Path(resolved).exists() and shutil.which(binary) is None:
        raise FileNotFoundError(
            f"OMP binary {binary!r} not found on PATH. Install OMP or set omp.binary."
        )

    version = ""
    for args in (["--version"], ["-v"], ["version"]):
        try:
            code, out, err = await _run_text(resolved, list(args))
        except (FileNotFoundError, TimeoutError, OSError):
            continue
        text = (out or err).strip()
        if code == 0 and text:
            version = text.splitlines()[0]
            break

    help_chunks: list[str] = []
    for args in (["--help"], ["-h"], ["help"], ["models", "--help"]):
        try:
            _code, out, err = await _run_text(resolved, list(args))
        except (FileNotFoundError, TimeoutError, OSError):
            continue
        if out:
            help_chunks.append(out)
        if err:
            help_chunks.append(err)
    help_text = "\n".join(help_chunks)
    flags, short_flags = _parse_flags(help_text)
    models_invocation = _pick_models_invocation(help_text, flags)

    listing = ""
    if models_invocation:
        try:
            _code, out, err = await _run_text(
                resolved, list(models_invocation), timeout=40
            )
            listing = out or err
        except (TimeoutError, OSError):
            listing = ""

    return OmpCapabilities(
        binary=resolved,
        version=version,
        help_text=help_text,
        flags=flags,
        short_flags=short_flags,
        supports_print="--print" in flags or "p" in short_flags,
        supports_json_mode="--mode" in flags and "json" in help_text.lower(),
        supports_resume="--resume" in flags or "r" in short_flags,
        supports_continue="--continue" in flags or "c" in short_flags,
        supports_session_dir="--session-dir" in flags,
        supports_no_session="--no-session" in flags,
        supports_thinking="--thinking" in flags,
        supports_no_tools="--no-tools" in flags,
        supports_tools="--tools" in flags,
        supports_exclude_tools="--exclude-tools" in flags,
        supports_auto_approve="--auto-approve" in flags,
        supports_no_pty="--no-pty" in flags,
        supports_no_extensions="--no-extensions" in flags,
        supports_no_skills="--no-skills" in flags,
        supports_no_rules="--no-rules" in flags,
        supports_max_time="--max-time" in flags,
        models_invocation=models_invocation,
        raw_model_listing=listing,
    )

