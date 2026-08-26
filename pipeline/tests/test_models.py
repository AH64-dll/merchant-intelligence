from pathlib import Path
import json

import pytest

from merchant_intel.config import load_config
from merchant_intel.omp.models import (
    CODEX_PROVIDER,
    GEMINI_PROVIDER,
    ModelResolutionError,
    parse_catalog,
    resolve_all_roles,
    resolve_role_model,
    assert_provider_pins,
)


CATALOG = [
    f"{GEMINI_PROVIDER}/gemini-3.7-flash",
    f"{CODEX_PROVIDER}/gpt-5.6-luna",
]


def test_parse_catalog_json_object():
    text = json.dumps(
        {
            GEMINI_PROVIDER: {"models": [{"id": "gemini-3.7-flash"}]},
            CODEX_PROVIDER: {"models": [{"id": "gpt-5.6-luna"}]},
        }
    )
    ids = parse_catalog(text)
    assert f"{GEMINI_PROVIDER}/gemini-3.7-flash" in ids
    assert f"{CODEX_PROVIDER}/gpt-5.6-luna" in ids


def test_gemini_stays_on_antigravity():
    resolved = resolve_role_model(
        "discovery", "gemini-3.7-flash", CATALOG, allow_fallback=False
    )
    assert resolved.startswith(GEMINI_PROVIDER + "/")
    assert "hy3" not in resolved
    assert "openai/" not in resolved or resolved.startswith(GEMINI_PROVIDER)


def test_fast_analyst_uses_gemini_and_luna_uses_codex():
    analyst = resolve_role_model("analyst", "gemini-3.7-flash", CATALOG)
    luna = resolve_role_model("verifier", "gpt-5.6-luna", CATALOG)
    assert analyst.startswith(GEMINI_PROVIDER + "/")
    assert luna.startswith(CODEX_PROVIDER + "/")
    assert analyst != luna


def test_wrong_provider_hint_fails():
    with pytest.raises(ModelResolutionError):
        resolve_role_model("discovery", "openai-codex/gpt-5.6-luna", CATALOG)
    with pytest.raises(ModelResolutionError):
        resolve_role_model("analyst", "openai-codex/gpt-5.6-luna", CATALOG)


def test_resolve_all_roles_pins():
    hints = {
        "discovery": "gemini-3.7-flash",
        "coordinator": "gemini-3.7-flash",
        "analyst": "gemini-3.7-flash",
        "verifier": "gpt-5.6-luna",
    }
    resolved = resolve_all_roles(hints, CATALOG)
    assert resolved["discovery"].startswith(GEMINI_PROVIDER)
    assert resolved["coordinator"].startswith(GEMINI_PROVIDER)
    assert resolved["analyst"].startswith(GEMINI_PROVIDER)
    assert resolved["verifier"].startswith(CODEX_PROVIDER)


def test_shared_provider_routes_every_role_to_one_model():
    gemini = f"{GEMINI_PROVIDER}/gemini-3.7-flash"
    resolved = resolve_all_roles(
        {role: gemini for role in ("discovery", "coordinator", "analyst", "verifier")},
        [gemini],
        gemini_provider=GEMINI_PROVIDER,
        gpt_provider=CODEX_PROVIDER,
        shared_provider=GEMINI_PROVIDER,
    )
    assert resolved == {role: gemini for role in ("discovery", "coordinator", "analyst", "verifier")}
    assert_provider_pins(
        resolved,
        gemini_provider=GEMINI_PROVIDER,
        gpt_provider=CODEX_PROVIDER,
        shared_provider=GEMINI_PROVIDER,
    )


def test_example_config_pins_providers():
    root = Path(__file__).resolve().parents[1]
    cfg = load_config(root / "config.example.yaml")
    assert cfg.models.discovery == f"{GEMINI_PROVIDER}/gemini-3.7-flash"
    assert cfg.models.coordinator == f"{GEMINI_PROVIDER}/gemini-3.7-flash"
    assert cfg.models.analyst == f"{GEMINI_PROVIDER}/gemini-3.7-flash"
    assert cfg.models.verifier == f"{CODEX_PROVIDER}/gpt-5.6-luna"
    assert cfg.concurrency.max_parallel_agents == 5
    assert cfg.concurrency.discovery_agents == 5
    assert cfg.concurrency.max_luna_agents == 5
    assert cfg.concurrency.luna_tasks_per_agent == 20


def test_disabled_fallback_does_not_substitute_a_nearby_model():
    with pytest.raises(ModelResolutionError):
        resolve_role_model(
            "analyst",
            "gemini-3.7-flash",
            [f"{GEMINI_PROVIDER}/gemini-3.7-flash-tiered"],
            allow_fallback=False,
        )
