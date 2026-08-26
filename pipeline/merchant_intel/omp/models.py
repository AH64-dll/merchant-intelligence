"""Resolve OMP model IDs against the installed catalog.

Legacy configurations may pin Gemini and GPT role families to separate
providers.  A shared provider is supported explicitly for runs that
intentionally use one model route for every role.
"""

from dataclasses import dataclass
import json

GEMINI_PROVIDER = "google-antigravity"
CODEX_PROVIDER = "openai-codex"

ROLE_FAMILY = {
    "discovery": "gemini",
    "coordinator": "gemini",
    "analyst": "gemini",
    "verifier": "gpt",
}

DEFAULT_HINTS = {
    "discovery": f"{GEMINI_PROVIDER}/gemini-3.7-flash",
    "coordinator": f"{GEMINI_PROVIDER}/gemini-3.7-flash",
    "analyst": f"{GEMINI_PROVIDER}/gemini-3.7-flash",
    "verifier": f"{CODEX_PROVIDER}/gpt-5.6-luna",
}


class ModelResolutionError(RuntimeError):
    pass

@dataclass(frozen=True)
class ModelRef:
    provider: str
    model: str
    thinking: str | None = None

    @property
    def omp_id(self) -> str:
        base = f"{self.provider}/{self.model}"
        return f"{base}:{self.thinking}" if self.thinking else base

    @property
    def bare_id(self) -> str:
        return f"{self.provider}/{self.model}"


def family_for_role(role: str) -> str:
    try:
        return ROLE_FAMILY[role]
    except KeyError as exc:
        raise ModelResolutionError(f"unknown model role {role!r}") from exc


def parse_model_id(value: str) -> ModelRef:
    raw = (value or "").strip()
    if not raw:
        raise ModelResolutionError("empty model id")
    thinking = None
    rest = raw.split("/", 1)[-1]
    if ":" in rest:
        raw, thinking = raw.rsplit(":", 1)
        thinking = thinking.strip() or None
    if "/" not in raw:
        raise ModelResolutionError(
            f"model id {value!r} is missing a provider prefix "
            f"(expected {GEMINI_PROVIDER}/… or {CODEX_PROVIDER}/…)"
        )
    provider, model = raw.split("/", 1)
    provider, model = provider.strip(), model.strip()
    if not provider or not model:
        raise ModelResolutionError(f"malformed model id {value!r}")
    return ModelRef(provider=provider, model=model, thinking=thinking)


def required_provider(
    role: str,
    *,
    gemini_provider: str,
    gpt_provider: str,
    shared_provider: str | None = None,
    hint_provider: str | None = None,
) -> str:
    if role == "fallback" and hint_provider:
        return hint_provider
    if shared_provider:
        return shared_provider
    return gemini_provider if family_for_role(role) == "gemini" else gpt_provider
def resolve_role_model(
    role: str,
    hint: str,
    catalog: list[str],
    *,
    gemini_provider: str = GEMINI_PROVIDER,
    gpt_provider: str = CODEX_PROVIDER,
    shared_provider: str | None = None,
    allow_fallback: bool = False,
) -> str:
    hint_provider = parse_model_id(hint).provider if "/" in (hint or "") else None
    required = required_provider(
        role,
        gemini_provider=gemini_provider,
        gpt_provider=gpt_provider,
        shared_provider=shared_provider,
        hint_provider=hint_provider,
    )
    hint = (hint or DEFAULT_HINTS.get(role, "")).strip()
    if not hint:
        raise ModelResolutionError(f"no model hint for role {role!r}")

    if "/" not in hint:
        hinted = ModelRef(provider=required, model=hint.split(":")[0])
    else:
        hinted = parse_model_id(hint)

    if not provider_allowed(hinted.provider, required):
        raise ModelResolutionError(
            f"role {role!r} must use provider {required!r}; "
            f"hint {hint!r} is provider {hinted.provider!r}. "
            "Use shared_provider when intentionally routing every role together."
        )

    scoped = [item for item in catalog if _in_provider(item, required)]
    if not catalog:
        return hinted.omp_id
    if not scoped:
        raise ModelResolutionError(
            f"no {required} models in the OMP catalog for role {role!r}. "
            f"catalog sample: {catalog[:12]}"
        )

    by_lower = {item.lower(): item for item in scoped}
    if hinted.omp_id.lower() in by_lower:
        return by_lower[hinted.omp_id.lower()]
    if hinted.bare_id.lower() in by_lower:
        return by_lower[hinted.bare_id.lower()]

    name = hinted.model.lower()
    scored: list[tuple[int, int, str]] = []
    for item in scoped:
        hay = item.lower()
        if hay.endswith("/" + name) or hay.endswith("/" + name.split(":")[0]):
            scored.append((3, -len(item), item))
        elif name in hay:
            scored.append((1, -len(item), item))
    if scored and allow_fallback:
        scored.sort(reverse=True)
        return scored[0][2]

    if allow_fallback:
        preferred = [item for item in scoped if name.split("-")[0] in item.lower()]
        return sorted(preferred or scoped, key=len)[0]

    raise ModelResolutionError(
        f"role {role!r}: no catalog model matches hint {hint!r} (scoped sample: {scoped[:12]})"
    )


def assert_provider_pins(
    resolved: dict[str, str],
    *,
    gemini_provider: str = GEMINI_PROVIDER,
    gpt_provider: str = CODEX_PROVIDER,
    shared_provider: str | None = None,
) -> None:
    if shared_provider:
        for role, model in resolved.items():
            if role == "fallback":
                continue
            if not _in_provider(model, shared_provider):
                raise ModelResolutionError(
                    f"{role} must be {shared_provider}/… in shared-provider mode, got {model}"
                )
        return
    for role, model in resolved.items():
        if role == "fallback":
            continue
        required = gemini_provider if family_for_role(role) == "gemini" else gpt_provider
        if not _in_provider(model, required):
            raise ModelResolutionError(
                f"{role} must be {required}/…, got {model}"
            )

def resolve_all_roles(
    hints: dict[str, str],
    catalog: list[str],
    *,
    gemini_provider: str = GEMINI_PROVIDER,
    gpt_provider: str = CODEX_PROVIDER,
    shared_provider: str | None = None,
    allow_fallback: bool = False,
) -> dict[str, str]:
    roles = list(ROLE_FAMILY)
    if "fallback" in hints and hints["fallback"]:
        roles.append("fallback")
    return {
        role: resolve_role_model(
            role,
            hints.get(role, DEFAULT_HINTS.get(role, "")),
            catalog,
            gemini_provider=gemini_provider,
            gpt_provider=gpt_provider,
            shared_provider=shared_provider,
            allow_fallback=allow_fallback,
        )
        for role in roles
    }


def provider_allowed(provider: str, required: str) -> bool:
    left = provider.lower().replace("_", "-")
    right = required.lower().replace("_", "-")
    return left == right or left.endswith("-" + right) or right.endswith("-" + left)


def parse_catalog(text: str) -> list[str]:
    if not text or not text.strip():
        return []
    blob = text.strip()
    ids: list[str] = []
    try:
        data = json.loads(blob)
    except json.JSONDecodeError:
        data = None
    if isinstance(data, list):
        for item in data:
            ids.extend(_ids_from_item(item))
    elif isinstance(data, dict):
        for key in ("models", "items", "data"):
            value = data.get(key)
            if isinstance(value, list):
                for item in value:
                    ids.extend(_ids_from_item(item))
        if not ids:
            for provider, body in data.items():
                if isinstance(body, dict):
                    models = body.get("models") or body.get("items") or []
                    if isinstance(models, list):
                        for item in models:
                            ids.extend(_ids_from_item(item, default_provider=str(provider)))
                elif isinstance(body, list):
                    for item in body:
                        ids.extend(_ids_from_item(item, default_provider=str(provider)))
    if ids:
        return _dedupe(ids)
    for line in blob.splitlines():
        line = line.strip().strip("-*• ")
        if not line or line.lower().startswith("available"):
            continue
        token = line.split()[0].rstrip(",;")
        if "/" in token:
            ids.append(token)
    return _dedupe(ids)


def _ids_from_item(item: object, default_provider: str = "") -> list[str]:
    if isinstance(item, str):
        return [item]
    if not isinstance(item, dict):
        return []
    provider = str(
        item.get("provider")
        or item.get("providerID")
        or item.get("providerId")
        or default_provider
        or ""
    )
    model = str(item.get("id") or item.get("model") or item.get("modelID") or "")
    full = str(item.get("fullID") or item.get("ref") or "")
    out: list[str] = []
    if full:
        out.append(full)
    if provider and model and "/" not in model:
        out.append(f"{provider}/{model}")
    elif model:
        out.append(model)
    return out


def _dedupe(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in ids:
        key = item.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _in_provider(catalog_id: str, provider: str) -> bool:
    try:
        ref = parse_model_id(catalog_id)
    except ModelResolutionError:
        return False
    return provider_allowed(ref.provider, provider)
