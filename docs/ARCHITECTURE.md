# Architecture

Current source map for a portfolio-scale system with **two orchestration paths**: fixed n8n workflows and a governed agent runtime inside Next.js. Approval hardening and offline checks (unit/type/n8n/build) are complete in the working tree; database application, live deployment and remote CI gates remain open. See [ROADMAP](ROADMAP.md) and [local evidence](evidence/LOCAL_VERIFICATION.md).

## Components and flows

```text
Staff browser
  → Next.js App Router + Supabase Auth
      ├→ RLS client → dashboards / CRM / governance records
      ├→ /api/ai/* → prompt adapter → generateJSON → Gateway OR Gemini
      ├→ /api/agent/runs → agent runtime → registered tools → Supabase
      └→ /api/leads → signed envelope → n8n admissions pipeline
Telegram → temporary HTTPS tunnel → n8n chatbot → admissions pipeline
External application → credential-scoped REST → agent runtime
MCP host → profile 2 stdio adapter → credential-scoped REST → agent runtime
MCP client → profile 1 native n8n MCP → signed classic intake / recent agent runs
Signed lead source → /api/webhooks/lead → CRM insert → agent triage
Agent model turns + knowledge embeddings → direct Gemini
Optional PromptLedger ← run telemetry; selected prompts → consumers
```

- **Next.js** serves employees and hosts API routes, interactive AI tools and the agent execution loop.
- **n8n** owns the classic deterministic admissions workflow, Telegram conversation workflow, error-handler workflow and [native MCP profile 1](WORKFLOW.md#5-mcp-profile-1-native-n8n-admissions-tools). It does not orchestrate the agent loop. Profile 1 uses bearer auth, a signing Code node for classic qualification and service-role reads of recent agent runs; it does not inherit agent API approval/scope/rate controls.
- **[MCP profile 2](../mcp/README.md)** is a handrolled stdio protocol adapter over the existing external agent REST API, not SDK-backed or compliance certified. Both profiles are implemented and offline-verified; live interoperability, deployment and captures remain pending. “Config-only” for profile 1 means no app changes, not no authored code.
- **Supabase** holds Auth, CRM, governance data, execution records, knowledge chunks and optional shared limiter/cache state. Dashboards do not read n8n's internal execution database.
- **Gemini** supplies JSON generations, function-calling agent turns and embeddings. **Gmail** is transport only for the separate n8n send branch; the local target uses dry-run email.

## Entry points and trust contexts

| Entry | Implementation reference | Context |
|---|---|---|
| Internal agent run | `app/api/agent/runs/route.ts:40` | Session role gate; initial reads use the requester's Supabase client; runtime persistence uses service role |
| Approval decision | `app/api/agent/approvals/[id]/route.ts:19` | Independent Operations/Admin decision; resume uses authoritative requester RPC and durable claim, not the approver's DB scope |
| External agent run | `app/api/external/agent/runs/route.ts:20` | Client credentials, scope, agent allowlist, rate limit; both runtime clients are service clients |
| External lead intake | `app/api/webhooks/lead/route.ts:96` | Shared-secret + signed envelope; system/admin triage, not employee RLS scope |
| Classic intake | `app/api/leads/route.ts:1` | Staff entry into the separate signed n8n pipeline |

External run-history filtering by client is **not CRM tenant isolation**. Service-role writes bypass RLS; resource checks are therefore a substantive boundary, not redundant UI checks. Full limitations: [SECURITY](SECURITY.md).

## Data families

| Tables / objects | Purpose |
|---|---|
| `profiles`, `courses`, `leads`, `lead_analyses` | Staff/catalog and admissions CRM |
| `tasks`, `sent_emails`, `notifications` | Follow-up records, dry-run/sent status and counselor notifications |
| `automation_runs`, `automation_run_steps` | n8n execution summaries and steps |
| `ai_generations` | Department generation metadata; not a universal ledger of every AI request |
| `tool_experiments`, `tool_evaluations` | Governance records |
| `agent_runs`, `agent_run_steps`, `agent_approvals` | Agent state, execution feedback and approval decisions |
| `agent_runtime_config`, `agent_tool_config` | Runtime kill switch and tool enablement |
| `knowledge_docs`, `knowledge_chunks`, `match_knowledge_chunks` | Role-aware document retrieval with pgvector |
| `agent_api_clients`, `leads.external_key` | External credentials/attribution and source-key duplicate detection |
| `rate_limit_hits`, `ai_response_cache`, `rate_limit_hit` | Shared infrastructure in migration 014 |

Migration 015 (`015_approval_resume.sql`) adds approval wait/claim fields and service-role-only requester RPCs. Requester authority comes from `auth.users.raw_app_meta_data.role`, not the profile mirror. Its SQL is verified in an isolated PGlite run (28 checks, [evidence](evidence/LOCAL_VERIFICATION.md)); hosted application remains pending, and [RUNBOOK](RUNBOOK.md) covers ordering and ambiguous legacy reconciliation.

## Persistence is not a worker queue

`lib/agent/store.ts:27` implements durable state access; `lib/agent/runtime.ts:84` starts runs and `lib/agent/runtime.ts:144` resumes approvals. Migration 015 claims approved execution durably and preserves requester scope. Claimed work is not blindly replayed; uncertain effects require reconciliation. This is not automatic recovery or exactly-once delivery. The lead webhook currently starts background work in-process (`app/api/webhooks/lead/route.ts:182`); a successful intake acknowledgement is not proof that triage completed.

The Postgres limiter is selected when service credentials exist unless memory is requested (`lib/rate-limit.ts:105`); RPC failure permits traffic (`lib/rate-limit.ts:88`). Cache selection and miss-on-read-error behavior are in `lib/ai/cache.ts:40` and `lib/ai/cache.ts:51`. These are implementations, not a measured capacity guarantee.

## Canonical details

[Agent core](AGENT_CORE.md) · [n8n workflows](WORKFLOW.md) · [AI/prompt design](AI_DESIGN.md) · [External API](EXTERNAL_API.md) · [Telegram operations](TELEGRAM-CHATBOT.md) · [Testing](TESTING.md)

The [original Phase 1 architecture](archive/AI%20Operations%20Copilot%20%E2%80%94%20Phase%201%20System%20A.md) and [Phase 9 specification](archive/PHASE_9_AGENTIC_CORE_UPGRADE.md) preserve earlier design intent, not current guarantees. The demonstration target is local services plus a temporary tunnel; hosted production and scale claims need separate design and evidence.
