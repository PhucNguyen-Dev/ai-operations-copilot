# ARCHITECTURE

Canonical architecture document for AI Operations Copilot (Phase 1 deliverable, maintained through Phase 8).
The long-form original lives in `docs/AI Operations Copilot — Phase 1 System A.md`; this file is the
up-to-date summary including everything added since (Telegram chatbot, UX shell, governance split).

## One-line shape

```
Internal staff (browser)
  → Next.js 15 (App Router, TS, Tailwind v4)   ← everything a human sees or touches
      ├─ /api/leads      → auth + shape check → n8n webhook (shared-secret header)
      └─ /api/ai/*       → auth + rate limit → Gemini (interactive tools, human-reviewed)
  → n8n (single instance)                      ← owns all automation end-to-end
      ├─ Admissions Lead Pipeline (webhook → validate → AI → schema gate → score → CRM → email → task → notify → log)
      ├─ Parent Inquiry Chatbot (Telegram → AI turn → FAQ reply OR lead submission → same admissions webhook)
      └─ Error Handler (catches unhandled crashes → structured failure record)
  → Supabase (Postgres + Auth + RLS)           ← the ONLY source of truth; role claim drives RLS
  → Gemini (AI)  ·  Gmail (transport only, dry-run by default)
```

## The one rule

n8n orchestrates · Next.js serves humans · Supabase persists · Gemini thinks · Gmail transports.
The dashboard reads **exclusively from Supabase** — never from n8n's internal execution store.

## Data stores (Supabase tables)

| Table | Purpose |
|---|---|
| profiles, courses | Staff identity (auto role mirror) + seeded catalog |
| leads, lead_analyses | Leads + AI output contract rows (score/category/intent/summary/action, model, raw response) |
| tasks, sent_emails, notifications | Follow-ups, email records (incl. dry_run), counselor notifications |
| automation_runs, automation_run_steps | Per-execution and per-step log (F-012) |
| ai_generations | Usage log for the 5 interactive tools (H5) |
| tool_experiments, tool_evaluations | Governance: real experiments + adoption decisions |

## Security model

- Supabase Auth; role in `app_metadata` (admin / operations / admissions / marketing / teacher), seeded demo users.
- **RLS on every table** — the database enforces access (counselors see only assigned leads; marketing/teacher
  see none; ops/admin see runs; governance tables staff-read/ops-write). UI gating is cosmetic defense-in-depth.
- n8n writes with the service-role key (trusted system actor) and stamps `created_by = 'n8n-pipeline'`.
- Webhook protected by `x-webhook-secret` (Next.js API and the chatbot are the only holders).
- Two-audience UI: `/governance` back office (admin/ops) vs `/guidelines` staff portal — the UX half of the
  registry loop (PHASE7-SUMMARY §10).

## Key decisions (full list in the Phase 1 doc, AD-1..AD-12)

- Interactive AI tools bypass n8n (synchronous, human-reviewed); only pipelines automate sends.
- AI output is schema-validated before any persist (both app and n8n); malformed = permanent failure.
- Retry ×3–4 with backoff for transient errors (429/5xx/timeout); never retry validation/schema/config errors.
- Error-handler workflow records unhandled crashes as failed runs — nothing silently dropped.
- AI provider: Gemini (pinned model, env-swap-able). Gmail dry-run by default locally.

## Scaling posture

Named-order upgrade path for 5,000 staff / 60,000 students: AI provider limits → n8n queue mode →
team-based routing logic → dedicated email transport → DB pooling/replicas/partitions → org-level identity
(SSO) and registry-driven governance. The four-layer shape does not change.
