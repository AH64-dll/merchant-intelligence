"""Load versioned prompt files with safe fallbacks for source checkouts."""

from __future__ import annotations

from pathlib import Path

_DIR = Path(__file__).resolve().parent / "prompts"

_FALLBACK = {
    "system.md": (
        "You are a public-source merchant-intelligence worker for Egypt. "
        "Do not bypass authentication, access controls, private groups, CAPTCHAs, "
        "or private messages. Do not impersonate users or collect unrelated personal data. "
        "Preserve URLs and uncertainty; never issue defamatory labels or a public trust score. "
        "Return only JSON matching the requested schema."
    ),
    "discovery.md": """OBJECTIVE\n{goal}\nCOUNTRY: {country}\nASSIGNMENT: {agent_id} {title}\nFOCUS: {focus}\nCITY: {city_bias}\nSEEDS:\n{search_seeds}\nEXCLUSIONS:\n{exclusions}\nCollect balanced public evidence and return only the discovery JSON schema. Every record needs a real source_url.""",
    "coordinator.md": """OBJECTIVE\n{goal}\nMETRICS:\n{metrics}\nSAMPLE:\n{merchant_sample}\nPREVIOUS:\n{previous_gaps}\nJudge dataset quality, deduplicate reposts, identify gaps, and return only the coordinator JSON schema.""",
    "sol.md": """OBJECTIVE\n{goal}\nPACKAGES:\n{packages}\nAnalyze exact merchant IDs, separate evidence confidence/reputation/risk/satisfaction, and return only Sol JSON.""",
    "sol_review.md": """OBJECTIVE\n{goal}\nPACKAGES:\n{packages}\nFINDINGS:\n{findings}\nReview Luna evidence and return only Sol JSON with unresolved tasks preserved.""",
    "luna.md": """OBJECTIVE\n{goal}\nAGENT: {agent_id}\nTASKS:\n{tasks}\nVerify only these narrow tasks using public sources and return only Luna JSON.""",
}


def load_prompt(name: str) -> str:
    path = _DIR / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    try:
        return _FALLBACK[name]
    except KeyError as exc:
        raise FileNotFoundError(f"unknown prompt {name!r}") from exc


def render(name: str, **kwargs: object) -> str:
    """Substitute only known placeholders; JSON braces are literal prompt text."""
    template = load_prompt(name)
    for key, value in kwargs.items():
        template = template.replace("{" + key + "}", str(value))
    return template

