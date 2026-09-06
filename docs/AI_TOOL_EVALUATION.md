# AI_TOOL_EVALUATION — adoption decision (F-027)

Distilled from the Tool Lab experiments (AI_TOOL_LAB.md). The scored decision also lives in the
`tool_evaluations` table and renders at `/governance/tool-evaluation`.

## Decision: gemini-3.5-flash-lite — **Recommended** (conditional)

**Use case:** primary LLM for all AI features — lead qualification (F-004), email drafting (F-008),
and the five interactive department tools (F-020–F-024).

| Criterion | Score | Evidence |
|---|---|---|
| Output Quality | 4/5 | Summaries counselor-ready; slightly less elaborate than flash (Exp. A) |
| Accuracy | 5/5 | 5/5 schema-valid, 5/5 category-correct — only model with a perfect run (Exp. A) |
| Cost | 5/5 | Free tier; cheapest per token on paid tier |
| Speed | 5/5 | Avg 1,056 ms on the production prompt — ~3.5× faster than flash |
| Ease of Use | 5/5 | One-line model swap; identical API surface |
| Integration | 5/5 | Native JSON mode; clean fit with n8n HTTP nodes and `lib/gemini.ts` |
| Security / Privacy | 4/5 | Synthetic data only in this prototype; real deployment must review Google's data-processing terms |
| Scalability | 3/5 | Per-model daily quota exhausted once mid-testing; growth needs paid tier or model fallback |
| **Total** | **36/40** | |

**Recommendation:** Recommended, conditional on free-tier quota limits.
**Conditions:** (1) monitor daily quota consumption via `ai_generations` and run logs; (2) model fallback
chain (flash-lite → flash → second provider) before any production volume; (3) pinned model version with a
deliberate upgrade process (retirements are fast — 2.0/2.5 generations 404'd during the build).

**Strengths:** fastest tested · perfect JSON compliance · best classification run · free tier · zero-friction
swap · JSON-mode guardrail at no latency cost.
**Weaknesses:** quota ceilings · less elaborate summaries · fast model-retirement cadence requires pin-and-monitor.

## Evaluation method

Eight criteria from the spec (§14), scored 1–5 from experiment evidence (not impressions), equal weights,
decision recorded with rationale and linked experiment rows (`experiment_refs`) in `tool_evaluations`.
Rejected alternative: gemini-3.5-flash (stronger prose, 3.5× slower, one classification error on the test set).
