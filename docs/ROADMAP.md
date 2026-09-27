# Roadmap — current state and next candidates

Updated **2026-09-20** at commit set through `8d1cd03`. The original "locked one-week scope" (migrations through 015, docs handoff, PGlite verification) is **complete and retired** — see the [situations log](SITUATION_OCCUR.md) for the honest decision history. History archive removed in the docs cleanup.

## Where the product stands

| Capability | State |
|---|---|
| Governance chain | **Complete.** AI recommends → human approves (append-only `lead_action_decisions`) → system executes (Brevo dispatch / task creation, migration 021) → audit proves (merged activity timeline, run inspector) |
| Operations command center | Live: operational KPIs, priority queue, inline next-actions — one shared snapshot module powers dashboard + briefing |
| Ask X assistant | Live: Mission Control + bubble, sessions, rich cards, clarification-before-action, date-aware reporting enforced at the runtime boundary |
| Morning briefing | Live: deterministic SQL snapshot as a pinned ☀ session, auto-generated daily on first open; scheduled cron path wired (`briefing.generate` scope, machine client provisioned, `/api/external/briefing` verified) |
| Email execution | Live: Brevo HTTP dispatch behind env vars; simulated mode is the honest default. **Real sends pending user's Brevo key** (situations #8) |
| External push (Telegram etc.) | **Declined by design** (situations #9) — delivery stays in-app |
| Verification | 350→**386 unit tests / 34 files**, lint, typecheck, guarded build — all green; migrations 001–022 applied to hosted Supabase (**023 and 024 written, paste-safe, not yet applied** — the durable intake path and the cancellation RPC are inert until they are); the 12-scenario eval suite re-confirmed post-Briefing-v2; kill-switch restore race FIXED in the harness (beforeEach reset) |

## Next candidates, in priority order

**1. ~~Assistant memory — durable session context.~~ SHIPPED (2026-09-20).** Migration 022 + `lib/agent/session-context.ts`: capped derived context per session, injected as untrusted reference material; eval-proven to cut follow-up steps 7→4 and tokens ~27%. The deferred situation #6 is resolved.

**2. Real-send acceptance test.** The moment the user's Brevo key lands in `.env`: verify sender, simulate a lead to a real inbox, approve, confirm delivery + provider id + spam-folder behavior. Small, unblocks claiming real email execution.

**3. ~~CI guard + dev/build separation.~~ SHIPPED (2026-09-20).** `npm run build` refuses while the dev server is live; `BUILD_ANYWAY=1` builds an isolated `.next-build` (smoke-tested via `npm run start:isolated` on :3100) so the dev server is never clobbered again. Non-blocking `predev` warning for port conflicts and stale builds; `npm run ci` surfaces the remote CI status for the branch. Verified live: refuse-with-dev-up, isolated build + production smoke test, dev untouched.

**4. ~~Whole-app pattern audit.~~ SHIPPED (2026-09-20).** [PATTERN_AUDIT](PATTERN_AUDIT.md): 21/21 screens reviewed; 10 keep-patterns, 5 ranked additions (top: sidebar decisions badge, bubble Escape key), 5 explicit rejections, 6 consistency findings (one stale SOP fix). Next build: the governance-papercut bundle from its recommendations.

**5. ~~Briefing v2.~~ SHIPPED (2026-09-20).** One optional AI prioritization sentence per briefing — fed only verified SQL facts, validated, persisted as an auditable `briefing_narrative` step, silently absent on any failure (deterministic headline remains). Lead cards gained review-first "Draft follow-up" links that prefill the Ask X input verbatim from the real recommended action; nothing auto-runs. Verified live: narrative grounded + token-honest (344/38 on the step), prefill → governed run flow works.

**6. ~~Production-hardening bundle (A).~~ SHIPPED (2026-09-25).** Durable lead intake (migration 023 `lead_intake_outbox` + `lib/lead-intake.ts` + ops/admin worker route `/api/agent/intake-worker`): the webhook's lead insert is the commit point; counselor assignment + agent triage run as outbox jobs with bounded backoff and visible dead-lettering — no more fire-and-forget. Rate limiter failure policy is now explicit fail-**closed** (every call site is cost-bearing) with per-key `RATE_LIMIT_FAIL_OPEN_KEYS` opt-out; approval chain re-audited and confirmed at-most-once-correct (audit note in migration 023). Eval kill-switch race fixed in the harness; situation #1 stray rows get a dry-run-default cleanup script (`scripts/cleanup-situation1.mjs`).

**7. ~~Streaming Ask X (B).~~ SHIPPED (2026-09-25).** `POST /api/agent/runs/stream` (SSE) + `generateAgentTurnStream` + runtime `onEvent` events; ChatPanel renders progressive text and live tool steps in bubble and Mission Control. Governance identical to the JSON route (client ladder: stream → poll durable run → one fallback POST). JSON route untouched; external API unchanged.

**8. ~~Gateway/Ledger unification (C).~~ SHIPPED (2026-09-25).** Agent prompts are registry-owned: committed `prompts/<agent-id>.json` (single source), live resolution via PromptLedger with fail-closed semantics, persisted `prompt_source`/`prompt_version` on runs and in run traces. The Gateway agent-turn endpoint (loop turns still bypass the Gateway) is spec'd, not implemented: [GATEWAY_AGENT_TURN_SPEC](GATEWAY_AGENT_TURN_SPEC.md).

**9. ~~Run cancellation (operator stop).~~ SHIPPED (2026-09-27).** Migration 024 + `request_agent_run_cancel`: a durable per-run stop request, enforced at every pre-action barrier (before each model turn, each tool execution, each approval resume) rather than by a UI gesture. A suspended run is ended and its approval withdrawn atomically, so "cancel, then approve" cannot execute; `resumeAgentRun` refuses a cancelled run outright. The in-flight model call is aborted for immediate effect, and the terminal system step is recorded as `skipped` with the reason — the trace states what ran before the stop, never that nothing happened. Migration 023 (durable lead intake) and 024 both still await their paste-safe SQL-editor application; `scripts/verify-run-cancel.mjs` is the acceptance check for 024 once applied. **Only 023/024 application and a live eval re-run are outstanding.**

## Explicitly not planned

- External push channels (Telegram/Instagram/TikTok/YouTube/SMS) — declined 2026-09-20, see situations #9; revisit only with a dedicated ops bot + per-recipient opt-in
- Real Gmail/OAuth transport — superseded by the Brevo HTTP adapter
- Bulk actions, SLA countdowns, pipeline-diagram dashboards — no backing data today; adding them would fabricate states the governance model forbids
