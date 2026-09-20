# Roadmap — current state and next candidates

Updated **2026-09-20** at commit set through `cad0da4`. The original "locked one-week scope" (migrations through 015, docs handoff, PGlite verification) is **complete and retired** — see the [situations log](SITUATION_OCCUR.md) for the honest decision history. History archive removed in the docs cleanup.

## Where the product stands

| Capability | State |
|---|---|
| Governance chain | **Complete.** AI recommends → human approves (append-only `lead_action_decisions`) → system executes (Brevo dispatch / task creation, migration 021) → audit proves (merged activity timeline, run inspector) |
| Operations command center | Live: operational KPIs, priority queue, inline next-actions — one shared snapshot module powers dashboard + briefing |
| Ask X assistant | Live: Mission Control + bubble, sessions, rich cards, clarification-before-action, date-aware reporting enforced at the runtime boundary |
| Morning briefing | Live: deterministic SQL snapshot as a pinned ☀ session, auto-generated daily on first open; scheduled cron path wired (`briefing.generate` scope, machine client provisioned, `/api/external/briefing` verified) |
| Email execution | Live: Brevo HTTP dispatch behind env vars; simulated mode is the honest default. **Real sends pending user's Brevo key** (situations #8) |
| External push (Telegram etc.) | **Declined by design** (situations #9) — delivery stays in-app |
| Verification | 344 unit tests / 29 files, lint, typecheck, guarded build — all green; migrations 001–022 applied to hosted Supabase; remote CI green on `main` (`npm run ci`) |

## Next candidates, in priority order

**1. ~~Assistant memory — durable session context.~~ SHIPPED (2026-09-20).** Migration 022 + `lib/agent/session-context.ts`: capped derived context per session, injected as untrusted reference material; eval-proven to cut follow-up steps 7→4 and tokens ~27%. The deferred situation #6 is resolved.

**2. Real-send acceptance test.** The moment the user's Brevo key lands in `.env`: verify sender, simulate a lead to a real inbox, approve, confirm delivery + provider id + spam-folder behavior. Small, unblocks claiming real email execution.

**3. ~~CI guard + dev/build separation.~~ SHIPPED (2026-09-20).** `npm run build` refuses while the dev server is live; `BUILD_ANYWAY=1` builds an isolated `.next-build` (smoke-tested via `npm run start:isolated` on :3100) so the dev server is never clobbered again. Non-blocking `predev` warning for port conflicts and stale builds; `npm run ci` surfaces the remote CI status for the branch. Verified live: refuse-with-dev-up, isolated build + production smoke test, dev untouched.

**4. Whole-app pattern audit.** The planned review deliverable: AI-operations patterns present / worth adding / should **not** add across all screens — the roadmap for the build after next. *Effort: lowest; no code.*

**5. Briefing v2 (polish).** Optional LLM prioritization line fed verified numbers (with designed fallback), plus act-from-briefing buttons. *Additive; the deterministic core does not change.*

## Explicitly not planned

- External push channels (Telegram/Instagram/TikTok/YouTube/SMS) — declined 2026-09-20, see situations #9; revisit only with a dedicated ops bot + per-recipient opt-in
- Real Gmail/OAuth transport — superseded by the Brevo HTTP adapter
- Bulk actions, SLA countdowns, pipeline-diagram dashboards — no backing data today; adding them would fabricate states the governance model forbids
