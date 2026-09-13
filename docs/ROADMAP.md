# Roadmap — AI Operations Copilot

One page for the whole project plan: what each phase delivers, where we are, and what's next.
Details live in the other docs — **spec:** `PRODUCT_SPEC.md` · **feature list + status:** `FEATURES.md` · **architecture:** `ARCHITECTURE.md` (long-form original in `archive/`).

**Current status: Phases 0–8 all done ✅ (30 features, Telegram chatbot, post-8 hardening). Phase 9 (Agentic Core Upgrade, `PHASE_9_AGENTIC_CORE_UPGRADE.md`) is in progress: Milestone A — the governed agent runtime (tool registry, durable run state, execution trace, permission engine, guardrails/approval/kill switch, first tool set, REST front door) — is code-complete with 142 unit tests green; runtime verification needs migration 010 + `SUPABASE_SERVICE_ROLE_KEY` (see the Phase 9 section below). Milestones B–H pending.**

---

## Phases

| Phase | Delivers | Features | Status |
|---|---|---|---|
| 0 — Definition | Product spec + feature inventory (P0/P1/P2) | — | ✅ Done |
| 1 — Architecture | System design: Next.js + Supabase + n8n + Gemini/Gmail | — | ✅ Done |
| 2 — Database / CRM | Supabase schema, RLS policies, seed data, minimal verification app | F-015, F-016 | ✅ Done |
| 3 — Core admissions automation | n8n pipeline end-to-end: intake → validate → Gemini analysis → score/classify → CRM write, with per-step logging and retries | F-001–F-014 | ✅ Done (verified) |
| 4 — Finish the P0 pipeline | AI email draft + Gmail send (dry-run), counselor assignment + follow-up task, notification, dedicated error workflow | F-008–F-011, F-013 | ✅ Done (verified) |
| 5 — Dashboards | Lead Dashboard, Lead Detail view, Automation Logs Viewer, Ops/Admin overview | F-017–F-019, F-025 | ✅ Done (verified) |
| 6 — Department AI tools | Marketing (content generator, campaign analyzer), Academic (lesson planner, quiz generator), Operations (report generator) — Gemini called from Next.js directly | F-020–F-024 | ✅ Done (verified) |
| 7 — Governance | AI Tool Lab, AI Tool Evaluation, employee training / workshop / SOP pages (+ their two tables) | F-026–F-030 | ✅ Done (verified) |
| 8 - Polish & verification | E2E failure-case suite (8/8), docs consolidation + post-mortems, UX shell (sidebar, icons, tokens), a11y pass | - | ✅ Done |
| + Telegram parent chatbot | Lead-capture chatbot: n8n workflow + launcher stack (tunnel, self-registration, watchdog) + live lead channel | - | ✅ Done (demo-grade, see TELEGRAM-CHATBOT.md) |
| 9 — Agentic Core (Milestone A) | Governed agent runtime: central tool registry, durable run state, execution trace, permission engine, guardrails + approval + kill switch, first governed tool set, REST front door | — | ✅ Done (verified live 2026-09-13: completed 9-step run — search → inspect 3 leads → create_task → finish; 142 unit tests green) |

---

## Phase 4 (done ✅)

Extends the existing workflow after `CRM: insert analysis`:

1. **Counselor assignment** — picks an admissions counselor deterministically (hash of the lead id over the sorted counselor list — stable per lead, spreads across counselors) and PATCHes the lead.
2. **F-010 Follow-up task** — a `tasks` row (priority: HOT→high / WARM→medium / COLD→low, due in 24h/72h) assigned to that counselor.
3. **F-011 Counselor notification** — a `notifications` row (`type: new_lead`) for the counselor.
4. **F-008 AI email draft** — Gemini drafts the first-touch email from the analysis; a schema gate rejects malformed drafts (the run still succeeds — F-008 is logged failed, F-009 skipped).
5. **F-009 Automated email** — `GMAIL_DRY_RUN=true` (default) records the email in `sent_emails` with `status: 'dry_run'` and never sends. Set `GMAIL_DRY_RUN=false` + the three `GOOGLE_*` vars to send for real via the Gmail API.
6. **F-013 Error workflow** — `n8n/error-handler.json` (Error Trigger) records any unhandled crash as a failed `automation_runs` row; the pipeline's `errorWorkflow` setting points at its id.

### Phase 4 lessons learned (worth keeping for Phase 5+)

- **Never read a 2-output IF node via `$('Node').first()`** — it resolves to output 0 (the `true` branch), so on the `false` path it reads empty and silently yields defaults. Read a preceding **single-output** node instead (we switched `Build step log`, `Gmail: send`, and `Record email: sent` from `Email ok?` → `Email schema check`).
- **n8n's `{{ }}` expression parser is not real JS** for complex payloads — build big objects in a **Code node** and give the HTTP node a trivial `={{ JSON.stringify($json.rows) }}`. (This caused the `JSON parameter needs to be valid JSON` failure.)
- **Closing a terminal does not kill n8n on Windows** — the spawned `n8n start` node process survives as an orphan holding port 5678. Use `Ctrl+C`, or `npm run push:n8n -- --kill` to clean up automatically.
- **n8n must be started via `npm run n8n`** — starting it any other way skips the `.env` secrets, and every webhook call fails with `401 invalid webhook secret`.
- **n8n's HTTP Request node does NOT auto-set `Content-Type: application/json`** even when `specifyBody: "json"` is used — PostgREST rejects array bodies (e.g. the `Log pipeline steps` batch insert) with a generic 400 unless the header is added explicitly. Full post-mortem in the project's internal lessons-learned register.
- **PostgREST bulk insert requires every row in the array to have an IDENTICAL key set** — absent fields must be explicit `null`s, not omitted keys (else: `All object keys must match`, 400). This bit us twice: once in Phase 3's `Log pipeline steps`, then again when the Phase 4 `Build step log` rewrite reintroduced it. If you add a column-like field to any row, add it to **all** rows.
- **Match identifiers exactly across systems** — the F-013 error handler originally filtered `automation_runs` by n8n's display name (`Admissions Lead Pipeline`), but the column stores the hardcoded value `admissions-lead-pipeline`. Zero matches, no error. When a filter matches nothing, suspect an identifier mismatch first.
- **Fix `_retryCount` propagation end-to-end or the AI retry loop never terminates** — `Count retry` increments it, but any Code node that rebuilds its output from scratch (like `Prepare AI prompt`) silently drops it. `Retry AI?` then always sees `0` and loops forever. Rule: when a node's output is built by hand, carry the loop state through explicitly.
- **`retryOnFail` is a node-level property, not an `options` key** — inside `parameters.options` it is silently ignored. Put `retryOnFail`/`maxTries`/`waitBetweenTries` at the node level.
- **PowerShell pitfalls when editing workflow JSON**: `-replace` is regex (a failed match succeeds silently — verify the diff), nested arrays unroll (build `main: [[…]]` branch arrays carefully), and `ConvertTo-Json` round-trips n8n files cleanly only with `-Depth 100`.

### To apply & verify

1. Stop n8n → `npm run push:n8n` (imports **both** `n8n/*.json` and publishes them) → `npm run n8n`.
2. Submit a HOT test lead → expect: green card, and in Supabase — lead assigned, a `tasks` row, a `notifications` row for the counselor, a `sent_emails` row with `status: 'dry_run'`, and **8** `automation_run_steps` rows (F-003…F-011).
3. Sign in as `counselor@demo.dev` → notifications counter > 0.
4. Flip `GMAIL_DRY_RUN=false` only after adding `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` to `.env` (restart n8n after) — then real emails send.

---

## Phase 5 (done ✅) — Dashboards

**F-017** Lead Dashboard, **F-018** Lead Detail, **F-019** Automation Logs Viewer, **F-025** Ops/Admin overview — built and verified (matrix below).

Quality bar (agreed with the project owner): **correctness, robustness, verified behavior, clean code, proper error handling, smooth running, easy for non-tech users. Function-only styling — no visualizations.** Delivered: every Supabase `error` checked with readable messages, every URL param whitelisted server-side (unknown values fall back to defaults), `notFound()` for RLS-hidden resources (no existence leak), shared helpers (`lib/auth.ts`, `lib/format.ts`) instead of copy-paste, typecheck after every stage, one commit per stage.

Decisions kept: plain Tailwind (shadcn remains a documented deviation) · routes `/runs` + `/admin` · notifications stay a counter · all reads via the RLS client (AD-10 holds) · no schema / n8n / env changes.

### Future enhancements (documented, deliberately not built)

- Lead Dashboard **status filter** (new/contacted/converted/lost) and **score sort** — spec-minimum filters shipped
- In-app **notifications list + mark-read** UI (F-011 is satisfied by the counter + pipeline rows)
- **shadcn/ui** migration if the UI ever grows beyond prototype scope

### Verification matrix (exit criteria — walk this as admin, counselor, operations, marketing)

| Role | `/` Dashboard | `/leads/[id]` | `/runs` | `/admin` |
|---|---|---|---|---|
| admin | all leads, runs visible, filter pills work | opens any lead | access, pagination works | access |
| counselor (admissions) | assigned leads only, runs blocked (RLS "−"), notifications counter > 0 | assigned → opens; unassigned → 404 | gated page | gated page |
| operations | all leads, runs visible | opens any lead | access | access |
| marketing / teacher | empty leads table (by-design RLS message), runs blocked | 404 | gated page | gated page |

Live-data spot checks: `/runs/[id]` for a verified run shows **8** step rows with collapsible payload snapshots; the Phase 4 verification leads (`Fix Verification` HOT 95, `Test User` COLD 25) appear with correct categories.

---

## Hardening (Phase 5.5 — before Phase 6)

Resolves the open High/Medium risks from the project's internal risk register. Order is deliberate: R-02 first, then R-01, then features.

### The AI convention (R-02 — closes first)

**Every Gemini call in this app goes through `lib/gemini.ts`. No feature may `fetch()` Gemini directly.** The module owns:

1. **JSON mode** — `responseMimeType: 'application/json'` always on.
2. **Truncation-aware retry** — a response not ending in `}`/`]` is retried (up to 3 attempts, 2s/4s backoff); HTTP 429/5xx and network errors are transient; 4xx, empty candidates, unparseable JSON and schema mismatches are **permanent** (retrying garbage returns garbage — same policy as the n8n Schema-check node).
3. **Per-tool schema validation** — pure validator functions in `lib/ai/schemas.ts`, unit-tested without network. `validateLeadAnalysis` is the reference implementation.
4. **Uniform error normalization** — failures map to `{ code, message, retryable }` where `message` is client-safe (R-03); full detail goes to server logs only.
5. **Generation logging** — every call writes one `ai_generations` row (migration 004) with tool id, department, model, status, duration, sanitized inputs. Best-effort: logging never breaks a tool response.

Test policy (R-01): Vitest unit tests for all pure logic (validators, filters, helpers, rate limiter) run via `npm test`; a small `npm run test:integration` path exercises the real Gemini API end-to-end (explicit invocation only — quota-aware). Playwright (login + RLS matrix) lands once the Phase 6 foundation is stable.

### Stages

| # | Delivers | Closes |
|---|---|---|
| H1 | `lib/gemini.ts` + `lib/ai/schemas.ts` + migration 004 + this convention | R-02 |
| H2 | Error hygiene: server-side `console.error` + generic client messages + correct status codes on `/api/leads` and all Phase 5 error blocks | R-03 |
| H3 | Vitest setup, pure-module extraction (`lib/roles.ts`, `lib/filters.ts`), unit tests, `npm run test:integration` path | R-01 |
| H4 | In-memory per-user rate limiting on `POST /api/leads` and `/api/ai/*` | R-05 |

Known accepted tradeoff: rate limiting is in-memory (resets on restart, per-instance) — demo-adequate per the risk doc.

---

## Phase 6 (done ✅) — Department AI Tools

Five single-purpose Gemini tools, one per department need (F-020–F-024) — **built and verified** (matrix below). Per
**AD-2** they bypass n8n: Next.js calls Gemini directly via the **AI convention**
(`lib/gemini.ts` — JSON mode, truncation-aware retry, per-tool validators in
`lib/ai/schemas.ts`, client-safe errors, `ai_generations` logging via the shared
`runAiTool` handler). Every output is a **draft for human review** — nothing auto-sends,
auto-persists downstream, or creates tasks.

Delivered: `/api/ai/*` scaffolding (session JSON-401, server-enforced role gates from the
`AI_TOOLS` registry, per-user rate limit, success+failure logging) · input whitelists and
length caps on every route · empty-payload short-circuits before any AI call · F-024 fed
by real Supabase aggregates · `/admin` dept-activity card reading `ai_generations` ·
61 unit tests + 3 integration tests green · production build green (16 routes).

### Verification matrix (P6-7 exit criteria)

| Role | Sees tools | Can generate |
|---|---|---|
| admin | all 5 tool pages + nav | all |
| marketing | Content Generator, Campaign Analyzer | those 2 |
| teacher | Lesson Planner, Quiz Generator | those 2 |
| operations | Report Generator + Overview usage card | Report Generator |
| counselor | no AI-tool nav | no (routes 403) |

Every generation (success or failure) writes an `ai_generations` row; unit
tests for each tool's validator; integration smoke for one representative
tool.

---

## Path to production (when we decide to deploy)

Everything is written swap-ready — nothing here blocks the demo, and none of it
needs doing until the deploy decision is made.

1. **Deploy target** — Vercel for the Next.js app (zero-config for App Router
   + Supabase), a **hosted n8n** instance (n8n Cloud or a small VPS) for the
   pipeline and the Telegram webhook. Telegram needs a stable HTTPS URL — a
   hosted n8n removes localtunnel entirely.
2. **Shared rate limiter** — the limiter is already behind the `RateLimiter`
   interface in `lib/rate-limit.ts` (single swap point, `rateLimiter` export).
   Swap the in-memory implementation for Redis/Upstash (or a Supabase table)
   when running more than one app instance.
3. **Shared AI response cache** — same story: `lib/ai/cache.ts` is in-memory
   (10-min TTL, 50 entries). Move it to the same shared store as the rate
   limiter; call sites don't change.
4. **Webhook secret rotation** — `N8N_WEBHOOK_SECRET` guards the pipeline
   webhook; the Telegram trigger uses n8n's per-workflow secret
   (`<workflowId>_<triggerNodeId>`). Rotate by updating `.env` + the n8n
   credential and restarting (see `TELEGRAM-CHATBOT.md` for the mechanics).
5. **Observability already in place** — `/api/health` reports rate-limiter
   state and the last AI generation's latency/cached flag; `ai_generations`
   logs every call. Wire uptime monitoring to the health endpoint.

Deliberately NOT in production scope: streaming AI responses (measure first),
workflow JSON changes, or any `.env` migration.

---

## Future implementations (backlog)

Ideas parked for future versions — nothing here blocks the demo. Cross-links:
deploy-time items also appear in **Path to production** (above); the Phase 5
"Future enhancements" list remains the authoritative record of what was
deliberately deferred there.

### 1. UX/UI (recommended for version 0.3)

| Idea | Why | Existing hook |
|---|---|---|
| Full UI redesign — blue-slate palette, design tokens, shared component layer | Biggest user-perceived win; pages still use plain prototype Tailwind | Phase A groundwork already committed (sidebar shell + tokens) |
| Streaming AI responses in tool pages | A generation currently feels frozen for 5–15s; streaming shows progress live | Pairs with the AI response cache + `durationMs`/`cached` already in `lib/gemini.ts` and tool UIs |
| Lead Dashboard status filter + score sort | Spec-minimum filters shipped; these were explicitly deferred | Documented under Phase 5 "Future enhancements" |
| Notifications list + mark-read UI | F-011 is currently just a counter + pipeline rows | Documented under Phase 5 "Future enhancements" |

### 2. Connection / bot stack

| Idea | Why | Notes |
|---|---|---|
| Replace localtunnel with an account-based stable tunnel (Cloudflare Tunnel or ngrok free tier) | Permanently ends the zombie-502 / random-subdomain / IP-confirmation-page problems; stable URL = fewer Telegram re-registrations | Requires one account signup (owner previously declined); localtunnel stack stays as fallback |
| Hosted n8n (n8n Cloud or a small VPS) | Permanent HTTPS webhook for Telegram — bot runs without the laptop on and removes the tunnel entirely | Also on the Path to production list |

### 3. Backend / infrastructure

| Idea | Why | Existing hook |
|---|---|---|
| Apply `supabase/migrations/006_indexes_review.sql` to the live project | APPLIED 2026-09-07 together with 007 (ai_generations user_id default) | Migration file is idempotent, safe to re-run |
| Shared rate limiter (Upstash Redis free tier or Supabase table) | Needed only when running >1 app instance | Single swap point exists: `RateLimiter` interface + `rateLimiter` export in `lib/rate-limit.ts` |
| Shared AI response cache (same store as the limiter) | Same multi-instance requirement | Swap point exists: `lib/ai/cache.ts`; call sites don't change |
| Playwright E2E for the auth/RLS matrix | Role gating (counselor sees assigned only, etc.) is only manually verified | Planned since the hardening phase; unit tests cover pure logic only |
| Per-user daily AI generation budget in DB + admin `ai_generations` trend chart | Currently only a 10/min in-memory rate limit; a daily budget protects the Gemini free-tier quota in real use | `ai_generations` already logs every call with tool + user context |

### Recommended "version 0.3" scope

UX/UI redesign + streaming AI responses — these change how the product
*feels*. Everything else in this backlog is infrastructure that only becomes
necessary at deploy time (see **Path to production**).

---

## Phase 9 — Agentic Core Upgrade (in progress)

Spec: `PHASE_9_AGENTIC_CORE_UPGRADE.md`. Working milestone slicing (agreed 2026-09-13):

| Milestone | Scope | Status |
|---|---|---|
| **A — Governed runtime + reference scenario** | Registry, run state, trace, permissions, guardrails/approval/kill switch, runtime loop, first tools, REST front door (spec items 9.1–9.6 built together) | 🚧 Code complete |
| B — Governed RAG | pgvector + Gemini embeddings, chunking, permission-filtered retrieval with citations (upgrades `search_knowledge`) | ✅ Done (verified live 2026-09-13: SOP-citation run — semantic retrieval of the competitor/refund SOP drove a governed escalation; migration 011 + `npm run ingest:knowledge`) |
| C — Agent behavior evaluation | Scripted-fake-model unit evals in CI + ~10 real-Gemini scenarios on a **schedule** (not per-PR — cost/flakiness), machine-readable results | ✅ Done (verified live 2026-09-13: 9/9 scenarios pass — `npm run evals:agent` → `test-results/agent-evals.json`) |
| D — "Ask X" chat UI | Role-scoped employee chat over the runtime, read tools first | Pending |
| E — REST external surface + MCP adapter | Scoped service identities, rate limits, audit; MCP as a thin second adapter (REST-first decision) | Pending (REST) |
| F — Real external lead trigger | Webhook source with signature validation into the governed pipeline (reuses `webhook-signing.ts`) | Pending |
| G — Multi-agent handoff | One scoped delegation scenario, parent/child traceable runs | Pending |
| H — Persistent infrastructure hardening | Move rate-limiter/cache state into Postgres (spec 9.13) | Pending |

### Milestone A — what landed (2026-09-13)

- **Migration `supabase/migrations/010_agent_core.sql`**: `agent_runs`, `agent_run_steps` (the trace + resume log; `feedback_snapshot` stores the exact model-visible functionResponse so runs reconstruct from DB alone), `agent_approvals`, `agent_runtime_config` (kill switch), `agent_tool_config` (per-tool enable), `knowledge_docs` (seeded SOP set for Milestone-B upgrade). RLS: users read own runs (ops/admin all) — **no user write policies**; runtime writes go through the service-role client so the audit trail is user-tamper-proof (same trust model as n8n).
- **`lib/agent/`**: `registry.ts` (central registry + integrity check), `agents.ts` (agent identity as principal + allowlists + system prompt), `permissions.ts` (user role × agent × tool × policy, pure), `guardrails.ts` (step/time/token caps, per-turn call cap), `store.ts` (durable `AgentStateStore`, Supabase impl), `model.ts` (swappable `AgentModel`), `runtime.ts` (the governed loop: permission check before EVERY execution, approval suspension + resume, denied-call feedback, `finish`/`escalate_to_human` as the only successful terminations, no chain-of-thought persisted).
- **Tools (registry entries, versioned)**: `get_lead`, `search_leads`, `get_lead_history`, `create_task`, `notify_counselor`, `prepare_email` (dry-run record; approval required when `GMAIL_AGENT_DRY_RUN=false`), `search_knowledge` (role-scoped ILIKE over `knowledge_docs` until Milestone B), `escalate_to_human`, `finish`.
- **API**: `POST/GET /api/agent/runs`, `GET /api/agent/runs/[id]` (run + steps + approvals, RLS-scoped), `POST /api/agent/approvals/[id]` (ops/admin decision → auto-resume), `GET /api/agent/tools` (registry introspection).
- **Tests**: 42 new unit tests (registry integrity, permission matrix, guardrails, full loop scenarios incl. approval approve/reject resume, kill switch, step cap) — suite 142/142 green, typecheck strict.

Key design decisions: runtime lives **inside the Next.js app** (no new service); tool args/results validated by hand-rolled pure validators (repo convention — no Zod); reads run under the **requester's RLS client**, governed writes under the service-role client **after** resource visibility is proven against the requester's scope; resumed loops always re-evaluate permissions under the **original requester's persisted `user_role`** (never the approver's); agent turns bypass the AI Gateway (JSON-mode only) via `generateAgentTurn` in `lib/gemini.ts`.

### Milestone A runbook (verified live 2026-09-13)

1. ~~Run `supabase/migrations/010_agent_core.sql` in the Supabase SQL Editor (idempotent).~~ ✅ applied
2. `.env` already carries `SUPABASE_SERVICE_ROLE_KEY` (same secret the seed/e2e scripts have always used) — the agent runtime reads that exact variable via `lib/supabase/admin.ts`. Nothing to add. Optionally set `GMAIL_AGENT_DRY_RUN=false` to force the email approval flow. ✅ present
3. Live verification: `AGENT_VERIFY=1 npx playwright test tests/e2e/agent-verify.spec.ts` — logs in as `counselor@demo.dev`, fires a real goal through `POST /api/agent/runs`, prints the trace, and auto-approves via admin if the loop suspends. First verified run: **completed, 9 steps** (`search_leads` → inspect 3 leads → `create_task` → verified `finish`), ~40k tokens in (cap 60k), all permissions `allowed`, counselor-scoped.
4. Kill switch check (manual): `update agent_runtime_config set kill_switch = true;` → new runs fail with `KILL_SWITCH` before any model call.

Gotcha fixed during verification: this Gemini generation returns `thought_signature` on functionCall parts and REQUIRES it echoed back on replay — the runtime therefore persists the RAW model parts per step (`feedback_snapshot.modelParts`) and replays them verbatim instead of rebuilding model turns from name+args.

### Milestone B — governed RAG (done + verified live 2026-09-13)

- **Migration `011_knowledge_rag.sql`**: pgvector, `knowledge_chunks` (`vector(768)`, HNSW cosine index, unique per doc+index), RLS mirroring the parent doc, and `match_knowledge_chunks(query_embedding, match_count, p_role)` — the role scope (`allowed_roles` contains 'all' or the caller's role) is enforced in SQL; the tool re-checks (defense in depth).
- **`generateEmbedding()`** in `lib/gemini.ts` — `gemini-embedding-001` (the retired `text-embedding-004` is 404 on current keys) with `outputDimensionality: 768` pinned to the column; same error conventions as every AI call.
- **`npm run ingest:knowledge`** (`scripts/ingest-knowledge.mjs` + pure `scripts/knowledge-chunk.mjs` shared with the unit tests): docs → ~800-char overlapping chunks → embed → replace doc's chunks. Re-runnable; fails loudly.
- **`search_knowledge` v2.0.0** — same contract (role scope, citations, content-is-data), now semantic: embed query → cosine match ≥ 0.3 → top-3 cited chunks; the v1 ILIKE search remains as automatic keyword fallback when embeddings are unavailable or empty.
- **Verified live**: agent goal mentioning competitor/refund → `search_knowledge` retrieved the exact SOP ("escalate when the lead mentions competitor comparison or refund") via vector match, then notified the counselor per the SOP and cited it in `finish.verification`. 7 steps, ~30k tokens.

Gotchas: `text-embedding-004` no longer exists on current API keys — use `gemini-embedding-001` + `outputDimensionality: 768`. And Windows orphan lesson strikes again: a `TaskStop`/terminal close can leave `node.exe` holding :3000 — check `netstat -ano | grep :3000` and `taskkill //PID <pid> //F` before assuming the server restarted with fresh code.

### Milestone C — agent behavior evaluation (done + verified live 2026-09-13)

- **Versioned scenario set** `tests/e2e/agent-eval-scenarios.json` (v1.0.0, 9 cases): straightforward lead, missing-info no-invention, unknown-lead bounded stop, disabled-tool denial + re-plan, real-send approval flow (approve → resume → execute), prompt injection inside a retrieved doc, duplicate protection, kill switch, wrong-role 403. Assertions are tolerant of model variance: allowed/forbidden tool SETS + required final status, never exact sequences.
- **Pure scorer** `tests/e2e/helpers/agent-eval-score.mjs` — maps a run trace to `{pass, violations[], toolCalls, tokens}`; unit-tested (162 suite green). Runner: `tests/e2e/agent-evals.spec.ts` (opt-in via `AGENT_EVALS=1`), fixtures created/torn down per run via service-key REST, results artifact `test-results/agent-evals.json` with scenario-set version + pass rate + token spend. **Run: `npm run evals:agent` — scheduled/on-demand, never per-PR.**
- **Two runtime hardenings that fell out of the evals** (exactly what evals are for):
  1. **Per-turn conversation replay**: Gemini sometimes returns a functionCall WITHOUT its `thought_signature` on the call part (the signature rides on sibling parts) — replaying only the call part gets HTTP 400. The runtime now persists the FULL requestable part list of each model turn (grouped by a `turnId` inside `feedback_snapshot`) and replays it verbatim.
  2. **Repeat-call loop guard** (`REPEAT_CALL_LIMIT` in guardrails): the 3rd consecutive identical call (same tool + args) is refused with `REPEATED_CALL` feedback instead of executing — an eval run caught the model burning its step budget re-observing the same lead 4×.
- Also: `POST /api/agent/runs` accepts `requireApproval: true` (requester opts INTO the approval gate for real-send mode — can only add governance, never remove it); eval runs upsert the kill-switch row to `false` at START (never trust the previous run's cleanup).

---


---

## Hardening pass (post-Phase 8) — security + scale + design notes for the next agent

Everything below is implemented and verified (statuses tracked in the project's
internal risk register). This section is the handoff brief for whoever extends this project.

### Security hardening that landed

- **R-04 closed — HMAC-signed webhooks.** `lib/webhook-signing.ts` signs
  `${timestamp}.${JSON.stringify(payload)}` with HMAC-SHA256; `/api/leads`
  sends a `{timestamp, signature, payload}` envelope; the n8n
  `Validate & authorize` node verifies it with Web Crypto (same algorithm on
  both sides) and enforces a 5-minute replay window. The static
  `x-webhook-secret` header remains as layer 1.
- **R-08 closed — least-privilege pipeline role (migration 008).** Postgres
  role `n8n_pipeline` has grants only on the 7 pipeline tables (no delete, no
  other tables). n8n authenticates with a JWT that `scripts/start-n8n.mjs`
  mints (HS256, `role: n8n_pipeline` claim, signed with `SUPABASE_JWT_SECRET`
  from .env) — PostgREST acts as that role. Fallback to service-role writes
  when the secret is absent so setup never dead-ends.
- **R-11 closed — Telegram webhook secret is env-backed.** The chatbot
  trigger node reads `$env.TELEGRAM_WEBHOOK_SECRET`; the launcher
  (`start-bot.mjs`) reads the same value for setWebhook/watchdog healing.
  Nothing depends on workflow/trigger ids surviving a re-import.
- **R-01 fully closed — Playwright RLS matrix** (`tests/e2e/rls-matrix.spec.ts`,
  `npm run test:e2e`): 6 tests over 5 roles covering redirects, API auth,
  page visibility, nav gating, server-side Not-allowed pages, and
  no-existence-leak on hidden leads. Requires dev server + seeded users.

### Design notes for the next agent (deferred deliberately — do not improvise)

1. **Multi-LLM routing (supersedes the old "single provider" decision).**
   Why: quota spread, cost control, deprecation insurance. Design: refactor
   `lib/gemini.ts` into `lib/ai/providers/` with two adapters — `gemini.ts`
   (native REST, code already exists) and `openai-compatible.ts` (covers
   OpenAI, DeepSeek, Qwen, Groq, local models) — behind a registry; keep the
   generateJSON convention (validate/retry/cache/log) untouched for callers;
   route via one env-backed JSON table `{ "<toolId>": { provider, model } }`
   with a default fallback. Cache keys already include the model; logging
   already records it. Do NOT touch validators. n8n can stay on Gemini or
   migrate node-by-node.
2. **Prompt versioning.** 7+ live prompts (5 tool routes + 2 n8n nodes) are
   inline strings. Step 1: extract to `lib/ai/prompts/` as constants with
   explicit `vN` labels; add `prompt_version` column to `ai_generations`
   (migration) and log it; convention: changing a prompt = bump its version.
   Step 2 (optional): eval script that runs a fixed lead set through old/new
   prompts and diffs schema-pass rate. Do not alter prompt text while
   extracting — byte-identical, or outputs shift.
3. **Next 16 upgrade — turnkey checklist.** Known breaks for THIS codebase:
   `middleware.ts` → `proxy.ts` rename; Turbopack default (delete `.next`
   and verify CSS cold-start — see R-07); `@supabase/ssr` 0.6 → 0.12 cookie
   API changes (touches `lib/supabase/*` + `middleware.ts`); Node >= 20.9
   (already on 22). Sequence: upgrade next + ssr in one commit → typecheck
   → 66 unit tests → 3 integration → 6 Playwright E2E → production build
   → browser matrix. Rollback: `git revert` the single commit.

### Scale readiness (100 concurrent counselors, 24/7 intake)

The code architecture is scale-ready; the deployment is the work. Honest map:

| Layer | At 100 users | Change needed |
|---|---|---|
| Next.js app | fine (stateless routes) | host it (Vercel/VPS) |
| Supabase | fine for this write volume | paid tier (free pauses + connection caps) |
| Gemini | first bottleneck — free tier ~10 req/min | multi-LLM routing (note 1) + paid tier |
| n8n | works, fragile at scale | queue mode (Redis + Postgres + workers) — deployment re-architecture |
| limiter/cache | wrong for multi-instance | Redis backend behind the existing `rateLimiter`/cache swap points (1-file change) |

No app rewrite is required for any of it — the swap points were built for
exactly this. Until deployed, these stay documented decisions.

---

## Satellite platform — roadmap for future sessions (2026-09-07)

The Copilot is the first consumer of a live **platform of specialized
AI services** that integrate over APIs — deliberately NOT shared-database
satellites (schema coupling at scale is a nightmare). Each satellite is its
own repo with its own DB; integration is versioned REST + API keys.

### Tier 1 — platform core (build order)

| # | Service | Purpose | API surface (draft) |
|---|---|---|---|
| A | **AI Gateway** (satellite #1 — BUILT (separate repo; Copilot adapter wired, dormant via commented AI_GATEWAY_URL)) | Single metered entry point for every LLM call: multi-provider routing (gemini + openai-compatible), per-key quotas, cost metering, caching, prompt-version pinning. Productizes the Copilot's `lib/gemini.ts` convention | `POST /v1/generate` · `GET /v1/usage` · `GET /v1/health` |
| B | **PromptLedger** (satellite #2 - BUILT & LIVE) | Registry-owned prompts: every AI tool route, the pipeline qualification prompt, and the email/chat prompts fetch their LIVE system prompt at runtime (lib/promptledger.ts + prompts/ fallbacks); fail-closed on registry errors; run traces + token usage emitted to POST /api/runs | GET /v1/prompts/:tool · run-trace sink |
| B | **Eval & Replay Studio** | Golden-set regression: same input → old vs new model/prompt, diff schema-pass rate/latency/cost/quality, promote/rollback verdicts | `POST /v1/runs` · `POST /v1/compare` |
| C | **Event Bus / Webhook Relay** | Durable inter-project events (lead.created, run.failed, approval.requested) with retries + DLQ — kills the tunnel-inbound fragility pattern | `POST /v1/events` · subscriptions API |
| D | **HITL Approval Service** | Generic approve/reject + audit trail + timeout escalation, served via Telegram + web — unlocks real email sends safely | `POST /v1/approvals` · decision API |

### Tier 2 — intelligence layer (reads Tier 1 streams)

| # | Service | Purpose |
|---|---|---|
| E | **Failure Intelligence** | Consumes failure events; clusters patterns (429 storms, schema drift, auth rot); morning digest with suggested fixes |
| F | **Ops Copilot (meta)** | An LLM answering ops questions over these APIs: "why did run X fail?", "which tool burned quota this week?" |
| G | **Control Plane UI** | Fleet health, spend, eval reports, approvals inbox — thin dashboard over the APIs |

### Tier 3 — delivery assets

Demo Factory (use-case → n8n skeleton + sample data + diagram + ROI sheet) ·
Local-First Sandbox (docker-compose: Ollama + Gateway + n8n + vector DB —
trivial once the Gateway ships an `openai-compatible` adapter) ·
Client Onboarding Kit.

### AI Gateway build plan (satellite #1 — locked)

New repo `ai-gateway`, public, portfolio-framed; **own Supabase project**
(`api_keys`, `requests`, `routing`); Next.js API routes; stack and conventions
identical to the Copilot (JSON mode, truncation-aware retry, schema gate,
client-safe errors — ported from `lib/gemini.ts`).

Stages: **G0** scaffold + own DB + `/v1/health` · **G1** Gemini adapter +
routing table · **G2** API-key auth + request metering · **G3**
`POST /v1/generate` + `GET /v1/usage` · **G4** Copilot migration - DONE (thin
`lib/gateway-client.ts`, env-flag fallback — zero-risk rollout) · **G5** cost
metering + usage dashboard · **G6** `openai-compatible` adapter (multi-LLM
routing fulfilled AT THE GATEWAY layer - the Copilot stays
provider-agnostic by design) · **G7** docs + consumer onboarding guide.
Session-one scope: G0–G3. Scope guards: no streaming/A-B UI/multi-tenant/
events in v1; n8n stays on direct Gemini.

### Agentic function-calling — recommendation (not scheduled)

The Copilot deliberately has NO tool calling / agent orchestration: every
decision is deterministic code ("the model proposes, code disposes") —
auditable and predictable by design. If agentic behavior is ever wanted,
the **Telegram chatbot is the sandbox** (only surface with free-form input):
register tools (`lookupCourses`, `checkLeadStatus`, `createTask`), let the
model route, gate every tool result with the same schema discipline. Route
it through the AI Gateway (`/v1/agent` + tool registry) so agent runs are
metered. Do NOT add agentic routing to the pipeline or fixed tools.

### Prerequisite note

Token-usage capture: log Gemini `usageMetadata` (prompt/candidate counts —
present in every response) - CAPTURED into run traces (ac1a687)) into `ai_generations`.
~15 lines; unlocks cost-per-run dashboards and cost-aware eval scoring.
## Key commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js app at http://localhost:3000 |
| `npm run n8n` | n8n at http://localhost:5678 — **always start n8n this way**; it loads the `.env` secrets (Supabase, Gemini, webhook secret) into `$env` |
| `npm run push:n8n` | After editing `n8n/*.json`: run this — imports + publishes **all** workflow files via the n8n CLI (no API key). If n8n is still running it refuses; add `--kill` to stop the leftover process automatically. Restart n8n afterwards. |
| `npm run seed:users` | One-time: creates the 5 demo logins (password `demo1234`) |

Demo logins: `admin@` / `operations@` / `counselor@` / `marketing@` / `teacher@demo.dev` — password `demo1234`.

---

## Troubleshooting (the two classics)

- **`401 invalid webhook secret`** → the running n8n was started *without* the project `.env` (so `$env.N8N_WEBHOOK_SECRET` is empty). Stop it and start with `npm run n8n`.
- **`Pipeline unreachable`** → n8n isn't running, or the workflow isn't published. Start with `npm run n8n` / check Publish in the editor.

---

## Doc index

| Doc | Purpose |
|---|---|
| `ROADMAP.md` | This page — the plan for all phases |
| `PRODUCT_SPEC.md` | Product definition: problem, users, processes, priorities |
| `FEATURES.md` | All 30 features with IDs, priorities, and live status |
| `WEAK_POINTS_AND_RISKS.md` | (local-only) Living risk register from project reviews (R-01…R-10 with status) |
| `ARCHITECTURE.md` | Canonical architecture: components, data flow, design decisions |
| `LESSONS-LEARNED.md` | (local-only) Every error hit, symptom → root cause → lesson — the study doc |
| `WORKFLOW.md` | The three n8n workflows (pipeline / chatbot / error handler) + operational notes |
| `AI_DESIGN.md` | AI design: model pin, per-use-case schema contracts, scoring thresholds |
| `TELEGRAM-CHATBOT.md` | Bot runbook: two-layer stack, troubleshooting |
| `archive/AI Operations Copilot — Phase 1 System A.md` | Original long-form architecture (AD-1…AD-12) |

---

## Final status judgment (post-revision, 2026-09-07)

**Verdict: portfolio-ready through Phase 8.** All 30 features complete and
working at runtime; the security-hardening pass (HMAC-signed webhooks,
least-privilege pipeline role, env-backed bot secret) is implemented with the
convention untouched; the auth/RLS matrix is now automated (Playwright 6/6);
every open risk is either fixed or carries a turnkey plan in
[Hardening pass](#hardening-pass-post-phase-8--security--scale--design-notes-for-the-next-agent).

**Verification state:** 74 unit + 3 live-Gemini integration + 6 Playwright E2E
tests green; production build green; typecheck strict; workflow JSONs valid;
`node --check` clean on all 8 scripts.

**Deliberately open (documented, not forgotten):** Next 16 major upgrade
(turnkey checklist in the hardening section), multi-LLM provider routing
(design note), prompt versioning (design note), shared limiter/cache backends
(swap points exist), Cloudflare/domain for a stable bot URL. None are code
debts — each is a decision awaiting deployment need.

The remaining honest limitation: free/local infrastructure (single n8n
instance, free-tier Gemini, in-memory caches). The swap points and the scale
map above make that a deployment checklist, not a rewrite.
