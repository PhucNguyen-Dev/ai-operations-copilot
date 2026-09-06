# AI DESIGN — prompts, contracts, and guardrails

How AI is used across the system: the models, the prompt patterns, the output contracts, and the failure
philosophy. Every AI call in the app goes through `lib/gemini.ts` (R-02, "the one AI convention"); every
AI call in n8n follows the same policy node-for-node.

## Model

- **Gemini `gemini-3.5-flash-lite`** (env `AI_MODEL`) — chosen by a real head-to-head experiment
  (see AI_TOOL_LAB.md): matched the larger model on every hard requirement, classified all test leads
  correctly, ~3.5× faster, free tier.
- Model is **pinned** — Google cannot silently change scoring behavior (two model generations were retired
  on us mid-build; 404s are classified as permanent config errors, never retried).
- JSON mode (`responseMimeType: application/json`) everywhere, as a guardrail, at no latency cost.

## The output contract pattern (the core idea)

Every AI call is followed by a **schema gate** before anything is persisted or acted on:

```
AI call (JSON mode) → parse → validate fields/types/ranges → OK? continue : permanent failure
```

- Pipeline: the "Schema check" / "Resolve turn" code nodes.
- App: the per-tool `validate` callback in `generateJSON` (`lib/gemini.ts`).
- Malformed/incomplete output = permanent failure, logged, never persisted, never retried (retrying returns
  the same garbage).

## AI use cases and their contracts

| Use case | Contract (validated JSON) | Where |
|---|---|---|
| Lead analysis (F-004) | `{score: 0–100 int, category: HOT\|WARM\|COLD, intent: HIGH\|MEDIUM\|LOW, course, timeline, summary, recommended_action}` | n8n pipeline |
| Email draft (F-008) | `{subject ≤60 chars, body 2–4 paragraphs}` with truncation detection | n8n pipeline |
| Content Generator (F-020) | `{headlines[], ad_copy, ctas[]}` | `/api/ai/content-generator` |
| Campaign Analyzer (F-021) | `{summary, strong_segments[], weak_segments[], trends[], recommendations[]}` | `/api/ai/campaign-analyzer` |
| Lesson Planner (F-022) | `{structure, activities[], materials[], homework}` | `/api/ai/lesson-planner` |
| Quiz Generator (F-023) | `{questions[{q, options[4], answer, explanation}]}` | `/api/ai/quiz-generator` |
| Report Generator (F-024) | `{executive_summary, key_metrics{}, problems[], trends[], recommendations[]}` | `/api/ai/report-generator` |
| Chatbot turn (Telegram) | `{action: reply\|submit, text, collected{}/lead{}}` | n8n chatbot workflow |

## Scoring is deterministic, not vibes

The model proposes a 0–100 score; the **HOT/WARM/COLD thresholds are fixed code** (≥70 HOT/HIGH,
≥40 WARM/MEDIUM, else COLD/LOW) in the "Score & classify" node. Auditable, tunable, testable.

## Human review is structural

- Pipeline: exactly one automated send (first-touch email, dry-run locally, fully logged in `sent_emails`).
- All five interactive tools: output is presented as a draft with review copy; nothing is published/sent by AI.
- Chatbot: KB-grounded, may not invent prices/discounts; unknowns defer to a counselor; enrollment info
  flows into the human queue (task + notification), not into an auto-enrollment.

## Failure philosophy (learned from real incidents — docs/dev-fix-log.md)

- 429/5xx/timeout → transient, retried ×3–4 with backoff (5–10s steps to survive rate limits).
- 400/401/403/404 → permanent config errors (`AI_CONFIG`), surfaced honestly ("misconfigured — contact admin").
- Empty candidates (safety block) / unparseable JSON → permanent `AI_BAD_OUTPUT`.
- Schema mismatch → permanent, never retried.
- Generation logging (`ai_generations`) records tool, model, status, duration for every app-side call.
