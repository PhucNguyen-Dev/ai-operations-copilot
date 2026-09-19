# Roadmap — locked execution scope

Updated **2026-09-17** against baseline commit `c8506e4` **plus the uncommitted working tree**. [Local evidence](evidence/LOCAL_VERIFICATION.md) and the [execution report](EXECUTION_REPORT.md) separate firsthand reported checks from deployment gates; no checks were rerun during this final docs update. Original plans remain in [roadmap history](archive/ROADMAP_HISTORY.md) and the [Phase 9 archive](archive/PHASE_9_AGENTIC_CORE_UPGRADE.md).

## Locked scope — at most one week, no expansion

1. Finish the existing documentation handoff; the final local build already passes. Preserve user package/launcher changes and `.zcode`; no code changes or test/service runs in this docs update.
2. Prepare only a disposable **local app + local n8n + temporary tunnel** demonstration using synthetic Vietnamese-school data, if required services become available and the operator authorizes live actions.
3. Apply/review migrations through 015, validate the existing controls, and record redacted observations; otherwise leave these gates blocked, not “complete.”
4. Keep the case-study files as a **planned skeleton, not an implemented/deployed school scenario** until the walkthrough actually occurs.

Required live services remain unavailable for this planned exercise. Both MCP profiles have since been implemented and offline-verified; no live MCP service or customer deployment is established. No hosted deployment, real email, real school onboarding, interviews, training delivery, production users or business-impact claims. No autonomous retry/replay to manufacture successful evidence. This documentation pass edits public docs only, reads no secrets/private notes, and does not commit.

## Implemented in the current working tree

| Area | Current implementation | Remaining evidence boundary |
|---|---|---|
| Approval resume | `015_approval_resume.sql`: wait accounting, bound pending approval and durable at-most-once execution claim | Isolated SQL verified; hosted application and real multi-connection acceptance pending |
| Requester scope | Service-role-only requester-read RPC checks `auth.users.raw_app_meta_data.role` against persisted role; resumed tools do not use the approver's client | Live role changes/resource visibility and RPC grants unverified |
| Approval decision | Self-decision 403; conflicting decision 409; same-decision retries preserve the original decision; claimed work is not blindly replayed | Legacy ambiguous rows/uncertain effects require manual reconciliation |
| Runtime guards | Permission/resource/enabled/kill checks before execution, approval-wait exclusion, tool timeout and reconciliation handling | Not provider-side cancellation or global exactly-once effects; child budgets remain per run |
| Tool/API hardening | Sanitized direct knowledge filters, recipient validation, registered `allowedAgents`, missing provisioning owner 500, shared 60/min client run-history read limit | Live integration and full role/retrieval matrix pending |
| UI/infrastructure | Manual Ask X trace refresh; fail-open cache/limiter diagnostics and unit coverage | Browser behavior and Postgres round-trips pending |
| Verification plumbing | Classic E2E writes ignored `test-results/e2e-results.json`; PR/main-push CI runs fast checks/build | No remote CI or live test run verified |
| Approval policy | Server requirement OR requester opt-in persisted as `current_state.require_approval`; resume retains/strengthens; child inherits | Implemented and regression-tested; live acceptance pending |
| SQL resolution | Requester wrapper uses `search_path = public, extensions` for extension operator resolution | Verified in isolated PGlite run; hosted rollout pending |
| Isolated SQL verification | `scripts/verify-approval-sql.mjs`: 28/28 checks pass over unchanged 001/002/010/011/015 (plus 015 rerun), incl. authoritative principal, claim-once/wait accumulation, grants/RLS, vector operator resolution | Single-connection in-memory PGlite only; hosted migration application and real multi-connection concurrency remain pending |
| MCP profile 2 | [Handrolled stdio REST adapter](../mcp/README.md), three tools, 36 unit cases and [offline/opt-in live verifier](../scripts/verify-mcp.mjs) | Implemented/offline-verified; not SDK-backed or compliance certified; live API/Inspector and captures pending |
| MCP profile 1 | [Native n8n tools](WORKFLOW.md#5-mcp-profile-1-native-n8n-admissions-tools): classic qualification and service-role recent agent runs | Implemented/offline-verified; signing Code node means config-only is no app changes, not no authored code; import/publish/live acceptance pending |
| Local checks | **273/273 unit tests across 23 files, typecheck, validation of 4 workflows (3 existing Gmail variable warnings) and build pass** | Final firsthand results reported by primary; not rerun for this docs update, live service/remote-CI evidence, production readiness or lint (none configured) |

Source details: [AGENT_CORE](AGENT_CORE.md), [SECURITY](SECURITY.md), [EXTERNAL_API](EXTERNAL_API.md). Existing n8n flows, five staff AI tools, dashboards, governance, RAG and Postgres limiter/cache remain implemented; do not reopen them as absent features.

## Remaining gates, in order

**Release-gate status (revised 2026-09-17):** local Docker/psql/postgres/Supabase tooling was initially unavailable, so verification proceeded via a temporary isolated PGlite 0.5.8 install ([evidence](evidence/LOCAL_VERIFICATION.md), harness `scripts/verify-approval-sql.mjs`). The five selected migrations' SQL now passes 28 isolated checks, including an idempotent 015 rerun. Reproduction with temporary dependencies requires `PGLITE_MODULE_PATH` set to their install root; one invocation without it failed `MODULE_NOT_FOUND` before SQL execution, not because of a migration defect. Still **not done**: applying migration 015 on a hosted/managed Supabase project, real multi-connection concurrency, and migrations 003–009/012–014 in this isolated pass. The P0 approval-live-acceptance gate below still requires a real database and runtime.

| Priority | Gate | Completion evidence |
|---|---|---|
| P0 | Hosted migration 015 application and legacy review | Apply the verified SQL to an authorized managed project; reconcile ambiguous decided/multiple/missing-pending legacy cases manually per [RUNBOOK](RUNBOOK.md) |
| P0 | Approval live acceptance | Independent approver, same/conflicting decisions, **real concurrent claim across connections**, changed role/resource/tool/kill state, wait accounting and uncertain-effect handling |
| P1 | Restore/prepare authorized demo services | Disposable Supabase, provider, local app/n8n and optional test Telegram/tunnel; no setup assumed |
| P1 | Live workflow/integration/browser matrix | Synthetic RLS/retrieval, external limits, cache/limiter, Ask X refresh, bot opt-out and classic pipeline checks; reconcile accepted-but-untriaged leads |
| P1 | Live MCP and redacted captures | Inspector initialization/discovery/auth/tool results for both profiles; native n8n credential binding/import/publish, signing runner and subworkflow acceptance; stdio live API/run trace |
| P1 | Remote CI evidence | Inspect an actual run for the intended revision; workflow files alone are not green CI |
| P1 | Case-study execution/results | Execute only within the remaining timebox and available services; otherwise retain planned/unmeasured labels |

## Deferred limits, not secretly completed work

MCP is implemented and offline-verified, but live acceptance and captures remain pending. No CRM tenant isolation, hosted/HA capacity guarantee, durable background triage worker, global parent/child budget, universal idempotency, automatic recovery after an execution claim, or real agent email transport. Gateway coverage is partial; PromptLedger telemetry is not universal prompt ownership. Broader UX, training gates and provider integrations are outside this locked scope.

## Documentation handoff

Current source references and local Markdown targets are rechecked during finalization; external URLs and rendered anchors are not live-verified. Archives retain original text and historical plain-text references, including the old doc index/private-note names in `archive/ROADMAP_HISTORY.md:443` and former roadmap section reference in `archive/PHASE_9_AGENTIC_CORE_UPGRADE.md:691`. They are not required public dependencies. Historical experiments/screenshots and ignored private notes remain untouched.
