# Phase 3 Runbook — Core Admissions Automation

The n8n workflow, intake form, and API forwarding are **already built and imported**. This page covers your manual steps and how the pipeline works.

## Your steps

### 1. Add your OpenAI API key (~2 min)
Get a key at https://platform.openai.com/api-keys (requires billing; a test run costs a fraction of a cent with `gpt-4o-mini`).
Then open `.env` in the project root and fill in the two Phase 3 lines:
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```
(`N8N_WEBHOOK_URL` and `N8N_WEBHOOK_SECRET` are already filled in.)

### 2. Start n8n
```bash
npm run n8n
```
First run downloads n8n (~1 min), then the editor is at **http://localhost:5678**. Leave this terminal running — it reads the same `.env` for secrets (Supabase, OpenAI, webhook secret). No credential setup needed in the UI.

### 3. Activate the workflow
In the n8n editor: open **Admissions Lead Pipeline** → toggle **Active** (top-right). The production webhook is now listening at `http://localhost:5678/webhook/admissions-lead`.

### 4. Restart the Next.js dev server
Stop it (Ctrl+C) and `npm run dev` again — it needs the new `N8N_*` env vars.

### 5. Test end-to-end
Log in at http://localhost:3000 as **admin** or **counselor** → **+ New Test Lead** → fill the form → **Submit Test Lead**.

Within a few seconds you should see the green result card: score, HOT/WARM/COLD badge, intent, summary, recommended action. Then check the dashboard — the new lead appears, and signing in as **operations** shows a third automation run (status success).

## What to test (covers the roadmap's Phase 3 test matrix)

| Test | Expected |
|---|---|
| HOT lead (urgent, budget, deadline message) | score ≥ 70, HOT, HIGH intent |
| Vague lead ("how much is course?") | low score, COLD |
| Missing name or bad email | rejected in <1s, **failed run** recorded (check dashboard as admin/ops) |
| Malformed phone (e.g. `12345`) | rejected: "phone format is invalid" |
| Pipeline down (stop n8n, submit) | app shows "Pipeline unreachable" — nothing persisted |

## How the workflow works (the portfolio story)

```
Webhook (POST /webhook/admissions-lead, shared-secret header)
  → Validate & authorize   [Code] — secret check + required fields + email/phone format
  → Valid lead?            [IF] — false → log failed run → respond 401/422
  → Log run started        [Supabase REST] — automation_runs row, status=running
  → Prepare AI prompt      [Code] — builds messages, carries run_id
  → AI lead analysis       [OpenAI HTTP] — JSON mode, retry ×3 @ 2s backoff (F-014)
  → Schema check           [Code] — malformed/incomplete AI output = permanent failure
  → Schema ok?             [IF] — false → log failed step → mark run failed → respond 422
  → Score & classify       [Code] — deterministic thresholds: ≥70 HOT/HIGH, ≥40 WARM/MEDIUM, else COLD/LOW
  → CRM: insert lead       [Supabase REST, service key, retry ×3] (F-007)
  → CRM: insert analysis   [Supabase REST, retry ×3]
  → Log pipeline steps     [Supabase REST] — F-003/F-004/F-005-6/F-007 step rows
  → Finish run: success    [Supabase REST] — PATCH run, attach lead_id
  → Respond: accepted      [Webhook response] — the form shows the result
```

Design decisions worth knowing (these mirror ARCHITECTURE.md):
- **Secrets via env, not n8n credentials** — the workflow reads `$env.SUPABASE_*` / `$env.OPENAI_API_KEY`, all provided by `scripts/start-n8n.mjs` from the project `.env`. Nothing to configure twice.
- **Two OpenAI call paths** (AD-2): this pipeline is the automated path; the interactive tools in Phase 6 will call OpenAI from Next.js directly.
- **The dashboard never reads n8n's execution store** (AD-5/AD-10): everything you see comes from `automation_runs`/`automation_run_steps` written by the pipeline itself.
- **Scoring is auditable**: the model proposes the 0–100 score, but the HOT/WARM/COLD thresholds are fixed code — change them in the "Score & classify" node.
- Phase 4 will add: AI email generation, Gmail send (dry-run locally), follow-up task, counselor notification, and the dedicated error workflow (F-013).

## Troubleshooting

- **"Pipeline unreachable"** → n8n not running (`npm run n8n`) or workflow not Active.
- **401 "invalid webhook secret"** → `.env` changed after n8n started; restart both.
- **OpenAI 401/quota** → check the key and billing in `.env`; the run will show as failed with the API error in the n8n execution view.
- **Import already done?** The workflow is imported (id `CoOq9XXhs7qag3N6`). To re-import after edits to `n8n/admissions-lead-pipeline.json`: delete the old one in the UI (or `npx n8n import:workflow --input=... --separate`), then re-activate.
