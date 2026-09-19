# AI_TOOL_LAB — genuine experiments (F-026)

Historical experiment record, retained without rerunning or altering its measurements. The original record attributes execution to `scripts/run-lab-experiments.mjs` and stores evidence in [governance-data/experiments.json](governance-data/experiments.json). Database seed/display paths are `tool_experiments` and `/governance/tool-lab`; the current database state was not checked.

These small synthetic business-task experiments are not a current provider benchmark, proof of production suitability, or real-school outcome. The measurements below belong to their original runs. Current routing/prompt ownership is documented in [AI_DESIGN](AI_DESIGN.md); agent behavior evaluation is separate in [TESTING](TESTING.md).

## Experiment A — head-to-head: gemini-3.5-flash vs gemini-3.5-flash-lite

**Business task:** Admissions (F-004) — qualify a lead into
`{score, category, intent, course, timeline, summary, recommended_action}` JSON.
**Protocol:** 5 runs each, 3 rotating synthetic lead scenarios (urgent HOT IELTS / vague COLD / mid WARM),
JSON mode, temperature 0.4, graded on parse, schema validity, and category correctness.

| Model | JSON parsed | Schema valid | Category correct | Avg latency |
|---|---|---|---|---|
| gemini-3.5-flash | 5/5 | 5/5 | 4/5 | 3,693 ms |
| **gemini-3.5-flash-lite** | 5/5 | 5/5 | **5/5** | **1,056 ms** |

**Finding:** the smaller model matched every hard requirement, was the only one to classify all leads
correctly, and ran ~3.5× faster. **Adopted as the production model.**

## Experiment B — negative control: retired model

`gemini-2.0-flash` through the identical integration → **HTTP 404** in 159 ms
("no longer available… use models/gemini-3.6-flash"). Kept as failure evidence: model retirement presents
as a plain 404, which is why the app classifies 404 as a permanent `AI_CONFIG` error instead of a transient
one, and why the model is pinned in env.

## Experiment C — JSON mode vs plain-prompt extraction

**Business task:** Academic (F-023) — 3-question IELTS vocabulary quiz as strict JSON, flash-lite,
3 runs per method. **Result:** parity (3/3 parse each; ~1.7s both). JSON mode kept everywhere as a free
guardrail against instruction drift.

## Context limitations (recorded honestly)

- Free-tier quota is **per-model per-day** and exhausted once mid-testing (2026-09-05) — documented in the
  experiment rows and the evaluation's weaknesses.
- Experiment C used a short, well-structured task; the JSON-mode guardrail may matter more on longer outputs.

## Lab practice (the repeatable process)

```
Select tool(s) → define a real business task → run the test → record output/quality/speed/cost/
ease/integration/limitations → compare across tools → document findings (this file + the DB)
```
