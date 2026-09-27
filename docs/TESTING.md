# Testing and evidence

Commands come from `package.json`. Latest firsthand results on the committed revision (**2026-09-25**, production-hardening/streaming/prompt-ownership bundles): **373 unit tests across 33 files, lint clean, typecheck clean** (new: intake outbox + fail-mode limiter, streaming SSE parse/reliability-ladder, prompt-resolution pins; backend-fallback limiter tests updated to the fail-closed policy). The real-model eval suite (`npm run evals:agent`, 12 scenarios) last passed 12/12 on the hosted stack at Briefing v2; the kill-switch restore race is now **fixed in the harness** (`beforeEach` reset), leaving real-model variance as the only known flake source. **Migration 023 (lead-intake outbox) needs the usual paste-safe SQL-editor application to the hosted Supabase before the webhook's durable path goes live.** Live browser verification of the streaming UI and an eval re-run on this revision are still pending.

## Offline checks

```sh
npm run lint
npm run typecheck -- --incremental false
npm test
node scripts/validate-n8n.mjs
npm run build
```

### What the suites cover

| Suite | Focus |
|---|---|
| Agent runtime + tools | Bounded steps/time/tokens, kill switch, tool disable, date-bounds guard, delegation limits |
| Approvals (`agent_approvals`) | Durable claim semantics, identity/role revalidation, 409/403 paths, reconciliation flags |
| Lead decisions (migration 019) | Append-only decisions, one active per (lead, target), RLS-scope enforcement |
| Email dispatch (`tests/unit/email-dispatch.test.ts`) | Decision table: configured → Brevo send, unconfigured → simulated, provider error → typed retryable failure; idempotent claim |
| External API | Hashed-secret auth, scope allowlist (including the negative `briefing.generate`-vs-`agent.run` isolation test), per-client run history |
| Agent sessions / clarification / date filters | Session stamping + ownership, clarification round-trips, bounded "this week" semantics |
| Briefing | Deterministic snapshot math parity (`lib/ops/snapshot.ts` vs SQL `compute_daily_briefing`), pinned session behavior |
| Session memory (`tests/unit/session-context.test.ts`) | Context derivation, caps, merge precedence, JSON round-trip, render cap; runtime carry-in + user isolation (memory store harness) |
| Chat UI cards | Trace-step → card mapping (`lib/chat/cards.ts`), approval buttons, step traces |
| Telegram bot | Intent routing, parent-facing flows, no ops-data leakage |
| MCP stdio adapter | 36 cases with injected HTTP mocks — no live API |

### Integration / opt-in checks

Run only against an authorized disposable project with synthetic records.

| Command | Coverage | Side effects |
|---|---|---|
| `npm run test:integration` | Real Gemini client | Provider credentials + quota |
| `npm run test:e2e` | Playwright auth + role/RLS visibility | Local app, seeded users |
| `npm run evals:agent` | Real-model scenarios + trace scoring | App, Gemini, DB credentials; runtime state |
| `node scripts/verify-external-api.mjs` | External auth, discovery, run attribution | Temp client + run records |
| `node scripts/verify-lead-webhook.mjs` | Signed intake, duplicate handling | Synthetic leads + triage |
| `node scripts/verify-persistent-infra.mjs` | Postgres limiter/cache round-trip | Infra state mutation |
| `node scripts/verify-mcp.mjs` | MCP stdio adapter: initialize + three tool schemas against the spawned adapter | No HTTP by default (dummy credentials); `RUN_MCP_LIVE=1` opts into one live API run (quota + run/audit/approval records) |
| `node scripts/verify-approval-sql.mjs` | 28-check isolated SQL harness (approval resume, RLS, knowledge, claims) on PGlite | Requires `PGLITE_MODULE_PATH` pointing at a temp install of `@electric-sql/pglite` + `@electric-sql/pglite-pgvector` (installed under the OS temp directory, not workspace deps); in-memory only, no hosted DB touched |

## Live acceptance performed (2026-09-20)

- Approval gate on a real lead: decision recorded, confirmation line rendered, **recommended action → follow-up task created** (high priority, due next day, assigned to the lead's counselor) and **email draft → dispatch** with honest status and audit note.
- Briefing parity: dashboard UI, in-app builder and the SQL `compute_daily_briefing` function return identical counts for the same admin (12 needs-action / 0 follow-ups-due / 27 at-risk / 42 total at verification time), proving the dashboard and scheduled path cannot drift.
- External briefing client: real `POST /api/external/briefing` returns the full briefing; the same credential on the agent-run route is rejected with 403 scope isolation.

## Still gated on real deployment

- Migrations are applied manually (SQL Editor); each new migration needs the same application + column check (`021` verified: enum value + dispatch columns present).
- Real Brevo send with a verified sender and a real recipient inbox (currently everything is simulated by design — see [SECURITY](SECURITY.md)).
- Remote CI was green on GitHub Actions at `017c03a` (2026-09-20); check the actual run with `npm run ci` after each push rather than assuming it.
- Playwright e2e against the current build (the 12-scenario agent eval suite was re-run on 2026-09-20 — see above).

## Reporting results safely

Record revision, date, environment class, exact command, outcome, skips and limitations. Keep raw `test-results` artifacts out of commits; redact personal data and credentials from any shared trace. A green test is evidence only for its assertions — not proof of tenant isolation, deliverability or production capacity.

## Documentation checks

Keeper-doc Markdown links are reviewed during documentation passes; **no scripted link-checker exists in the repository**. Every link must resolve to a live file — the archive folders and retired docs (execution report, AI tool lab/evaluation, training, design notes) were removed in the 2026-09-20 docs revision and must not be re-linked.
