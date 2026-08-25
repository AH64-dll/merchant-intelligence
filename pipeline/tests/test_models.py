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
    f"{CODEX_PROVIDER}/gpt-5.6-sol",
    f"{CODEX_PROVIDER}/gpt-5.6-luna",
    "opencode-go/hy3",
    "openai/gpt-4o",
]


def test_parse_catalog_json_object():
    text = json.dumps(
        {
            GEMINI_PROVIDER: {"models": [{"id": "gemini-3.7-flash"}]},
            CODEX_PROVIDER: {"models": [{"id": "gpt-5.6-sol"}, {"id": "gpt-5.6-luna"}]},
        }
    )
    ids = parse_catalog(text)
    assert f"{GEMINI_PROVIDER}/gemini-3.7-flash" in ids
    assert f"{CODEX_PROVIDER}/gpt-5.6-sol" in ids


def test_gemini_stays_on_antigravity():
    resolved = resolve_role_model(
        "discovery", "gemini-3.7-flash", CATALOG, allow_fallback=False
    )
    assert resolved.startswith(GEMINI_PROVIDER + "/")
    assert "hy3" not in resolved
    assert "openai/" not in resolved or resolved.startswith(GEMINI_PROVIDER)


def test_gpt_stays_on_codex():
    sol = resolve_role_model("analyst", "gpt-5.6-sol", CATALOG)
    luna = resolve_role_model("verifier", "gpt-5.6-luna", CATALOG)
    assert sol.startswith(CODEX_PROVIDER + "/")
    assert luna.startswith(CODEX_PROVIDER + "/")
    assert "openai/gpt-4o" not in (sol, luna)


def test_wrong_provider_hint_fails():
    with pytest.raises(ModelResolutionError):
        resolve_role_model("discovery", "opencode-go/hy3", CATALOG)
    with pytest.raises(ModelResolutionError):
        resolve_role_model("analyst", "openai/gpt-4o", CATALOG)


def test_resolve_all_roles_pins():
    hints = {
        "discovery": "gemini-3.7-flash",
        "coordinator": "gemini-3.7-flash",
        "analyst": "gpt-5.6-sol",
        "verifier": "gpt-5.6-luna",
    }
    resolved = resolve_all_roles(hints, CATALOG)
    assert resolved["discovery"].startswith(GEMINI_PROVIDER)
    assert resolved["coordinator"].startswith(GEMINI_PROVIDER)
    assert resolved["analyst"].startswith(CODEX_PROVIDER)
    assert resolved["verifier"].startswith(CODEX_PROVIDER)


def test_shared_provider_routes_every_role_to_one_model():
    ox = "opencode-go/ox-alpha-free"
    resolved = resolve_all_roles(
        {role: ox for role in ("discovery", "coordinator", "analyst", "verifier")},
        [ox],
        gemini_provider=GEMINI_PROVIDER,
        gpt_provider=CODEX_PROVIDER,
        shared_provider="opencode-go",
    )
    assert resolved == {role: ox for role in ("discovery", "coordinator", "analyst", "verifier")}
    assert_provider_pins(
        resolved,
        gemini_provider=GEMINI_PROVIDER,
        gpt_provider=CODEX_PROVIDER,
        shared_provider="opencode-go",
    )


def test_example_config_pins_providers():
    root = Path(__file__).resolve().parents[1]
    cfg = load_config(root / "config.example.yaml")
    assert cfg.models.gemini_provider == GEMINI_PROVIDER
    assert cfg.models.gpt_provider == CODEX_PROVIDER
    assert cfg.models.discovery.startswith(GEMINI_PROVIDER)
    assert cfg.models.coordinator.startswith(GEMINI_PROVIDER)
    assert cfg.models.analyst.startswith(CODEX_PROVIDER)
    assert cfg.models.verifier.startswith(CODEX_PROVIDER)
