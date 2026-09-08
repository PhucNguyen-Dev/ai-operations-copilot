# AI Operations Copilot

An internal operations platform for a (simulated) education company: an **AI receptionist that handles
student leads end-to-end**, five **AI assistants** for the staff, role-scoped dashboards, and a working
**AI governance** practice — built as a portfolio demonstration of the AI Automation Specialist skill set.

**Status:** all 30 roadmap features complete (Phases 0–8) · post-8 hardening landed (AI response cache,
swap-ready rate limiter, health observability, generation-log fix, Telegram webhook secret) · Playwright
RLS matrix is the main open item.

![Dashboard](docs/screenshots/01-dashboard-admin.png)

## The business problem

Education companies live on incoming leads ("I need IELTS 7.5 in 6 weeks!"). Handled manually, response is
slow and inconsistent, hot leads go cold, and every department repeats the same drudgery: marketers write
every ad from scratch, teachers build every quiz by hand, managers assemble reports from scattered data.
There's also no process for *adopting* AI safely — so it either doesn't get used or gets used carelessly.

## The solution

One system with four parts:

1. **The automatic receptionist** — a lead arrives (internal test form or the Telegram parent chatbot) and
   is validated, AI-analyzed (score 0–100, HOT/WARM/COLD), stored, answered with a personalized email,
   given a follow-up task, and assigned to a counselor — with a counselor notification. Every step is
   logged; failures are classified (transient → retried with backoff; permanent → structured failure
   record). Nothing is silently dropped.
2. **Role-scoped dashboards** — counselors see their assigned leads and tasks; operations sees automation
   health and full logs; the *database* enforces every boundary (Row-Level Security), not just the UI.
3. **Department AI assistants** — Content Generator & Campaign Analyzer (Marketing), Lesson Planner &
   Quiz Generator (Academic), Report Generator for reports & data analysis (Operations). All AI output
   is draft material with human review built in.
4. **Governance** — real tool experiments (a measured head-to-head that chose the production model), a
   scored adoption decision, per-department training designs, a workshop, and SOPs. Employees get an
   **AI Guidelines** portal; the specialist gets a **Governance** back office.

![Lead detail](docs/screenshots/02-lead-detail.png)

## Features

- **P0 — the automated pipeline (F-001–F-016):** test-lead intake, webhook trigger, validation, AI analysis,
  scoring, HOT/WARM/COLD classification, CRM storage, AI email draft, automated send (dry-run locally),
  follow-up task, counselor notification, step-level logging, error handling, retries, auth, RBAC.
- **P1 — observability + department tools (F-017–F-025):** lead dashboard with search/filters, lead detail,
  automation log viewer + run detail timelines, five AI tools, admin overview.
- **P2 — governance (F-026–F-030):** AI Tool Lab, AI Tool Evaluation, Employee AI Training, Internal AI
  Workshop, SOP collection. Full inventory: [docs/FEATURES.md](docs/FEATURES.md).

## Architecture

Four layers, each with one job — **n8n orchestrates, Next.js serves humans, Supabase persists, Gemini
thinks, Gmail transports.** The dashboard reads exclusively from Supabase under RLS. AI output is
schema-validated before anything is persisted; transient failures retry with backoff, permanent failures
halt into structured records. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · workflow diagrams:
[docs/WORKFLOW.md](docs/WORKFLOW.md).

## Automation workflow

The Admissions pipeline (F-002–F-014), node by node: [docs/WORKFLOW.md](docs/WORKFLOW.md).

```
Lead in (test form / Telegram chatbot) → webhook → validate → AI analyze (JSON-mode + schema gate)
→ score & classify (deterministic thresholds) → CRM write → AI email draft → send (dry-run locally)
→ follow-up task → counselor notification → per-step log → dashboard
```

A dedicated error-handler workflow catches unhandled crashes into the same log. The intake form stands
in for **Facebook Lead Ads** — going live is one mapping branch (webhook payload → the same pipeline),
tracked under Future Improvements.

## AI implementation

One AI convention (`lib/gemini.ts` + mirrored n8n nodes): pinned Gemini model (chosen by experiment),
JSON mode everywhere, per-use-case schema gates, transient-retry/permanent-fail classification, usage
logging. Prompts, contracts, and the failure philosophy: [docs/AI_DESIGN.md](docs/AI_DESIGN.md).

## Screenshots

| | |
|---|---|
| ![Lead detail](docs/screenshots/02-lead-detail.png) | ![Automation logs](docs/screenshots/03-automation-logs.png) |
| ![Tool evaluation](docs/screenshots/06-tool-evaluation.png) | ![Content generator](docs/screenshots/05-content-generator.png) |

More in `docs/screenshots/`.

## Demo video

**Full lead pipeline** — submit a test lead, watch n8n execute node by node:

[![Lead pipeline demo](docs/screenshots/01-dashboard-admin.png)](https://youtu.be/f44MgJeGtNw)

**Telegram chatbot** — the same flow through a live chat conversation:

[![Telegram chatbot demo](docs/screenshots/03-automation-logs.png)](https://youtu.be/f44MgIc-8d4)

## Tech stack

Next.js 15 (App Router, TypeScript, Tailwind v4) · Supabase (Postgres + Auth + RLS) · n8n · Google Gemini
· Gmail API · Vitest.

## Setup

```bash
npm install
cp .env.example .env    # fill: Supabase URL/keys, GEMINI_API_KEY (free at aistudio.google.com)
# Supabase SQL editor: run supabase/migrations/001..008, then seed.sql (+ seed_governance.sql)
npm run seed:users      # 5 demo logins (password demo1234)
npm run push:n8n        # import workflows (n8n stopped), then Activate in the UI
npm run dev             # app at :3000
npm run bot             # full bot stack: cloudflared tunnel + n8n + Telegram webhook, verified
npm run kill-stack      # emergency stop: n8n, tunnels, stray node processes
```

Demo logins: `admin@ / operations@ / counselor@ / marketing@ / teacher@ demo.dev` — password `demo1234`.
Full runbooks: [docs/TELEGRAM-CHATBOT.md](docs/TELEGRAM-CHATBOT.md) (chatbot), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testing

- **74 unit tests** (`npm test`): AI helpers + response cache, tool schemas, app logic, rate limiter.
- **E2E failure-case suite** (`node scripts/e2e-tests.mjs`): valid lead, invalid phone, missing fields,
  malformed email, wrong secret, duplicate leads, oversized fields, unreachable pipeline — verified against
  live Supabase. Latest results: [docs/archive/e2e-results.md](docs/archive/e2e-results.md) (8/8).
- Integration test for the Gemini client (`npm run test:integration`).
- Playwright auth/RLS visibility matrix (`d9c3ee1`) — the remaining open item is wiring it into CI.

## Limitations

- Email is **dry-run by default** (deliberate: no real sends from a prototype); real sending needs Gmail
  OAuth credentials and `GMAIL_DRY_RUN=false`.
- Free-tier Gemini quota is per-model per-day; sustained volume needs a paid tier or provider fallback.
- No duplicate-lead dedupe yet (documented); chatbot demo runs on Telegram (Messenger/Zalo = same pattern,
  business-account gated).
- Single environment, no multi-region/HA — deliberate non-goals for a prototype.
- n8n pipeline writes use the service-role key (R-08, partially fixed); RLS-scoped writes need
  `SUPABASE_JWT_SECRET` in `.env` — see [docs/WEAK_POINTS_AND_RISKS.md](docs/WEAK_POINTS_AND_RISKS.md).
- Rate limiter + AI response cache are in-memory (single-instance); both sit behind swap-ready
  interfaces for a multi-instance deploy.

## Future improvements

- Live Facebook Lead Ads / Zalo webhook replacing the test-lead simulation (§25; one mapping branch).
- Registry-driven access: governance decisions granting/revoking tool access per role, with training gates
  and n8n alerting to employees (docs/archive/PHASE7-SUMMARY §10).
- Duplicate-lead detection, prompt versioning with accuracy tracking, multi-language lead handling.
- Deployment: Vercel + hosted n8n (see docs/ROADMAP.md "Path to production"); shared rate limiter /
  cache when multi-instance; Supabase JWT Signing Keys when the legacy secret is retired.
- Full backlog: [docs/ROADMAP.md — Future implementations](docs/ROADMAP.md).

## Document index

[Roadmap](docs/ROADMAP.md) · [Spec](docs/PRODUCT_SPEC.md) · [Features](docs/FEATURES.md) ·
[Architecture](docs/ARCHITECTURE.md) · [AI Design](docs/AI_DESIGN.md) · [Workflows](docs/WORKFLOW.md) ·
[Tool Lab](docs/AI_TOOL_LAB.md) · [Tool Evaluation](docs/AI_TOOL_EVALUATION.md) · [Training](docs/TRAINING.md) ·
[Phase 7 Summary](docs/archive/PHASE7-SUMMARY.md) · [Weak points & risks](docs/WEAK_POINTS_AND_RISKS.md) ·
[Lessons learned](docs/LESSONS-LEARNED.md) — **the one mistakes document, every incident cataloged** ·
[Interview objections](docs/interview-objections.md)
