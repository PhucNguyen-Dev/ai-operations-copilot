# Architecture

A portfolio-scale system with **three orchestration paths**: the governed agent runtime (Ask X) inside Next.js, fixed n8n workflows, and the approval-execution layer (Brevo dispatch / task creation) that closes the governance chain. All migrations 001–021 are applied on the hosted Supabase project. See [ROADMAP](ROADMAP.md) for state and [SECURITY](SECURITY.md) for boundaries.

## Components and flows

```text
Staff browser
  → Next.js App Router + Supabase Auth
      ├→ RLS client → dashboards / decision workspace  ← lib/ops/snapshot (shared metrics)
      ├→ /agent → Mission Control (ChatPanel) + floating bubble
      │     ├→ /api/agent/runs → governed agent runtime → registered tools → Supabase
      │     ├→ /api/agent/briefing → deterministic SQL snapshot → ☀ pinned session
      │     └→ /api/agent/sessions/* → derived session history
      ├→ /api/leads/[id]/decisions → append-only decision record
      │     ├→ approved email → atomic claim → lib/email/dispatch → Brevo | sent_simulated
      │     └→ approved action → follow-up task (service client, deterministic writes)
      └→ /api/leads → signed envelope → n8n admissions pipeline
Telegram → tunnel → n8n chatbot → admissions pipeline
External machine client → scoped REST (agent.run | briefing.generate) → runtime / briefing
n8n cron 07:00 → /api/external/briefing → in-app briefing generation
Agent model turns + knowledge embeddings → direct Gemini
```

- **Next.js** serves employees, hosts the agent loop, the decision workspace and all API routes.
- **`lib/ops/snapshot.ts`** is the single source of truth for operational metrics (needs action / follow-ups due / at risk / pending approvals / priority ranking). The dashboard and the briefing both consume it — the two surfaces cannot drift.
- **The morning briefing** (`lib/agent/briefing.ts`) writes its artifact *as* an `agent_runs` row (`agent_id='briefing'`, zero tokens) with system steps carrying the real leads found — so the session rail, LeadCards and Run Inspector render it through existing code paths. Deterministic: numbers come from SQL, never from a model. Session identity is a UUIDv5 of user + UTC day.
- **Approval execution** (`app/api/leads/[id]/decisions/route.ts`): approved email drafts are claimed atomically (`status='dry_run'` conditional update — double-click races lose) then dispatched via **Brevo's HTTP API** when `BREVO_API_KEY` is configured, or recorded as `sent_simulated` when not (migration 021). Provider failures persist as `failed` + reason, retryable. Approved recommendations create follow-up tasks via the **service client** (tasks are deterministic writes by trust model), assigned to the lead's counselor.
- **`lib/delivery/`** splits briefing artifact from channel: `in_app` ships today; telegram/email/webhook adapters later are additive.
- **n8n** owns the classic admissions workflow, the Telegram chatbot, the error handler and the daily briefing cron. It does not orchestrate the agent loop.
- **Supabase** holds Auth, CRM, decisions, execution records, knowledge chunks and limiter/cache state. RLS governs every read; service-role writes are reserved for runtime/deterministic paths so the audit trail is tamper-proof.
- **Gemini** supplies agent turns and embeddings. The runtime injects the current UTC clock into every system prompt and enforces explicit date bounds on relative-period lead searches (`PERIOD_BOUNDS_REQUIRED`).

## Entry points and trust contexts

| Entry | Reference | Context |
|---|---|---|
| Agent run | `app/api/agent/runs/route.ts` | Session role gate; requester-scoped reads; service-role persistence |
| Approval decision (agent) | `app/api/agent/approvals/[id]/route.ts` | Ops/admin decide; self-approval forbidden; resume re-evaluates under the original requester |
| Lead decision (executing) | `app/api/leads/[id]/decisions/route.ts` | Accountable roles only; atomic draft claim; execution outcome folded into the audit note |
| Briefing (in-app) | `app/api/agent/briefing/route.ts` | Caller's session scopes every read (RLS); artifact written via service client |
| Briefing (scheduled) | `app/api/external/briefing/route.ts` | `briefing.generate` scope, ops/admin targets only, data via `compute_daily_briefing()` security-definer door |
| External agent run | `app/api/external/agent/runs/route.ts` | Client credentials + scope + allowlist + rate limit |
| External client provisioning | `app/api/agent/external-clients/route.ts` | Allowlisted scopes (`agent.run`, `briefing.generate`); secret stored hash-only |
| Lead intake | `app/api/webhooks/lead/route.ts` | Shared secret + signed envelope |

Scope isolation is enforced: a `briefing.generate` client cannot start agent runs and vice versa (negative-tested).

## Data families

| Tables | Purpose |
|---|---|
| `profiles`, `courses`, `leads`, `lead_analyses` | Staff/catalog and admissions CRM |
| `tasks`, `sent_emails`, `notifications` | Follow-ups, email drafts + dispatch bookkeeping (`status`, `dispatched_at/by`, `dispatch_error`), notifications |
| `lead_action_decisions` | Append-only human decisions on AI output (migration 019) |
| `automation_runs`, `automation_run_steps` | n8n execution summaries |
| `agent_runs`, `agent_run_steps`, `agent_approvals` | Agent state, feedback, approvals; `session_id` (016) powers sessions + briefing; `clarification_required` status (017) |
| `agent_api_clients`, `agent_runtime_config`, `agent_tool_config` | Scoped machine credentials (hashed), kill switch, tool enablement |
| `knowledge_docs`, `knowledge_chunks`, `match_knowledge_chunks` | Role-aware pgvector retrieval |
| `rate_limit_hits`, `ai_response_cache` | Shared infrastructure |

## Persistence is not a worker queue

`lib/agent/store.ts` implements durable state; the runtime holds no authoritative memory across restarts. Approval resume claims work durably (at-most-once); claimed work is never blindly replayed. The lead webhook starts triage in-process — an acknowledged intake is not proof triage completed. The Postgres limiter fails open on RPC errors. These are implementations, not capacity guarantees.

## Canonical details

[Agent core](AGENT_CORE.md) · [Security](SECURITY.md) · [n8n workflows](WORKFLOW.md) · [External API](EXTERNAL_API.md) · [Telegram](TELEGRAM-CHATBOT.md) · [Runbook](RUNBOOK.md) · [Testing](TESTING.md)
