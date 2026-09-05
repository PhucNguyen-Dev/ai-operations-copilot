# Roadmap — AI Operations Copilot

One page for the whole project plan: what each phase delivers, where we are, and what's next.
Details live in the other docs — **spec:** `PRODUCT_SPEC.md` · **feature list + status:** `FEATURES.md` · **architecture:** `AI Operations Copilot — Phase 1 System A.md`.

**Current status: Phase 4 done ✅ — the P0 admissions pipeline (F-001–F-016) is complete end-to-end and verified live (HOT + COLD leads, validation rejection, all 8 step rows logged, zero zombie runs). Phase 5 (dashboards) — in progress.**

---

## Phases

| Phase | Delivers | Features | Status |
|---|---|---|---|
| 0 — Definition | Product spec + feature inventory (P0/P1/P2) | — | ✅ Done |
| 1 — Architecture | System design: Next.js + Supabase + n8n + Gemini/Gmail | — | ✅ Done |
| 2 — Database / CRM | Supabase schema, RLS policies, seed data, minimal verification app | F-015, F-016 | ✅ Done |
| 3 — Core admissions automation | n8n pipeline end-to-end: intake → validate → Gemini analysis → score/classify → CRM write, with per-step logging and retries | F-001–F-014 | ✅ Done (verified) |
| 4 — Finish the P0 pipeline | AI email draft + Gmail send (dry-run), counselor assignment + follow-up task, notification, dedicated error workflow | F-008–F-011, F-013 | ✅ Done (verified) |
| 5 — Dashboards | Lead Dashboard, Lead Detail view, Automation Logs Viewer, Ops/Admin overview | F-017–F-019, F-025 | 🔨 In progress |
| 6 — Department AI tools | Marketing (content generator, campaign analyzer), Academic (lesson planner, quiz generator), Operations (report generator) — Gemini called from Next.js directly | F-020–F-024 | Planned |
| 7 — Governance | AI Tool Lab, AI Tool Evaluation, employee training / workshop / SOP pages (+ their two tables) | F-026–F-030 | Planned |

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

## Phase 5 (in progress 🔨) — Dashboards

Goal: turn the Phase 2 verification app into the real role-scoped UI — **F-017** Lead Dashboard, **F-018** Lead Detail, **F-019** Automation Logs Viewer, **F-025** Ops/Admin overview.

Quality bar (agreed with the project owner): **correctness, robustness, verified behavior, clean code, proper error handling, smooth running, easy for non-tech users. Function-only styling — no visualizations, no visual polish pass.** Senior-standard engineering: every Supabase `error` checked, every URL param sanitized server-side, `notFound()` for RLS-hidden resources, shared role/filter helpers instead of copy-paste, `npm run typecheck` after every stage, one commit per stage.

Decisions locked: plain Tailwind (consistent with Phases 2–4; shadcn remains a documented deviation) · routes `/runs` + `/admin` · notifications stay a counter (list + mark-read is not a numbered feature) · all reads via the RLS client (AD-10 holds) · no schema / n8n / env changes.

### Stages

| # | Delivers | Verify |
|---|---|---|
| 0 | This plan (done) | — |
| Gate | 4 browser tests from Phase 4 verification (admin / counselor / operations / marketing) | below |
| 1 | `SiteHeader` — role-aware shared nav (Dashboard all · Logs + Overview ops/admin · + New Test Lead admissions/admin), replaces per-page headers | typecheck; pages unchanged |
| 2 | **F-017** Lead Dashboard: category + date filters (spec minimum) as shareable GET links, rows link to detail | filters → correct rows; counselor sees only assigned |
| 3 | **F-018** Lead Detail `/leads/[id]`: analysis, task history, sent email, ops/admin run link; `notFound()` when RLS hides the lead | counselor 404s on unassigned lead; admin sees all |
| 4 | **F-019** Logs Viewer `/runs` (status + date filters, clamped prev/next pagination) + `/runs/[id]` (step rows, collapsible payload snapshots); ops/admin gate | ops/admin OK; counselor/marketing gated |
| 5 | **F-025** Overview `/admin`: lead volume (total, by category, 7d/30d) + automation health (success rate, failed 7d, last failure); honest "arrives with Phase 6" placeholder for dept tool activity | ops/admin OK; others gated |
| 6 | Close-out: FEATURES.md → Done (F-017–F-019, F-025), this section trimmed to a done-note, typecheck + build, full verification matrix | below |

### Future enhancements (documented, deliberately not built now)

- Lead Dashboard **status filter** (new/contacted/converted/lost) and **score sort** — spec-minimum filters ship first
- In-app **notifications list + mark-read** UI (F-011 is satisfied by the counter + pipeline rows)
- **shadcn/ui** migration if the UI ever grows beyond prototype scope

### Verification matrix (Stage 6 exit criteria)

| Role | `/` Dashboard | `/leads/[id]` | `/runs` | `/admin` |
|---|---|---|---|---|
| admin | all leads, runs visible | opens any lead | access | access |
| counselor (admissions) | assigned leads only, runs blocked (RLS "−"), notifications counter > 0 | assigned → opens; unassigned → 404 | gated page | gated page |
| operations | all leads, runs visible | opens any lead | access | access |
| marketing / teacher | empty leads table (by-design RLS message), runs blocked | 404 | gated page | gated page |

Plus live-data spot checks: the HOT run (`Fix Verification`, 95) and COLD run (`Test User`, 25) from the Phase 4 verification appear with correct categories; `/runs/[id]` shows **8** step rows for each.

---

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
| `AI Operations Copilot — Phase 1 System A.md` | Architecture: components, data flow, design decisions (AD-1…AD-12) |
| `fix-pipeline-content-type.md` | Post-mortem: missing `Content-Type` on Supabase POSTs caused 400 on the array-body `Log pipeline steps` node |
