"""Async adapter around the installed OMP CLI.

OMP does not expose a stable Python SDK for this workflow.  The adapter probes
its CLI first, only emits flags reported by that probe, and persists the real
OMP session id returned by JSON events.  Gemini roles are resolved through
Antigravity and GPT roles through Codex; provider hopping is forbidden.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import signal
import time
import uuid
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

from merchant_intel.config import AppConfig, OmpConfig
from merchant_intel.jsonutil import JsonExtractError, extract_json_object
from merchant_intel.omp.events import Usage, parse_jsonl
from merchant_intel.omp.models import (
    ModelResolutionError,
    assert_provider_pins,
    parse_catalog,
    resolve_all_roles,
)
from merchant_intel.omp.probe import OmpCapabilities, probe_omp

log = logging.getLogger("merchant_intel.omp")
RATE_LIMIT_MARKERS = (
    "rate limit",
    "429",
    "freeusagelimiterror",
    "gousagelimiterror",
    "overloaded",
    "resource_exhausted",
    "too many requests",
    "quota",
    "usage limit",
    "usage_limit",
)


def _event_rate_limited(events: list[dict[str, Any]]) -> bool:
    """Detect provider throttling from OMP error events, not assistant prose."""
    for event in events:
        blob = str(event).lower()
        if (
            ("errorstatus" in blob and "429" in blob)
            or ("status_code" in blob and "429" in blob)
            or ("retryinfo" in blob and "retrydelay" in blob)
        ):
            return True
    return False


_SAFE_COMPONENT = re.compile(r"[^A-Za-z0-9_.-]+")


class OmpError(RuntimeError):
    pass


class OmpTimeout(OmpError):
    pass


@dataclass
class AgentRequest:
    prompt: str
    model: str
    name: str
    role: str
    goal: str = ""
    # This is the real OMP session id returned by a prior JSON run. It is not
    # invented locally. Set resume=True to continue it.
    session_id: str | None = None
    resume: bool = False
    continue_session: bool = False
    # Kept for compatibility with callers that used the pre-v17 probe. The
    # live v17 CLI has no --fork flag, so a fork request fails closed.
    fork_from: str | None = None
    persist: bool = True
    timeout_sec: int | None = None
    workspace_id: str | None = None
    extra_env: dict[str, str] = field(default_factory=dict)


@dataclass
class AgentResult:
    ok: bool
    session_id: str | None
    model: str
    text: str
    payload: Any | None
    usage: Usage
    argv: list[str]
    stdout: str
    stderr: str
    returncode: int
    error: str | None = None
    attempts: int = 1
    duration_ms: int = 0


class OmpTransport(Protocol):
    resolved_models: dict[str, str]

    async def probe(self) -> OmpCapabilities: ...
    async def list_models(self) -> list[str]: ...
    async def resolve_models(self) -> dict[str, str]: ...
    def model_for_role(self, role: str) -> str: ...
    async def run(self, request: AgentRequest) -> AgentResult: ...
    async def kill(self, session_id: str) -> None: ...


def _safe_component(value: str, fallback: str = "session") -> str:
    value = _SAFE_COMPONENT.sub("-", value or "").strip("-.")
    return value[:120] or fallback


def _looks_rate_limited(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in RATE_LIMIT_MARKERS)


class OmpClient:
    def __init__(self, cfg: AppConfig, caps: OmpCapabilities | None = None) -> None:
        self.cfg = cfg
        self.omp: OmpConfig = cfg.omp
        self.caps = caps
        self.resolved_models: dict[str, str] = {}
        self._procs: dict[str, asyncio.subprocess.Process] = {}

    async def probe(self) -> OmpCapabilities:
        if self.caps is None:
            self.caps = await probe_omp(self.omp.binary)
        return self.caps

    async def list_models(self) -> list[str]:
        caps = await self.probe()
        if caps.raw_model_listing:
            parsed = parse_catalog(caps.raw_model_listing)
            if parsed:
                return parsed
        if not caps.models_invocation:
            return []
        proc = await asyncio.create_subprocess_exec(
            caps.binary,
            *caps.models_invocation,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        text = stdout.decode("utf-8", "replace") or stderr.decode("utf-8", "replace")
        return parse_catalog(text)

    async def resolve_models(self) -> dict[str, str]:
        if self.resolved_models:
            return self.resolved_models
        catalog = await self.list_models()
        if self.omp.require_catalog and not catalog:
            raise OmpError(
                "OMP returned no model catalog; refusing to run with unverified model IDs. "
                "Check `omp models --json` and authentication/network access."
            )
        hints = {
            "discovery": self.cfg.models.discovery,
            "coordinator": self.cfg.models.coordinator,
            "analyst": self.cfg.models.analyst,
            "verifier": self.cfg.models.verifier,
        }
        if getattr(self.cfg.models, "fallback", None):
            hints["fallback"] = self.cfg.models.fallback
        try:
            resolved = resolve_all_roles(
                hints,
                catalog,
                gemini_provider=self.cfg.models.gemini_provider,
                gpt_provider=self.cfg.models.gpt_provider,
                shared_provider=getattr(self.cfg.models, "shared_provider", None),
                allow_fallback=self.cfg.models.allow_fallback,
            )
            assert_provider_pins(
                resolved,
                gemini_provider=self.cfg.models.gemini_provider,
                gpt_provider=self.cfg.models.gpt_provider,
                shared_provider=getattr(self.cfg.models, "shared_provider", None),
            )
        except ModelResolutionError as exc:
            raise OmpError(str(exc)) from exc
        self.resolved_models = resolved
        log.info(
            "models: discovery=%s coordinator=%s analyst=%s verifier=%s",
            resolved["discovery"],
            resolved["coordinator"],
            resolved["analyst"],
            resolved["verifier"],
        )
        return resolved

    def model_for_role(self, role: str) -> str:
        if role not in self.resolved_models:
            raise OmpError(f"models not resolved; call resolve_models() first ({role})")
        return self.resolved_models[role]

    def build_argv(self, request: AgentRequest, caps: OmpCapabilities) -> list[str]:
        if request.fork_from and not caps.supports_fork:
            raise OmpError("this OMP CLI has no --fork support; refusing to fake a fork")
        if request.resume and not request.session_id:
            raise OmpError("resume requested without a real OMP session id")
        if request.resume and not caps.supports_resume:
            raise OmpError("this OMP CLI has no --resume support")
        if request.continue_session and not caps.supports_continue:
            raise OmpError("this OMP CLI has no --continue support")

        argv = [caps.binary]
        if caps.supports_print:
            argv.append("-p")
        if self.omp.json_mode and caps.supports_json_mode:
            argv.extend(["--mode", "json"])
        if request.model:
            argv.extend(["--model", request.model])
        if self.omp.thinking and caps.supports_thinking:
            argv.extend(["--thinking", self.omp.thinking])
        if self.omp.approve and caps.supports_auto_approve:
            argv.append("--auto-approve")
        if self.omp.no_tools and caps.supports_no_tools:
            argv.append("--no-tools")
        elif self.omp.exclude_tools and caps.supports_exclude_tools:
            argv.extend(["--exclude-tools", ",".join(self.omp.exclude_tools)])
        if self.omp.no_pty and caps.supports_no_pty:
            argv.append("--no-pty")
        if self.omp.no_extensions and caps.supports_no_extensions:
            argv.append("--no-extensions")
        if self.omp.no_skills and caps.supports_no_skills:
            argv.append("--no-skills")
        if self.omp.no_rules and caps.supports_no_rules:
            argv.append("--no-rules")

        if request.persist and self.omp.persist_sessions:
            role_dir = self.cfg.resolve(self.omp.session_root) / _safe_component(request.role)
            if caps.supports_session_dir:
                argv.extend(["--session-dir", str(role_dir)])
            if request.resume:
                argv.extend(["--resume", request.session_id or ""])
            elif request.continue_session:
                argv.append("--continue")
        elif caps.supports_no_session:
            argv.append("--no-session")

        timeout = request.timeout_sec or self.omp.timeout_sec
        if caps.supports_max_time and timeout > 0:
            argv.extend(["--max-time", str(timeout)])
        argv.append(self._compose_prompt(request))
        return argv

    def _compose_prompt(self, request: AgentRequest) -> str:
        parts: list[str] = []
        if self.omp.use_goal_slash and request.goal:
            parts.append(f"/goal set {request.goal}")
        parts.append(request.prompt)
        return "\n\n".join(parts)

    async def run(self, request: AgentRequest) -> AgentResult:
        caps = await self.probe()
        workspace_id = request.workspace_id or request.name or str(uuid.uuid4())
        req = replace(request, workspace_id=workspace_id)
        timeout = req.timeout_sec or self.omp.timeout_sec
        started = time.monotonic()
        result = AgentResult(
            ok=False,
            session_id=req.session_id,
            model=req.model,
            text="",
            payload=None,
            usage=Usage(model=req.model),
            argv=[],
            stdout="",
            stderr="",
            returncode=1,
            error="not started",
        )

        for attempt in range(1, self.omp.max_retries + 1):
            try:
                result = await self._once(req, caps, timeout)
            except OmpError as exc:
                result = AgentResult(
                    ok=False,
                    session_id=req.session_id,
                    model=req.model,
                    text="",
                    payload=None,
                    usage=Usage(model=req.model),
                    argv=[],
                    stdout="",
                    stderr="",
                    returncode=1,
                    error=str(exc),
                )
            result.attempts = attempt
            result.duration_ms = int((time.monotonic() - started) * 1000)
            if result.ok and result.payload is not None:
                return result

            blob = result.stderr + result.stdout + (result.error or "")
            retry_delay = min(
                self.omp.retry_max_sec,
                self.omp.retry_base_sec * (2 ** (attempt - 1)),
            )
            if _looks_rate_limited(blob):
                fallback_model = self.resolved_models.get("fallback")
                next_model = fallback_model if (fallback_model and req.model != fallback_model) else req.model
                if next_model != req.model:
                    log.info("falling back to %s for %s after rate limit", next_model, req.name)
                req = replace(req, model=next_model, session_id=None, resume=False, continue_session=False)
                if attempt < self.omp.max_retries:
                    await asyncio.sleep(retry_delay)
                continue

            # A clean process with malformed JSON can be repaired in the same
            # real OMP session. Provider/process failures start a fresh attempt.
            if result.payload is None and result.session_id and result.returncode == 0:
                req = replace(
                    req,
                    session_id=result.session_id,
                    resume=True,
                    prompt=(
                        req.prompt
                        + "\n\nYour previous reply was not valid JSON. "
                        "Reply with ONLY the JSON object matching the requested schema. "
                        "Do not include markdown or commentary."
                    ),
                )
            else:
                fallback_model = self.resolved_models.get("fallback")
                next_model = fallback_model if (fallback_model and req.model != fallback_model and attempt >= 2) else req.model
                if next_model != req.model:
                    log.info("switching to fallback model %s for %s", next_model, req.name)
                req = replace(req, model=next_model, session_id=None, resume=False, continue_session=False)
            if attempt < self.omp.max_retries:
                await asyncio.sleep(retry_delay)

        return result

    async def _once(
        self, request: AgentRequest, caps: OmpCapabilities, timeout: int
    ) -> AgentResult:
        argv = self.build_argv(request, caps)
        workspace = self.cfg.resolve(self.omp.workspace_root) / _safe_component(
            request.workspace_id or request.name
        )
        workspace.mkdir(parents=True, exist_ok=True)
        role_dir = self.cfg.resolve(self.omp.session_root) / _safe_component(request.role)
        role_dir.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update(request.extra_env)
        log.info("launch %s model=%s session=%s", request.name, request.model, request.session_id)
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(workspace),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        process_key = request.session_id or request.workspace_id or request.name
        self._procs[process_key] = proc
        try:
            try:
                stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout + 10)
            except TimeoutError:
                await self._terminate(proc)
                return AgentResult(
                    ok=False,
                    session_id=request.session_id,
                    model=request.model,
                    text="",
                    payload=None,
                    usage=Usage(model=request.model),
                    argv=argv,
                    stdout="",
                    stderr="",
                    returncode=-signal.SIGKILL,
                    error=f"timeout after {timeout}s",
                )
        finally:
            self._procs.pop(process_key, None)
        stdout = stdout_b.decode("utf-8", "replace")
        stderr = stderr_b.decode("utf-8", "replace")
        parsed = parse_jsonl(stdout)
        event_stream = bool(parsed.events)
        text = parsed.assistant_text
        if not text and not event_stream:
            text = stdout.strip()
        payload: Any | None = None
        error: str | None = None
        returncode = proc.returncode or 0
        rate_limited = (
            _looks_rate_limited(stderr)
            or _event_rate_limited(parsed.events)
            or (not event_stream and _looks_rate_limited(stdout))
        )
        if returncode != 0:
            error = f"omp exited {returncode}: {stderr[-1200:]}"
        elif not text:
            error = "omp emitted no assistant message"
        else:
            try:
                payload = extract_json_object(text)
            except JsonExtractError as exc:
                error = f"json extract failed: {exc}"
        if isinstance(payload, dict) and payload.get("type") in {
            "session", "agent_start", "turn_start", "agent_end", "error"
        }:
            payload = None
            error = error or "omp emitted an event envelope instead of assistant JSON"
        if parsed.parse_errors and not payload:
            error = error or f"ignored {parsed.parse_errors} non-JSON output lines"
        if rate_limited:
            error = "provider rate limit"
        usage = parsed.usage
        if not usage.model:
            usage.model = request.model
        return AgentResult(
            ok=payload is not None and returncode == 0 and not rate_limited,
            session_id=parsed.session_id or request.session_id,
            model=usage.model or request.model,
            text=text,
            payload=payload,
            usage=usage,
            argv=argv,
            stdout=stdout,
            stderr=stderr,
            returncode=returncode,
            error=error,
        )

    async def kill(self, session_id: str) -> None:
        proc = self._procs.get(session_id)
        if proc:
            await self._terminate(proc)

    async def close(self) -> None:
        processes = list(self._procs.values())
        for proc in processes:
            await self._terminate(proc)

    async def _terminate(self, proc: asyncio.subprocess.Process) -> None:
        if proc.returncode is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=self.omp.kill_grace_sec)
        except TimeoutError:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                proc.kill()
            await proc.wait()
