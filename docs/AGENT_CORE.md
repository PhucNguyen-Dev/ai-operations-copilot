# Agent core

Current working-tree implementation over `c8506e4`, reviewed 2026-09-17. Approval hardening is implemented and final offline checks (273/273 unit tests across 23 files, typecheck, validation of 4 n8n workflows with 3 existing Gmail variable warnings, build) pass; migration 015 passes 28 isolated SQL checks, but hosted application, live behavior and remote CI remain **pending**. [Local evidence](evidence/LOCAL_VERIFICATION.md) records the boundary; [Phase 9](archive/PHASE_9_AGENTIC_CORE_UPGRADE.md) preserves original design intent.

## Execution and identities

```text
Goal → persist → model selects registered tool → validate/authorize/resource check
     → execute / deny / suspend → persist feedback → re-plan → finish/escalate/fail
```

The loop runs inside Next.js: `startAgentRun` at `lib/agent/runtime.ts:84`, resume at `lib/agent/runtime.ts:144`. n8n remains a separate fixed workflow. Model adapter: `lib/agent/model.ts:43`; registry: `lib/agent/registry.ts:16`; agent definitions: `lib/agent/agents.ts:35`.

| Agent | Intended use | Tools |
|---|---|---|
| `admissions-followup` | Employee Ask X / trusted webhook triage | CRM/history reads, task, notification, dry-run email, knowledge, reporting delegation, finish/escalation |
| `external-lead-support` | Credential-based REST | CRM/history/knowledge reads and control outcomes; no CRM write tool |
| `reporting-agent` | Delegated reporting | CRM/history/knowledge reads and finish; no delegation tool |

Employee routes have role gates with an admin exception; an empty `allowedRoles` is not an absolute direct-admin invocation ban. Permission evaluation (`lib/agent/permissions.ts:36`) intersects tool/agent allowlists, role, enabled state and approval policy. Resource checks precede governed service-role writes.

## Approval decision and resume

- Operations/Admin decide; self-decision returns **403**, conflicting prior decisions **409**. A retry of the same decision cannot replace the stored decision/note and may re-enter safe resume (`app/api/agent/approvals/[id]/route.ts:48`). A racing first decision can return 409; inspect current state rather than switching decisions.
- Migration [015_approval_resume.sql](../supabase/migrations/015_approval_resume.sql) adds `approval_wait_ms`, `approval_wait_started_at`, `pending_approval_id` and `execution_claimed_at`. The bound, decided approval is durably claimed before execution; only the claim winner proceeds.
- Resumed tools use `requesterRead`, not the approver's `userClient` (`lib/agent/runtime.ts:354`). The service-role-only RPC verifies the persisted requester against **`auth.users.raw_app_meta_data.role`**, not the profile mirror (`supabase/migrations/015_approval_resume.sql:123`). Missing/changed authoritative identity fails authorization. Lead reads additionally check the requester's resource scope.
- Permission, resource visibility, tool enablement and kill/budget state are checked before claiming and again before executing (`lib/agent/runtime.ts:191`, `lib/agent/runtime.ts:754`). Approval is not a permanent authorization grant.
- Recorded human wait is excluded from active timeout accounting (`lib/agent/guardrails.ts:27`). This does not reset step/token consumption.
- After a claim, interruption/timeout or uncertain effects produce **`RECONCILIATION_REQUIRED`**; the runtime does not blindly replay claimed work. This is at-most-once admission to approved execution, **not exactly-once delivery** or guaranteed completion.

Migration 015's SQL is **verified in an isolated in-memory PostgreSQL run** (PGlite; 28/28 checks including an idempotent rerun — see [local evidence](evidence/LOCAL_VERIFICATION.md)); it is not yet applied to a hosted project, and real multi-connection claim concurrency is untested. Its guarded legacy backfill only handles an unambiguously single pending approval. Decided, multiple-pending or missing-pending legacy states need the manual reconciliation described in [RUNBOOK](RUNBOOK.md).

## Email remains dry-run

`prepare_email` validates the visible lead's recipient address before inserting `sent_emails.status = 'dry_run'` (`lib/agent/tools/comms.ts:64`). It never sends mail, including after approval. Gmail transport belongs to n8n and its separate `GMAIL_DRY_RUN` setting.

Tool policy is `!ctx.dryRunEmail` (`lib/agent/tools/comms.ts:59`). The route passes server configuration and requester opt-in separately (`app/api/agent/runs/route.ts:86`). Runtime combines them with **OR** and persists the result in `current_state.require_approval` (`lib/agent/runtime.ts:101`). Resume retains the persisted requirement and can strengthen it from the current server setting (`lib/agent/runtime.ts:131`); delegated children inherit the effective requirement (`lib/agent/runtime.ts:368`). A false/omitted requester flag cannot weaken a server requirement. This is implemented with regression tests; live acceptance remains pending.

## Guards, persistence and delegation

Defaults: 12 tool attempts, 120 seconds active run time, 60,000 reported model tokens and 3 calls per turn (`lib/agent/guardrails.ts:20`); repeat refusal at `lib/agent/guardrails.ts:79`. Execution rechecks guards and limits tool waiting to the remaining active budget. A timeout cannot retract an in-flight side effect; uncertain execution is flagged, not retried blindly. Eligible idempotent unapproved calls can retry after fresh checks; approved calls do not use that automatic retry path.

`SupabaseAgentStateStore` (`lib/agent/store.ts:27`) persists runs, decisions and model-visible feedback. Opaque requestable provider parts support conversation reconstruction; thought-only parts are filtered by the model adapter. Traces contain arguments/results and may contain personal data; they are not anonymized reasoning logs.

Delegation preserves requester identity and `parent_run_id` (`lib/agent/runtime.ts:368`). Reporting cannot delegate further. Budgets remain per run; parent/child correlation is not a global aggregate budget. Persistence is not a worker queue: lead-webhook triage still starts in-process and storage acknowledgement is not completed triage.

## Retrieval and UI

`search_knowledge` (`lib/agent/tools/knowledge.ts:66`) uses semantic retrieval with keyword fallback, up to three matches, 0.3 similarity threshold and 600-character excerpts. Direct PostgREST keyword filters sanitize syntax characters; resumed retrieval uses requester RPCs and role filtering. Source excerpts remain untrusted data, not authority to change policy or proof of correctness. Live SQL grants and retrieval/role matrices remain deployment checks.

Ask X exposes **Refresh run trace** for awaiting-approval/running messages (`app/(app)/agent/AgentChat.tsx:118`). This is manual refresh, not polling/streaming or an approval UI. Use it to fetch the persisted result after a separate approval decision.

Employee run/list/detail and tool discovery live under `/api/agent`; approval decisions use `POST /api/agent/approvals/{id}`. External REST and signed lead intake are documented in [EXTERNAL_API](EXTERNAL_API.md). [RUNBOOK](RUNBOOK.md), [SECURITY](SECURITY.md) and [TESTING](TESTING.md) own operations, boundaries and verification. The [MCP stdio adapter](../mcp/README.md) now wraps external REST; the separate [native n8n MCP profile](WORKFLOW.md#5-mcp-profile-1-native-n8n-admissions-tools) uses classic qualification and service-role history, not the governed agent loop. Both are implemented and offline-verified; live acceptance and captures remain pending.
