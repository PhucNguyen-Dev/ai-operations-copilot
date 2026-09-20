# Runbook — local demonstration and operations

Target: a local Next.js app and, when needed, local n8n plus a temporary Telegram tunnel. This is an operator checklist. Offline gates (344/344 unit tests across 29 files, lint, typecheck, guarded build, n8n validation) pass on the current revision, migrations 001–022 are applied in the demonstration Supabase project, and remote CI runs green on `main` via `npm run ci` (real-email delivery still pending the Brevo key — see [TESTING](TESTING.md)).

## 1. Prepare privately

Use Node 22 and npm. Configure a disposable Supabase project and synthetic data. Keep credentials in private local configuration; never paste values into docs, terminal transcripts or issue reports. This consolidation did not inspect environment files.

| Configuration name | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | App database/Auth client |
| `SUPABASE_SERVICE_ROLE_KEY` | Trusted agent persistence/writes and optional Postgres limiter/cache |
| `GEMINI_API_KEY`, optional `AI_MODEL` | Direct Gemini generation/agent calls; model selection |
| `N8N_WEBHOOK_SECRET` | Classic admissions signed intake |
| `LEAD_WEBHOOK_SECRET` | Next.js signed lead webhook; code falls back to `N8N_WEBHOOK_SECRET` |
| `GMAIL_DRY_RUN` | Keep true for n8n email demonstration |
| `GMAIL_AGENT_DRY_RUN` | Agent draft approval policy only; never enables sending |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Optional chatbot/launcher |
| `AI_GATEWAY_URL`, `AI_GATEWAY_KEY` | Optional Gateway for `generateJSON`, not agent turns/embeddings |
| `PROMPTLEDGER_URL`, `PROMPTLEDGER_API_KEY` | Optional prompt retrieval and telemetry |
| `RATE_LIMIT_BACKEND`, `CACHE_BACKEND` | Optional `memory` override; otherwise service credentials select Postgres |

Launcher handling and database credential behavior: `scripts/start-n8n.mjs:20`, `scripts/start-n8n.mjs:40`. Do not assume a custom-role JWT is active merely because migration 008 exists. See [SECURITY](SECURITY.md).

## 2. Database and dependencies

```sh
npm install
```

An install may change local package/lock state; review the resulting diff before any unrelated work. Do not replace another worker's package or launcher changes.

Apply reviewed SQL migrations in filename order on the disposable project, starting at 001 for a fresh database; do not start a fresh database at 010. The inspected sequence is:

| Range | Purpose |
|---|---|
| 001–003 | Base schema, RLS and performance |
| 004–007 | Generation logs, governance and index/default refinements |
| 008–009 | Pipeline-role design and Telegram follow-ups |
| 010–011 | Agent state/approvals and knowledge vectors |
| 012–013 | External API clients and lead source-key uniqueness |
| 014 | Persistent limiter/cache |
| 015 (`015_approval_resume.sql`) | Approval wait accounting, durable execution claims and service-role-only requester reads |
| 016–022 | Agent sessions + clarification, lead action decisions, briefing RPC, email dispatch columns, durable session context |

**Release-gate status:** migration 015 was verified against isolated in-memory PostgreSQL (PGlite 0.5.8, [evidence](evidence/LOCAL_VERIFICATION.md)) and — as of 2026-09-20 — **applied to the hosted Supabase project** and exercised live by the agent eval suite (approval claim → resume → execute). Migrations 016–022 are applied on the same project; new migrations still go through reviewed, ordered application on a disposable project first.

The requester wrapper's `search_path = public, extensions` operator resolution is SQL-verified (`supabase/migrations/015_approval_resume.sql:111`). Execution on the selected hosted database, grants and the role/resource matrix remain pending. Review prerequisites and apply in order; do not blindly replay a wildcard.

### Migration 015 and legacy reconciliation

The backfill binds only an `awaiting_approval` run with no `pending_approval_id` to exactly one still-`pending` approval and its request time. **Legacy decided approvals, multiple pending approvals, or missing pending approvals require manual reconciliation**; the migration does not guess which action is safe to resume.

Before enabling resume, inspect run/approval bindings, existing tool records and any external effects. Preserve the audit evidence; do not clear `execution_claimed_at`, fabricate wait timestamps, or reset decided approvals to force replay. A crash after a claim can leave an effect uncertain even if its trace is incomplete. Stop automated replay, establish whether the effect occurred, and record an operator disposition before any separately authorized new action.

The requester-read RPC validates `auth.users.raw_app_meta_data.role`, not `profiles.role`; a missing/changed authoritative role blocks resume. Verify service-role-only function grants and the role/resource matrix on the selected database. Same-decision endpoint retries preserve the original decision; they do not grant permission to replay claimed work. Conflicting decisions return 409 and self-decisions 403.

Review `supabase/seed.sql` and `supabase/seed_governance.sql` before optional synthetic seeding. `npm run seed:users` provisions demo accounts and changes Auth state; use only the disposable project and manage access privately. `npm run ingest:knowledge` chunks/embeds database knowledge documents, consumes provider quota and changes knowledge rows; it is not automatic ingestion of every Markdown document.

## 3. Start only the needed path

```sh
npm run dev
```

Use `http://localhost:3000` for the app. Agent tools/Ask X do not require n8n. Inspect the actual process/port rather than assuming a ready page is the latest code.

### Building while the dev server is up

`npm run build` is guarded (`scripts/build.mjs`): it detects a dev server on the dev port (same netstat approach as `kill-stack`) and **refuses** rather than corrupt the live server's `.next` — the failure that looked like "the app broke" three times in one week.

| Situation | Command |
|---|---|
| Normal build (dev stopped) | `npm run build` |
| Build while dev stays up | `BUILD_ANYWAY=1 npm run build` — isolated `.next-build`, dev untouched |
| Smoke-test the isolated artifact | `npm run start:isolated` (port 3100) |

`npm run dev` runs a non-blocking `predev` check first: it warns when the port is already serving (a second server would drift to :3001 with different local state) and when `.next` looks like a stale production build (`rm -rf .next` if hydration breaks).

### Checking remote CI

```sh
npm run ci
```

Prints the latest GitHub Actions run for the current branch and exits 0 only on success. Set `GH_TOKEN` (or `GITHUB_TOKEN`) to avoid unauthenticated rate limits; if Actions are disabled or no runs exist, it says so. The ritual after pushing: `npm run ci` until it reports success — CI runs lint, typecheck, unit tests, n8n validation and a production build on every push to `main`.

For classic admissions, stop the intended n8n instance before import, then:

```sh
npm run push:n8n
npm run n8n
```

The push command validates, imports and publishes workflows; review it before use because publishing can enable triggers. Use `http://localhost:5678` for the editor. For the Telegram demo, follow [TELEGRAM-CHATBOT](TELEGRAM-CHATBOT.md) and use `npm run bot` instead of a second competing n8n process. No hosted deployment is required or claimed.

## 4. Synthetic walkthrough — expected observations, not results

1. As a counselor, inspect assigned leads and ask a read-only question through `/agent`; inspect the run and tool trace, including denials/errors rather than assuming `completed`.
2. In the classic intake form, submit a synthetic lead; reconcile CRM, analysis, dry-run email, task/notification and n8n logs. The agent and n8n execution histories are separate.
3. After migration 015 and its live gates pass, inspect exact draft arguments and decide as an independent permitted Operations/Admin user. Confirm the result remains `dry_run`; in Ask X use **Refresh run trace** to fetch updated state. Treat `RECONCILIATION_REQUIRED` as an operator stop, not a retry instruction.
4. Optionally use a provisioned external client against [EXTERNAL_API](EXTERNAL_API.md); acknowledge its broad service-client CRM visibility before granting access.
5. Run selected [TESTING](TESTING.md) checks only with authorization for their fixture writes, quota and messaging effects. Save a redacted summary, not raw test artifacts in Git.

## 5. Runtime controls

These SQL examples mutate the selected database; confirm the disposable target and record prior values before executing.

```sql
update agent_runtime_config set kill_switch = true;
```

This stops execution at subsequent guard checks; it does not retract a side effect or guarantee cancellation of an in-flight model call. Restore the prior value only after investigating the cause.

```sql
insert into agent_tool_config (tool_name, enabled)
values ('create_task', false)
on conflict (tool_name) do update set enabled = false;
```

This disables one registered tool at subsequent checks. Restore its prior configuration after the controlled exercise.

| Action | Interface |
|---|---|
| Decide approval | Session-authenticated `POST /api/agent/approvals/{id}` with `decision` and optional `note` |
| Provision/revoke external client | Operations/Admin `/api/agent/external-clients`; revoke via `PATCH /api/agent/external-clients/{id}` with `enabled: false` |
| Refresh knowledge | `npm run ingest:knowledge`, after reviewing document scope and provider cost |
| Stop local stack | Prefer Ctrl+C in its owning terminal; inspect processes before using `npm run kill-stack` |

`kill-stack` is broad process cleanup, not a harmless health check. Do not use it on a machine running unrelated Node/tunnel work without inspecting the script and targets.

## 6. Morning briefing operations

The briefing is deterministic: numbers come from SQL via `lib/ops/snapshot` and (for the scheduled path) `compute_daily_briefing()` — never from a model. Zero tokens are spent.

| Task | How |
|---|---|
| In-app generation | Auto-fires once per browser-day on Ask X open (ops/admin only), or the ☀ Generate button in Mission Control |
| Scheduled generation (n8n) | POST `/api/external/briefing` with `x-api-client` / `x-api-secret` headers and body `{ "targetUserId": "<admin-uuid>" }`; the client needs the `briefing.generate` scope and the target must be an active admin/operations user |
| Provision a scheduled client | Create the client in Agent → Governance with scopes `["briefing.generate"]` and store the secret once (hash-only at rest) |
| Rotate the credential | Provision a new client → update n8n env → disable the old client (revocation is immediate) |
| Verify | The run appears as the pinned ☀ Briefing session in /agent; Run Inspector shows `ops_snapshot` + `search_leads` steps with 0 tokens |

If a scheduled briefing fails, check: client enabled + scope present, target user role is admin/operations, migration 020 applied (`compute_daily_briefing` exists).

## 7. Email dispatch (Brevo) and the approval loop

Approving an email draft on Lead Detail now EXECUTES: the draft is claimed atomically and dispatched via Brevo when configured, or honestly simulated (status sent_simulated) when not. Approved recommended actions create a follow-up task (HOT -> high priority, due tomorrow).

| Task | How |
|---|---|
| Enable real sending | Set BREVO_API_KEY and BREVO_FROM_EMAIL in .env (or host env) and restart |
| Get the key | app.brevo.com -> SMTP & API -> API Keys (v3 key) |
| Verify the sender | app.brevo.com -> Senders -> add + verify BREVO_FROM_EMAIL; unverified senders are rejected by Brevo |
| Free tier | 300 emails/day - ample for admissions follow-ups; 401/429 errors mean bad key or exceeded quota |
| Failed dispatch | Draft shows status failed + reason on Lead Detail; approve again to retry (the claim guard allows it because status returned to failed, not sent) |
| Deployment note | Migration 021 must be applied (email_status sent_simulated + dispatched_at/dispatched_by/dispatch_error columns) |

## Troubleshooting

| Symptom | Check / next action |
|---|---|
| Port in use or app moves to 3001 | Identify the owning process and intended checkout; stop only that process rather than all Node processes |
| Classic webhook rejected | Confirm launcher configuration, signed envelope and active workflow without printing secrets |
| Agent missing DB objects | Compare the final ordered migrations with the selected project's applied schema |
| `awaiting_approval` | Inspect approval state and exact arguments; do not repeatedly resubmit a non-idempotent action |
| Unexpected `KILL_SWITCH` | Investigate previous test/operator state before restoring it; do not disable safety controls blindly |
| Provider/config error | Check model availability and quota; old benchmark/model pins do not guarantee current availability |
| Health reports Postgres | This identifies configured backend, not a successful RPC/cache round-trip; run the explicit authorized check |
| Accepted webhook without completed run | Reconcile the stored lead with agent runs; background dispatch is not a durable queue |
| Telegram silence or webhook errors | Follow the layered checks in the [bot runbook](TELEGRAM-CHATBOT.md); do not assume message delivery or loss |

For current limits, use [AGENT_CORE](AGENT_CORE.md), [SECURITY](SECURITY.md) and [ROADMAP](ROADMAP.md), not historical pass counts.
