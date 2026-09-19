# AI design — routing, prompts and contracts

AI responsibilities differ by path; there is no universal Gateway, JSON-mode or prompt-ownership guarantee. Runtime/approval hardening and all offline checks (unit, typecheck, n8n validation, build) pass in the working tree; live SQL/provider verification and remote CI remain pending ([evidence](evidence/LOCAL_VERIFICATION.md)). Historical model experiments are preserved in [AI_TOOL_LAB](AI_TOOL_LAB.md), not treated as fresh benchmarks.

## Provider routing

| Consumer | Current path | Contract |
|---|---|---|
| Five staff tools | `generateJSON` (`lib/gemini.ts:112`) → configured Gateway, otherwise direct Gemini | JSON response + local use-case validator |
| Agent turns | `generateAgentTurn` (`lib/gemini.ts:318`) → direct Gemini | Function declarations and returned function calls, not JSON-only generation |
| Knowledge query embeddings | `generateEmbedding` (`lib/gemini.ts:429`) → direct Gemini | Numeric embedding with 768 dimensions |
| n8n qualification, email and chatbot | Workflow HTTP nodes → direct Gemini | JSON generation + workflow validation nodes |
| Knowledge ingestion | `scripts/ingest-knowledge.mjs:1` | Offline/operator-triggered embedding of knowledge documents |

Gateway dispatch requires both URL and key (`lib/gateway-client.ts:34`). It is a configuration switch for `generateJSON`, not automatic failover on a Gateway failure. Agent turns, embeddings and n8n requests bypass it. Gateway-side metering therefore does not account for all project AI usage.

Direct app generation uses `AI_MODEL` or its committed default. Embeddings use `EMBEDDING_MODEL` or `gemini-embedding-001`; keep dimensions aligned with migration 011. Some workflow defaults still name older models (`n8n/admissions-lead-pipeline.json:177`), so inspect configuration and provider availability before running. A model identifier pin reduces accidental selection changes; it does not guarantee immutable provider behavior or continued availability. No provider availability was checked here.

## Prompt ownership versus telemetry

| Prompt family | Owner / source | Registry failure behavior |
|---|---|---|
| Staff tool system prompts | `getSystemPrompt`, `lib/promptledger.ts:99`; committed `prompts/` fallback when unconfigured | Configured retrieval errors fail closed after the 60-second cached entry expires; no silent committed fallback on fetch failure |
| n8n lead qualifier | `Prepare AI prompt`, `n8n/admissions-lead-pipeline.json:163` | Unattended fail-open policy: last-known-good workflow static data or committed copy, tagged for logging |
| n8n email draft | `Prepare email prompt`, `n8n/admissions-lead-pipeline.json:552` | Workflow-owned live lookup/fallback policy; inspect its prompt-source tags |
| n8n parent chat | `Prepare turn`, `n8n/telegram-parent-chatbot.json:35` | Unattended live lookup with last-known-good/committed fallback and source tags |
| Agent system prompts | Committed strings in `lib/agent/agents.ts:23` and agent definitions | Not served by the staff PromptLedger adapter |

This preserves the unattended-intake fallback policy formerly described in the historical roadmap. It is intentionally different from interactive staff tools; do not rewrite it as universal fail-closed behavior.

`lib/runtrace.ts:116` optionally posts input/output and metadata to PromptLedger, with best-effort deployment pinning when a prompt version exists. Receiving an agent run trace does **not** make PromptLedger the agent prompt owner. A telemetry deployment record is not proof of a hosted application deployment. Satellite configuration and reachability are unverified here; the project must be understandable without sibling repositories or private notes.

## Output validation

For staff tools, JSON generation is parsed and checked by callbacks in `lib/ai/schemas.ts:21` onward; Gateway responses still pass local validation. Contracts include content drafts, campaign insights, lesson plans, quizzes and operational reports. `lib/ai/json-schemas.ts:103` maps tool schemas for the Gateway adapter. Schema validity does not establish factual accuracy.

The n8n pipeline's `Schema check` gates qualification; `Email schema check` gates drafts; the chatbot's `Resolve turn` validates and merges conversational data. The model proposes a lead score; the `Score & classify` node (`n8n/admissions-lead-pipeline.json:337`) applies deterministic thresholds: at least 70 → HOT/HIGH, at least 40 → WARM/MEDIUM, otherwise COLD/LOW. This is a heuristic prioritization score, not a calibrated conversion probability.

Agent calls instead pass registered argument/output validators and permission/resource checks. Tool metadata and execution semantics are canonical in [AGENT_CORE](AGENT_CORE.md). Requests to finish or cite a source are not independent proof that a goal was achieved.

## Failure, cache and logging

- Direct JSON requests classify transient network/429/5xx failures for retry; truncation can be retried while schema/configuration failures are not blindly retried. Exact attempts differ by path; n8n node retries are not the agent retry policy.
- Agent turns retry transient failures once (`lib/gemini.ts:337`), then report failure. Function-call replay preserves requestable model parts and opaque signatures; thought-only parts are filtered (`lib/gemini.ts:374`).
- Response cache is selected between Postgres and memory (`lib/ai/cache.ts:40`), with a ten-minute TTL. Read/eviction/upsert errors now explicitly log deliberate fail-open behavior, with backend unit tests; live Postgres behavior is unverified. This is not a cache for all embeddings/agent turns or a tenant boundary.
- `ai_generations` is department-tool generation logging, not a universal log of every model request. Agent execution and n8n run tables are separate. Optional run telemetry is best-effort and captures content, not just counts.

Do not equate health metadata, cached output, a successful trace POST or schema validity with live correctness. Data/retention implications: [SECURITY](SECURITY.md).

## Human responsibility

Staff tool outputs are drafts. Counselors review lead prioritization and policy exceptions; teachers verify answer keys; marketers verify claims; Operations reconciles reports with source data. Telegram pricing/course knowledge is simulated and may drift. Agent `prepare_email` records a dry-run draft only; n8n's separate send branch must remain dry-run for the case study. [TRAINING](TRAINING.md) defines the designed practice, and [TESTING](TESTING.md) defines the pending verification.
