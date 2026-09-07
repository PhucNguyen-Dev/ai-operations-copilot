# Roadmap — AI Operations Copilot

One page for the whole project plan: what each phase delivers, where we are, and what's next.
Details live in the other docs — **spec:** `PRODUCT_SPEC.md` · **feature list + status:** `FEATURES.md` · **architecture:** `ARCHITECTURE.md` (long-form original in `archive/`).

**Current status: Phase 7 done ? (governance, F-026-F-030) and Phase 8 done ? (E2E failure-case suite 8/8, docs consolidation, UX shell, a11y pass), plus the Telegram parent chatbot (n8n workflow + launcher stack - see docs/TELEGRAM-CHATBOT.md). All 30 features complete. Post-8 hardening landed (AI response cache, swap-ready rate limiter, health observability, generation-log fix); Playwright RLS matrix is the main open item (see backlog).**

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
- **n8n's HTTP Request node does NOT auto-set `Content-Type: application/json`** even when `specifyBody: "json"` is used — PostgREST rejects array bodies (e.g. the `Log pipeline steps` batch insert) with a generic 400 unless the header is added explicitly. See [`fix-pipeline-content-type.md`](fix-pipeline-content-type.md) for the full post-mortem.
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

Resolves the open High/Medium risks from [`WEAK_POINTS_AND_RISKS.md`](WEAK_POINTS_AND_RISKS.md). Order is deliberate: R-02 first, then R-01, then features.

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


---

## Hardening pass (post-Phase 8) — security + scale + design notes for the next agent

Everything below is implemented and verified (see WEAK_POINTS_AND_RISKS.md for
statuses). This section is the handoff brief for whoever extends this project.

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
| `WEAK_POINTS_AND_RISKS.md` | Living risk register from project reviews (R-01…R-10 with status) |
| `ARCHITECTURE.md` | Canonical architecture: components, data flow, design decisions |
| `LESSONS-LEARNED.md` | Every error hit, symptom → root cause → lesson — the study doc || `WORKFLOW.md` | The three n8n workflows (pipeline / chatbot / error handler) + operational notes |
| `AI_DESIGN.md` | AI design: model pin, per-use-case schema contracts, scoring thresholds |
| `TELEGRAM-CHATBOT.md` | Bot runbook: two-layer stack, troubleshooting |
| `TELEGRAM-INCIDENT-2026-09-07.md` | Post-mortem of the bot outage and the final webhook architecture |

| `archive/AI Operations Copilot — Phase 1 System A.md` | Original long-form architecture (AD-1…AD-12) |
| `archive/fix-pipeline-content-type.md` | Post-mortem: missing `Content-Type` on Supabase POSTs caused 400 on the array-body `Log pipeline steps` node |

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
