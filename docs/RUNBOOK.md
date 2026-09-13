# RUNBOOK — Run, check, test, and operate the platform

Everything below is exactly what was used to build and verify Phase 9. If a command's "looks like" output doesn't match, see [Troubleshooting](#troubleshooting).

---

## 1. One-time setup

**Prerequisites:** Node 22, npm. n8n is only needed for the classic pipeline, not the agent core.

```bash
npm install
```

**`.env` keys** (already present in this workspace's `.env`):

| Key | Required for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | everything |
| `GEMINI_API_KEY` | every AI call (agent turns, embeddings, department tools) |
| `SUPABASE_SERVICE_ROLE_KEY` | agent runtime writes, governed tool writes, rate limiter/cache backends |
| `GMAIL_AGENT_DRY_RUN` | optional (default `true`) — `false` forces human approval on email actions |
| `LEAD_WEBHOOK_SECRET` | optional — lead webhook; falls back to `N8N_WEBHOOK_SECRET` |

**Migrations 010–014** — run each `supabase/migrations/01*.sql` in the Supabase SQL Editor (idempotent). Confirm applied:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('agent_runs','agent_run_steps','agent_approvals','agent_api_clients','knowledge_chunks','rate_limit_hits','ai_response_cache');
-- expect 7 rows; plus: select count(*) from leads where external_key is not null; -- column exists
```

**Demo users** (idempotent): `npm run seed:users`

---

## 2. Run it — the 10-minute hands-on tour

```bash
npm run dev          # http://localhost:3000
```

Log in with `<role>@demo.dev` / password `demo1234` (counselor, admin, operations, marketing, teacher).

1. **Ask X (the agent, as counselor):** sidebar → *AI Assistant → Ask X* → ask
   *"Which of my leads need follow-up today?"*
   → answer card shows a status badge (`completed`), the factual answer, and a **Run trace** you can expand: every tool call with its status and permission decision. No tool call happens without a permission decision.
2. **As admin:** the same chat plus the "Recent agent runs" list. Simulate an incoming lead (*Simulate incoming lead*) and watch the classic n8n pipeline do its thing.
3. **External API (as an external app, no browser session):** provision a client via `POST /api/agent/external-clients` (admin session) or just run `node scripts/verify-external-api.mjs` (provisions a temp client for you) — see [Verification scripts](#3-test-it).

---

## 3. Test it — four tiers, cheapest first

### Tier 1 — static + unit (no network, seconds)

```bash
npm run typecheck    # strict TS
npm test             # 170 unit tests (registry, permissions, guardrails, loop, scorer, chunker, auth…)
npm run build        # production build
```

### Tier 2 — E2E regression (dev server must be running)

```bash
npm run dev          # in one terminal
npm run test:e2e     # in another — auth/RLS visibility matrix (6/6)
```

### Tier 3 — opt-in LIVE checks (real Gemini; each proves one guarantee)

| Command | Proves |
|---|---|
| `AGENT_VERIFY=1 npx playwright test tests/e2e/agent-verify.spec.ts` | a real governed run completes + the chat UI renders answers with traces |
| `npm run evals:agent` | the 9 behavior scenarios pass → `test-results/agent-evals.json` (9/9 expected) |
| `node scripts/verify-external-api.mjs` | external client auth (wrong secret → 401), capability discovery, governed run, client attribution |
| `node scripts/verify-lead-webhook.mjs` | signed webhook accepted → governed triage run; duplicate re-delivery idempotent; tampered payload → 401 |
| `node scripts/verify-persistent-infra.mjs` | Postgres rate limiter blocks over-limit, isolates keys, persists; cache round-trips (no server needed) |

All of these need the dev server running (except `verify-persistent-infra`), create their own fixtures, and clean up after themselves.

### Tier 4 — nightly CI (already wired)

```bash
gh workflow run agent-evals   # manual trigger
gh run watch                  # or: GitHub → Actions tab
```

Green build = the 9 scenarios passed against the real project; results artifact is attached to each run. Nightly 02:00 UTC.

---

## 4. Operate it

| Action | How |
|---|---|
| **Kill switch** (blocks all agent execution before any model call) | Supabase SQL: `update agent_runtime_config set kill_switch = true;` → next run fails with `KILL_SWITCH`. Back: `… set kill_switch = false;` |
| **Disable one tool platform-wide** | `insert into agent_tool_config (tool_name, enabled) values ('create_task', false) on conflict (tool_name) do update set enabled = false;` → agents get a `TOOL_DISABLED` denial and re-plan |
| **External client provisioning / revoke** | `POST /api/agent/external-clients` (admin session; secret shown once) · `PATCH /api/agent/external-clients/{id} {"enabled": false}` |
| **Approve a high-risk agent action** | When a run is `awaiting_approval`: `POST /api/agent/approvals/{id} {"decision":"approved","note":"…"}` as Operations/Admin — the run resumes from Postgres |
| **Refresh knowledge after editing SOPs** | `npm run ingest:knowledge` (re-chunks + re-embeds; the `search_knowledge` tool picks it up immediately) |
| **Email approval demo** | Set `GMAIL_AGENT_DRY_RUN=false` in `.env`, restart → `prepare_email` now requires human approval |

---

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Dev server "in use" / lands on :3001 | A previous `node.exe` holds :3000 (Windows orphans survive terminal close). `netstat -ano | findstr :3000` → `taskkill /PID <pid> /F`, then restart. **Always confirm the health endpoint on :3000 before running e2e**, or you'll test stale code. |
| `text-embedding-004` → HTTP 404 | Model retired. The code already uses `gemini-embedding-001` + `outputDimensionality: 768` — don't "fix" it back. |
| Gemini 400 "missing a thought_signature" | Model turns must be replayed verbatim (full raw parts, grouped per turn). The runtime does this — never rebuild model turns from `{name, args}`. |
| Eval scenario fails instantly with 0 tokens in CI | Transient Gemini 429 (quota). The workflow pauses 3s between scenarios and retries once — rerun, or wait for the nightly. |
| Runs fail with `KILL_SWITCH` unexpectedly | A previous eval/local run left the flag on: `update agent_runtime_config set kill_switch = false;` |
| Tool denied with `AGENT_NOT_AUTHORIZED` for a NEW agent | `ToolDefinition.allowedAgents` must list EVERY agent identity allowed to call it — adding an agent definition alone is not enough. |
