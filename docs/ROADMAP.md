# Roadmap — AI Operations Copilot

One page for the whole project plan: what each phase delivers, where we are, and what's next.
Details live in the other docs — **spec:** `PRODUCT_SPEC.md` · **feature list + status:** `FEATURES.md` · **architecture:** `AI Operations Copilot — Phase 1 System A.md`.

**Current status: Phase 4 done ✅ — the P0 admissions pipeline (F-001–F-016) is complete end-to-end. Phase 5 (dashboards) is next.**

---

## Phases

| Phase | Delivers | Features | Status |
|---|---|---|---|
| 0 — Definition | Product spec + feature inventory (P0/P1/P2) | — | ✅ Done |
| 1 — Architecture | System design: Next.js + Supabase + n8n + Gemini/Gmail | — | ✅ Done |
| 2 — Database / CRM | Supabase schema, RLS policies, seed data, minimal verification app | F-015, F-016 | ✅ Done |
| 3 — Core admissions automation | n8n pipeline end-to-end: intake → validate → Gemini analysis → score/classify → CRM write, with per-step logging and retries | F-001–F-014 | ✅ Done (verified) |
| 4 — Finish the P0 pipeline | AI email draft + Gmail send (dry-run), counselor assignment + follow-up task, notification, dedicated error workflow | F-008–F-011, F-013 | ✅ Done (verified) |
| 5 — Dashboards | Lead Dashboard, Lead Detail view, Automation Logs Viewer, Ops/Admin overview | F-017–F-019, F-025 | Planned |
| 6 — Department AI tools | Marketing (content generator, campaign analyzer), Academic (lesson planner, quiz generator), Operations (report generator) — Gemini called from Next.js directly | F-020–F-024 | Planned |
| 7 — Governance | AI Tool Lab, AI Tool Evaluation, employee training / workshop / SOP pages (+ their two tables) | F-026–F-030 | Planned |

---

## Phase 4 (built 🔨 — needs push + live verification)

Extends the existing workflow after `CRM: insert analysis`:

1. **Counselor assignment** — picks the least-loaded admissions counselor (simple round-robin, spec Assumption 4) and PATCHes the lead.
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

### To apply & verify

1. Stop n8n → `npm run push:n8n` (imports **both** `n8n/*.json` and publishes them) → `npm run n8n`.
2. Submit a HOT test lead → expect: green card, and in Supabase — lead assigned, a `tasks` row, a `notifications` row for the counselor, a `sent_emails` row with `status: 'dry_run'`, and **8** `automation_run_steps` rows (F-003…F-011).
3. Sign in as `counselor@demo.dev` → notifications counter > 0.
4. Flip `GMAIL_DRY_RUN=false` only after adding `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` to `.env` (restart n8n after) — then real emails send.

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
