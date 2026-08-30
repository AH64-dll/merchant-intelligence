"""One-shot: 8 Luna agents discover relevant Egyptian merchant Facebook groups.

READ-ONLY, public discovery only — agents do NOT use the Zen session; they
use omp web tools on public listings (Facebook public search pages, Google,
group directories). The orchestrator (this session) later checks each
proposed group URL against the real member session before adding it to
fb_group_registry.
"""

from __future__ import annotations

import asyncio
import json

from merchant_intel.omp.client import OmpClient, AgentRequest
from merchant_intel.config import load_config
from merchant_intel.database import Database

GOAL = (
    "Discover Facebook groups where Egyptian buyers discuss local merchants "
    "for a merchant-reputation dataset. Public listing search only; READ-ONLY."
)

SCOPES = [
    ("tech-computer-stores", "Egyptian computer & PC hardware stores (متاجر كمبيوتر وقطع غيار) — groups where buyers discuss Cairo/Alexandria computer shops, repairs, builds"),
    ("electronics-appliances", "Egyptian home appliance & electronics stores (أجهزة كهربائية) — buyer discussion groups for appliance purchases, warranty, repairs"),
    ("mobile-phone-shops", "Egyptian mobile phone shops (موبايلات) — buyer groups discussing phone purchases from local stores"),
    ("pharmacies-medical", "Egyptian pharmacy chains (صيدليات) — groups discussing pharmacy service quality"),
    ("consumer-protection-scam", "Egyptian consumer protection / scam reporting (حماية المستهلك / النصب) — groups where buyers report bad sellers"),
    ("local-markets-alex", "Local buy/sell market groups in Alexandria and Cairo (سوق سموحة، سوق الكمبيوتر) — where local shops get discussed"),
    ("gaming-consoles", "Egyptian gaming & console shops (بلايستيشن وألعاب) — buyer discussion groups"),
    ("general-shopping-reviews", "Egyptian shopping reviews / تجارب الشراء — groups where buyers review stores generally"),
]

PROMPT_TEMPLATE = """ROLE: Facebook group discovery researcher, GPT 5.6 Luna.

OBJECTIVE
{goal}

YOUR SCOPE
{scope_description}

TASK
Using omp's read/web tools on PUBLIC listings only (Facebook public search
pages that render without login, Google/Bing search, group-directory
sites), find 5-10 Facebook groups relevant to your scope. For each:
- group URL in the exact form https://www.facebook.com/groups/<slug>/ (or
  https://www.facebook.com/groups/<numeric-id>/ if that is the canonical URL)
- group name as listed
- approximate member count if visible
- language (Arabic/English/both)
- one-line relevance note: why buyer discussions about local merchants
  happen there

RULES
- READ-ONLY: do not log in, join, post, or interact with Facebook.
- Public listings only; if a page requires login, skip it and note that.
- Egyptian-market groups only (or clearly Egypt-focused).
- Never fabricate a group URL. Only report URLs you actually saw in search
  results or listings.
- Prefer active groups (recent posts) over dead ones when visible.

Return ONLY valid JSON:
{{
  "agent_id": "{agent_id}",
  "groups": [
    {{"url": "https://www.facebook.com/groups/<slug>/", "name": "...",
      "members_approx": null, "language": "ar", "relevance": "...",
      "publicly_listed": true}}
  ],
  "notes": "search method summary"
}}
"""


async def main() -> int:
    cfg = load_config("config.yaml")
    client = OmpClient(cfg)
    db = Database(cfg.database_path)
    await client.probe()
    await client.resolve_models()
    model = client.model_for_role("verifier")  # openai-codex/gpt-5.6-luna
    print(f"[groupdisco] model: {model}", flush=True)

    async def one(i: int, scope_id: str, desc: str) -> dict | None:
        async with asyncio.Semaphore(4):
            agent_id = f"groupdisco-l-{i:02d}"
            prompt = PROMPT_TEMPLATE.format(
                goal=GOAL, scope_description=desc, agent_id=agent_id
            )
            print(f"[groupdisco] launching {agent_id} ({scope_id})", flush=True)
            try:
                result = await client.run(
                    AgentRequest(
                        prompt=prompt,
                        model=model,
                        name=agent_id,
                        role="verifier",
                        goal=GOAL,
                        workspace_id=f"groupdisco-{agent_id}",
                        timeout_sec=cfg.omp.analysis_timeout_sec,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[groupdisco] {agent_id} LAUNCH FAILED: {exc}", flush=True)
                return None
            if not result.ok or result.payload is None:
                print(f"[groupdisco] {agent_id} FAILED: {result.error}", flush=True)
                return None
            payload = result.payload if isinstance(result.payload, dict) else {"groups": []}
            groups = payload.get("groups") or []
            print(f"[groupdisco] {agent_id} done: {len(groups)} groups", flush=True)
            return {"agent_id": agent_id, "scope": scope_id, "groups": groups}

    results = await asyncio.gather(
        *[one(i, sid, desc) for i, (sid, desc) in enumerate(SCOPES, start=1)]
    )
    ok = [r for r in results if r]
    findings = {
        "round": "groupdisco-1",
        "agents": ok,
        "total_groups": sum(len(r["groups"]) for r in ok),
    }
    with open("/tmp/groupdisco_proposals.json", "w", encoding="utf-8") as f:
        json.dump(findings, f, ensure_ascii=False, indent=2)
    print(f"[groupdisco] saved {findings['total_groups']} proposals to /tmp/groupdisco_proposals.json", flush=True)
    await client.close()
    return 0 if len(ok) >= 6 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
