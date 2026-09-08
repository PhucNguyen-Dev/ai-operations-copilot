# WORKFLOW — the n8n automations

Source of truth: `n8n/*.json` (version-controlled, imported with `npm run push:n8n` while n8n is stopped).
Secrets come from `.env` via `scripts/start-n8n.mjs` (`npm run n8n`; `npm run bot` for public webhooks).

## Workflow 1 — Admissions Lead Pipeline (`admissions-lead-pipeline`)

The core automation (F-002–F-014). One webhook execution = one lead processed end-to-end.

```
Webhook (POST /webhook/admissions-lead, shared-secret header)
  → Validate & authorize   [Code]   F-003  secret + required fields + email/phone format
  → Valid lead?            [IF]     false → record failed run → respond 401/422
  → Log run started        [REST]          automation_runs row (status=running)
  → Prepare AI prompt      [Code]          build prompt, carry run_id
  → AI lead analysis       [Gemini] F-004  JSON mode, retry ×4 @10s
  → Schema check           [Code]          malformed/incomplete = permanent failure
  → Schema ok?             [IF]     false → log failed step → mark run failed → respond 422
  → Score & classify       [Code]   F-005/6 deterministic thresholds (≥70 HOT, ≥40 WARM)
  → CRM: insert lead       [REST]   F-007  retry ×3
  → CRM: insert analysis   [REST]          retry ×3
  → Prepare email prompt   [Code]   F-008  personalized first-touch email from lead + analysis
  → Draft email (AI)       [Gemini]        JSON {subject, body}, retry ×4 @10s
  → Email schema check     [Code]          incl. truncation detection
  → Dry run?               [IF]     F-009  GMAIL_DRY_RUN=true → record email (dry_run) and skip send
  → Gmail: send            [API]           real send path (needs Gmail credentials)
  → Get counselors         [REST]   F-010  admissions counselors
  → Assign counselor       [Code]          deterministic assignment by lead id
  → Assign lead            [REST]          lead.assigned_counselor_id
  → Create follow-up task  [REST]   F-010  priority/due date from category
  → Create notification    [REST]   F-011  in-app notification for the counselor
  → Build step log         [Code]   F-012  8 step rows (F-003..F-011)
  → Log pipeline steps     [REST]          bulk insert
  → Finish run: success    [REST]          PATCH run (status, lead_id, finished_at)
  → Respond: accepted      [Webhook]       JSON: accepted, run_id, lead_id, score, category, action
```

Every branch terminates consistently: full success or a structured failed run. The dedicated
**Error Handler** workflow (`errorWorkflow` setting) catches unhandled crashes (e.g., a bug in a Code node)
and writes the terminal failure record — nothing is silently dropped.

## Workflow 2 — Parent Inquiry Chatbot (Telegram)

```
Telegram Trigger (bot credential; tunnel required on localhost)
  → Prepare turn   [Code]  per-chat memory (static data): history + collected info +
                           school knowledge base (courses, tuition floor, campuses, hours)
  → AI chat turn   [Gemini] JSON mode: {action: reply|submit, text, collected/lead}
                           — KB-grounded answers; collects name/phone/course one question
                             at a time; never invents prices; replies in parent's language
  → Resolve turn   [Code]  schema check + state merge + reset on submit
  → Enrollment intent? [IF]
      ├ reply   → Telegram: reply
      └ submit  → Fire admissions pipeline (existing webhook, secret header,
                  source: 'telegram', synthesized email documented in lead message)
                → Telegram: confirm
```

## Workflow 3 — Admissions Error Handler (F-013)

```
Error Trigger → Build error payload [Code] (workflow, last node, error message)
              → Record crashed run  [REST] automation_runs (status=failed, error_summary)
```

## Operational notes

- Import/push only while n8n is **stopped** (`npm run push:n8n -- --kill` handles it), restart after.
- Secrets are env-driven (`SUPABASE_*`, `GEMINI_API_KEY`, `AI_MODEL`, `N8N_WEBHOOK_SECRET`,
  `GMAIL_DRY_RUN`, `TELEGRAM_BOT_TOKEN`) — no credentials stored in n8n except Telegram's bot token.
- HTTP nodes never hand-set `Content-Type` when `specifyBody: json` is on (duplicate header → Supabase 400;
  see the pipeline post-mortem logged during development).
- PostgREST inserts that need the created row back use `Prefer: return=representation` +
  `Accept: application/vnd.pgrst.object+json`; response-wrapping is normalized in the consuming Code nodes.
