# Merchant Intelligence Pipeline

A standalone Python 3.11+ controller for a persistent, provenance-preserving merchant research
pipeline. It launches **real OMP CLI sessions** and real parallel workers; it does not simulate
multiple roles inside one prompt.

## Provider routing

The routing is explicit and fail-closed:

| Pipeline role | Required provider | Default installed model |
|---|---|---|
| Discovery workers | Antigravity (`google-antigravity`) | `google-antigravity/gemini-3.7-flash` |
| Discovery coordinator | Antigravity (`google-antigravity`) | `google-antigravity/gemini-3.7-flash` |
| Fast Sol analysis | Antigravity (`google-antigravity`) | `google-antigravity/gemini-3.7-flash` |
| Luna verification and review | Codex (`openai-codex`) | `openai-codex/gpt-5.6-luna` |

At startup the adapter probes the installed OMP catalog with `omp models --json`, resolves these
exact model selectors, and fails closed if either selected model is unavailable or crosses
providers. Gemini output is always sent through Luna verification/review before it is treated as
confirmed.

## Installation

```bash
cd merchant_intelligence
python3.11 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
cp config.example.yaml config.yaml
```

The controller currently targets OMP `17.x` semantics (`omp -p --mode json --model ...`). It
probes flags rather than assuming them. OMP must be on `PATH`, and the Antigravity and Codex
providers must be authenticated in that OMP profile.

## Commands

Run these from this directory, or prefix with `PYTHONPATH=merchant_intelligence` from the
repository root:

```bash
python main.py verify                         # live CLI probe + exact model selectors
python main.py run --mock --smoke-test        # complete deterministic pipeline, no quota
python main.py run --smoke-test               # live 3-agent end-to-end smoke test
python main.py run                            # configured 5-agent Gemini/Luna pipeline
python main.py --resume                       # resume latest running/incomplete checkpoint
python main.py run --resume --run-id RUN_ID   # resume a specific run
python main.py status [--run-id RUN_ID]
python main.py metrics [--run-id RUN_ID]
python main.py export --format json            # sanitized nested export
python main.py export --format jsonl           # one provenance row per line
python main.py export --format csv             # evidence CSV with URLs
python main.py export --include-raw            # explicitly include internal raw fields
```

`--smoke` is accepted as an alias for `--smoke-test`. An incomplete run exits with code 2 and
remains resumable; a controller/provider error exits with code 1 after writing a checkpoint.

The live smoke overlay intentionally accepts the foundation gate and limits Sol to one
verification task so the real provider chain can be exercised quickly; this is not production
quality evidence. Production runs use `config.yaml` thresholds and never inherit that override.

## Pipeline

1. **Discovery (Gemini / Antigravity):** 5 partitioned assignments cover electronics, gaming,
   PC hardware, mobile/laptops, complaints, positive recommendations, official sources, and
   cross-platform identity. The selector stays balanced across all groups. Each record requires a
   public URL and structured confidence.
2. **Coordinator (Gemini / Antigravity):** measures local quality gates, duplicate/repost rate,
   independent source diversity, geography, category coverage, freshness, and balanced evidence.
   Gap queries target the next round; broad repetition is not automatic.
3. **Fast analysis (Gemini / Antigravity):** processes bounded merchant packages instead of dumping
   the whole database into one context. It creates merchant analyses and narrow verification
   tasks; Luna reviews these outputs.
4. **Verification and review (Luna / Codex):** runs no more than 5 concurrent agents, verifies
   Gemini's claims against public sources, retains unresolved findings, and performs the final
   review pass.
5. **Completion:** only a foundation that passes configured quality gates and has no actionable
   verification queue is marked `complete`. Diminishing returns, maximum rounds, failed gates,
   and unresolved claims produce an explicit `incomplete` state.

## Persistence and provenance

SQLite uses WAL mode and versioned schema migrations. It stores:

- merchants, aliases, identifiers, and conservative `merchant_links` conflicts;
- sources with canonical URLs;
- claims plus claim/evidence links;
- every raw evidence observation, including duplicate/repost rows;
- exact and content fingerprints, independent-source counts, publication/capture dates;
- Sol analyses, verification tasks, attempts, results, agent runs, usage, costs, and sessions;
- research gaps, per-round quality metrics, and durable pipeline checkpoints.

Raw OMP responses are written below `data/raw/`; normalized database records remain queryable for
future model re-analysis. Sanitized exports retain commercial source URLs but omit internal raw
JSON and quoted excerpts by default.

## Resume behavior

The controller checkpoints before a round, after each agent, at coordinator boundaries, after each
Sol batch, and after verification work. The current round status distinguishes an interrupted
agent swarm from a completed coordinator decision, so `--resume` does not silently skip unfinished
workers. In-progress verification tasks are returned to the queue on resume. Real OMP session IDs
returned by JSON events are persisted in checkpoints and `agent_runs`; the adapter can continue a
known session with the probed `--resume <session-id>` flag. It never fabricates `--fork` or
`--session-id` flags unsupported by OMP 17.

## Public-source compliance

Prompts prohibit login bypass, private-group scraping, CAPTCHA circumvention, impersonation,
private messages, and unrelated personal-data collection. A blocked source is recorded as
unavailable. Allegations stay allegations; the pipeline does not emit a public trust score or
automatically label a merchant a scammer.

## Testing

```bash
python -m pytest -q
python main.py run --mock --smoke-test
```

The mock client exercises scheduling, Pydantic validation, duplicate provenance, SQLite writes,
Sol task generation, Luna return flow, review, and checkpoint loading without using model quota.
Live verification and smoke tests require authenticated OMP providers and can use web tools; run
them only after the mock path passes.

