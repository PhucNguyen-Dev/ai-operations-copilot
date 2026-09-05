# Pipeline 400 — `Log pipeline steps` "Bad request"

## Status
**Resolved.** Commit TBD adds `Content-Type: application/json` to every
POST-with-body HTTP node in `n8n/admissions-lead-pipeline.json`. The next
HOT test lead should produce a green run with **8** `automation_run_steps`
rows (F-003…F-011) and zero 400s.

## TL;DR

Seven HTTP nodes in the pipeline POST to Supabase with a JSON body. Six of
them happen to succeed without a `Content-Type` header because Supabase REST
content-sniffs single-object bodies. The seventh — `Log pipeline steps` —
sends an **array** of 8 rows. Supabase REST requires an explicit
`Content-Type: application/json` for array bodies, and rejects the request
with a generic 400. The pipeline crashes on the last node, the error
workflow catches it, and the form shows **"Rejected by the pipeline"**.

## Symptoms

1. The n8n editor shows the workflow canvas with **no red line on the
   failing node** — only the last node's error toast appears
   (`Problem in node 'Log pipeline steps' — Bad request - please check
   your parameters`).
2. The execution list shows the run as `Error in N ms` after a long
   green run, with the error message `Bad request - please check your
   parameters`.
3. The F-013 error-handler workflow (exec immediately after the failure)
   is **green** — that means the catch-all fired. The lead and analysis
   are in Supabase, but no `automation_run_steps` rows were written.
4. The test form on `http://localhost:3000` shows
   **"Rejected by the pipeline — The failed run was recorded in
   automation_runs"**.

## Root cause

The n8n HTTP Request node has two body modes:

- `specifyBody: "json"` with `jsonBody: "={{ JSON.stringify(...) }}"` —
  n8n serializes the value and sends it. **But n8n does not
  automatically set `Content-Type: application/json` on the request.**
  You must add it in `headerParameters.parameters` yourself.
- `specifyBody: "keypair"` with `bodyParameters` — n8n sends
  `Content-Type: application/x-www-form-urlencoded` by default.

The pipeline uses `specifyBody: "json"` for every Supabase call. All 7
of those nodes were missing the `Content-Type` header.

### Why 6 of 7 worked anyway

Supabase PostgREST is lenient about **object** bodies. It sniffs the
payload, sees JSON, and parses it. So:

- `Log run started` → `{...}` body → accepted (no header needed)
- `CRM: insert lead` → `{...}` → accepted
- `CRM: insert analysis` → `{...}` → accepted
- `Record validation failure` → `{...}` → accepted
- `Record schema failure` → `{...}` → accepted
- `AI lead analysis` → `{...}` (Gemini request, not Supabase, but
  Gemini also content-sniffs) → accepted

But `Log pipeline steps` posts an **array** of 8 step-row objects:

```json
[
  { "run_id": "...", "feature_id": "F-003", "step_name": "Lead validation", ... },
  { "run_id": "...", "feature_id": "F-004", ... },
  ...
  { "run_id": "...", "feature_id": "F-011", ... }
]
```

PostgREST requires the explicit `Content-Type: application/json` header
to interpret a top-level array as a batch insert. Without it, the
request is rejected with HTTP 400 and the body **"Bad request - please
check your parameters"**. n8n's error message is that exact text.

## The fix

Add `Content-Type: application/json` to all 7 nodes. The pattern is the
same one already used by every working node in the file
(`Record email: sent`, `Create follow-up task`, `Create notification`,
etc.):

```json
"headerParameters": {
  "parameters": [
    { "name": "apikey", "value": "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
    { "name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
    { "name": "Content-Type", "value": "application/json" }
  ]
}
```

We added it to all 7, not just the failing one, so the next person who
changes a body to an array doesn't rediscover this bug.

### How to apply

1. Stop n8n — closing the terminal is **not enough** on Windows. Use
   `taskkill /PID <pid> /T /F` or just run
   `node scripts/push-workflow.mjs --kill --force` (it handles the kill
   for you).
2. Run `node scripts/push-workflow.mjs --kill --force`. It imports and
   publishes both `n8n/*.json` files. The publish step reactivates the
   workflows.
3. Start n8n with `npm run n8n` — the `start-n8n.mjs` script loads
   `.env` so the webhook secret, Supabase keys, and Gemini key are
   available. Starting n8n any other way breaks webhook auth.
4. Submit a HOT test lead. Expect:
   - n8n execution turns green in the editor
   - 8 `automation_run_steps` rows in Supabase
   - `sent_emails.lead_id` is a real UUID (no longer `undefined`)
   - 1 `tasks` row, 1 `notifications` row, 1 `sent_emails` row with
     `status: 'dry_run'`

## Why the canvas didn't show a red line

n8n's editor renders failure indicators on the **last executed** node
when the workflow errors, and on the immediate upstream IF/switch node
that led to the failure. The 7 nodes between "Build step log" and "Log
pipeline steps" all succeeded, so their connecting edges stay green
even though their HTTP requests are all technically invalid without
`Content-Type`. Only the last node is marked red. This makes the
"missing header on 6 of 7 nodes" pattern visually invisible — a future
maintainer could re-introduce the bug for any one of them by changing
its body to an array.

## Prevention

- **Linter / pre-commit check** — the project has no JSON lint for n8n
  workflows. A simple `node -e` script that walks every HTTP node and
  asserts `Content-Type` is set when `sendBody=true` and
  `specifyBody="json"` would catch this. Worth adding to
  `scripts/push-workflow.mjs` as a pre-import check.
- **Code review checklist** — any PR that adds an HTTP node with
  `sendBody=true` should require `Content-Type` in the diff.

## What was NOT the bug

- **Not a Gemini issue.** The error happens after the AI steps
  complete; `AI lead analysis` returns 200, the AI output is parsed
  correctly.
- **Not a Supabase schema issue.** The `automation_run_steps` table is
  fine — the row shape (run_id, feature_id, step_name, status,
  attempt_count, payload_snapshot, error_detail, started_at,
  finished_at) matches the table exactly.
- **Not a run_status / step_status enum issue.** The pipeline uses
  `'success'`, `'failed'`, and `'skipped'`, all of which are valid
  `step_status` enum values.
- **Not a foreign-key violation.** The "Log run started" node created
  the `automation_runs` row earlier in the same execution, so the
  `run_id` exists when "Log pipeline steps" tries to insert.

## How to verify the fix

After applying the change and re-running a HOT test lead:

```sql
-- Expect: 8 rows for the run, one per feature F-003..F-011
select feature_id, step_name, status, attempt_count
from automation_run_steps
order by feature_id;

-- Expect: 1 row with status='dry_run' and a real lead_id
select id, lead_id, to_address, subject, status
from sent_emails
order by created_at desc limit 1;

-- Expect: lead_id is NOT NULL
select count(*) from sent_emails where lead_id is null;
-- should return 0
```

## Files touched

- `n8n/admissions-lead-pipeline.json` — added `Content-Type:
  application/json` to 7 HTTP nodes
- `docs/fix-pipeline-content-type.md` — this file (new)
- `docs/fix-error-handler.md` — deleted (different bug, separate doc
  was no longer needed; lesson preserved in `ROADMAP.md`)
- `docs/ROADMAP.md` — one-line entry in the doc index, one-line lesson
  added to "Phase 4 lessons learned"

## See also

- `docs/ROADMAP.md` § "Phase 4 lessons learned" — the related
  `{{ }}` expression parser pitfall (different bug, same theme:
  n8n's HTTP node doesn't auto-fill what you'd expect)
- `scripts/push-workflow.mjs` — kills the running n8n, imports,
  publishes. The `--kill` flag is required on Windows because closing
  the terminal leaves n8n alive as an orphan holding port 5678.
