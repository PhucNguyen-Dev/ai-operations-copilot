AI Operations Copilot — Phase 1 System Architecture
Status: Phase 1 — ArchitectureDerived from: PRODUCT_SPEC.md (v1.0), FEATURES.md (Phase 0)Scope: Portfolio prototype — one developer, single environmentOut of scope by design: microservices, Kubernetes, Kafka, Redis, event buses, enterprise HA/SSO

1. Architecture Overview
AI Operations Copilot is a four-layer internal operations platform for a simulatededucation/training company. The architecture is deliberately minimal:

Layer	Technology	Role
Application	Next.js (App Router, TypeScript, Tailwind, shadcn/ui)	Dashboards, forms, role-scoped UI, thin API layer
Persistence & Identity	Supabase (PostgreSQL + Auth + RLS)	Single source of truth for all data; user sessions; role enforcement
Orchestration	n8n (single instance, single Admissions workflow)	Owns the automated Admissions pipeline end-to-end
External Services	Google Gemini API, Gmail API	AI inference and email delivery
The one architectural rule that shapes everything:

n8n handles workflow orchestration and all external integrations for theautomated pipeline (the Admissions workflow, F-002–F-014).
Next.js handles everything a human sees or touches: dashboards, the TestLead intake interface, role-scoped pages, and application-facing logic.
Supabase is the only persistence layer. The dashboard never reads fromn8n's internal execution store; it reads from Supabase under RLS.
Google Gemini performs all AI inference (both pipeline calls and interactive tools).
Gmail is transport only — it never composes content.
There are exactly two paths to Google Gemini:

Pipeline path (Admissions): n8n → Gemini, output schema-validated before persist.
Interactive path (Marketing/Academic/Operations tools): Next.js API → Gemini, synchronous, human-reviewed output (per spec §8: "all other department AI outputs are explicitly designed for human review").
This split is intentional: interactive tools are synchronous and user-reviewed, sorouting them through n8n would add latency and complexity with zero benefit.

2. Architecture Diagram
Rendered from docs/architecture/system-architecture.mmd:

flowchart TB    subgraph USER["Internal Staff (browser)"]        U1["Admissions Counselor"]        U2["Operations Manager / Admin"]        U3["Marketing Staff / Teacher"]    end    subgraph NEXTJS["Next.js Application (App Router + API Routes)"]        UI["Role-scoped UI: Lead Dashboard, Lead Detail, Automation Logs Viewer, Test Lead Intake, Dept. AI Tools, Governance pages"]        API1["POST /api/leads/submit — auth + payload shape check → forwards to n8n webhook"]        API2["Interactive AI proxy routes (/api/ai/*) — synchronous Gemini calls for Marketing/Academic/Operations tools"]    end    subgraph SUPA["Supabase (single project)"]        AUTH["Supabase Auth (seeded demo users)"]        RLS["Row-Level Security (role-scoped)"]        DB[("PostgreSQL: leads, lead_analyses, tasks, sent_emails, notifications, automation_runs, automation_run_steps, profiles, courses, ai_tool_* governance tables")]    end    subgraph N8N["n8n (single instance)"]        WF["Admissions Lead Pipeline workflow (F-002–F-012) with per-step retry + error workflow (F-013/F-014)"]    end    subgraph EXT["External Services"]        OAI["Google Gemini API (generateContent, JSON mode)"]        GM["Gmail API (single service-account sender)"]    end    U1 & U2 & U3 --> UI    UI --> AUTH    UI -->|server components, RLS-enforced reads| RLS    RLS --> DB    UI --> API1    API1 -->|"HTTPS + x-webhook-secret"| WF    WF -->|"service-role key (bypasses RLS, attribution fields written)"| DB    WF --> OAI    WF --> GM    API2 --> OAI
3. Component Responsibilities
Each component is defined by: why it exists, what it does, what it receives,
what it produces, what it must NOT be responsible for.

3.1 Frontend (Next.js pages/components)
Why it exists: Every user-facing surface — the product is an internal tool,
and internal tools need UI. It is the only place humans interact with the system.
What it does: Renders role-scoped dashboards and pages (F-017–F-025),
the Test Lead intake form (F-001), the interactive AI tool forms (F-020–F-024),
and static governance/SOP content (F-026–F-030). Server Components read from
Supabase directly (RLS-enforced via the user's session).
Receives: User input (form data, filters), Supabase query results (via RLS),
API route responses.
Produces: Rendered HTML, HTTP requests to Next.js API routes, Supabase
reads via the authenticated client.
NOT responsible for: Calling Gemini or Gmail directly from the browser;
calling the n8n webhook directly from the browser; containing business-pipeline
logic (scoring, classification, routing); secrets of any kind.
3.2 Next.js API layer (Route Handlers)
Why it exists: The browser must never hold the n8n webhook secret or the
Gemini key; a thin server layer enforces auth/RBAC and acts as the secure
bridge to n8n and Gemini.
What it does:
POST /api/leads/submit: checks the user session + role, validates payload
shape only, forwards the payload to the n8n webhook with the shared-secret
header (F-001 → F-002).
/api/ai/* proxy routes: synchronous Gemini calls for the interactive tools
(Content Generator, Campaign Analyzer, Lesson Planner, Quiz Generator,
Report Generator).
Log-write routes where the UI mutates data (e.g., task status updates).
Receives: Authenticated HTTP requests with JSON bodies.
Produces: Forwarded webhook calls to n8n; Gemini requests + returned
drafts to the UI; HTTP responses (accepted/rejected).
NOT responsible for: Lead validation semantics, scoring, classification,
email composition or sending, retry logic, pipeline orchestration. It is a
gate and a proxy — nothing more.
3.3 Supabase
Why it exists: The spec demands a single source of truth, auth, and
role-based access without enterprise infrastructure. One managed Postgres
project with Auth + RLS covers all of it.
What it does:
Supabase Auth: seeded demo users per role (spec Assumption 6). The role
claim (app_metadata.role) drives RLS.
RLS: counselors see only their assigned leads/tasks; Operations Manager
and Admin see automation logs; Marketing/Teachers see only their modules' data.
Tables (schema deferred to Phase 2, listed for architecture completeness):
profiles, courses (seeded: IELTS, TOEFL, Business English), leads,
lead_analyses, tasks, sent_emails, notifications,
automation_runs, automation_run_steps, plus P2 governance tables
(tool_experiments, tool_evaluations).
Receives: Reads/writes from the Next.js app (user session, RLS applies);
writes from n8n (service-role key, RLS bypassed, attribution fields written).
Produces: Query results, auth sessions, constraint/RLS errors.
NOT responsible for: AI inference, orchestration, email sending,
retry decisions, business rules like scoring thresholds.
3.4 n8n
Why it exists: The core product demonstration is an automated workflow.
n8n makes orchestration, per-step retry, and visual inspectability first-class
features — the workflow itself is portfolio evidence.
What it does: Owns the entire Admissions pipeline (F-002–F-012):
webhook trigger, validation, AI analysis call, scoring, classification,
CRM writes, response generation call, email send, follow-up task creation,
counselor notification, and automation logging. Includes per-node retry
configuration and a dedicated error workflow (F-013/F-014).
Receives: Lead payload via webhook (from the Next.js API layer only);
API responses from Gemini, Gmail, Supabase.
Produces: Supabase rows (leads, analyses, tasks, sent_emails,
notifications, automation_runs + steps); sent emails; webhook HTTP response.
NOT responsible for: Serving any UI; authentication of human users;
storing the system of record (Supabase is the source of truth — n8n's
execution store is not read by the app); interactive AI tools; counselor
workload balancing (round-robin/default only, per spec Assumption 4).
3.5 Google Gemini API
Why it exists: All AI use cases in the spec (lead analysis, response
generation, content, campaign analysis, lesson plans, quizzes, reports).
What it does: Chat completions with JSON/structured output for pipeline
calls (F-004, F-008); plain generation for interactive tools. Model selection
is deferred to implementation (spec §4 Phase 0 boundary — carried forward).
Receives: Prompts containing lead data / tool inputs.
Produces: Structured JSON (score, category, intent, course, timeline,
summary, recommended_action — per the spec's AI output contract) or drafted
text (email subject/body, tool output).
NOT responsible for: Validation of its own output (a dedicated n8n Code
node validates before persist — spec Constraint: "AI outputs used downstream
must be schema-validated"); persistence; sending email; deciding retry policy.
3.6 Gmail API
Why it exists: The spec requires automated email delivery (F-009) using a
single sender service account (spec Assumption 3).
What it does: Sends the AI-generated first-touch email (F-009) and the
counselor notification email copy (F-011). One OAuth service account, one
sender address.
Receives: Fully composed subject + body + recipient from n8n.
Produces: Send confirmation (message ID) or a transport error.
NOT responsible for: Composing content (Gemini does that), storing email
records (Supabase does that — Gmail is transport only), delivery scheduling.
4. Data Flow
Read path (dashboard):

text

Browser → Next.js page (Server Component) → Supabase client (user session)
→ RLS policy check → PostgreSQL rows → rendered UI
The dashboard never queries n8n. Pipeline state is read from Supabase tables
written by the pipeline itself.

Write path (Test Lead submission, F-001 → F-002):

text

Browser form → POST /api/leads/submit (auth + shape check)
→ HTTPS POST + x-webhook-secret → n8n webhook → pipeline executes
→ immediate 202-style response to the UI ("submitted — pipeline running")
→ UI polls/refreshes reads from Supabase to show the resulting lead
Automated pipeline path: see §5.

Interactive AI tool path (e.g., F-020):

text

Browser form → POST /api/ai/content-generator (auth + RBAC)
→ Gemini API → draft returned to UI → human reviews → optionally saved to Supabase
5. Admissions Workflow
The single automated business process, mapping features F-002 through F-012
(plus error/retry F-013/F-014 wrapping every step):

Step
Feature
n8n node type (indicative)
Output
1. Webhook trigger	F-002	Webhook	Execution started
2. Lead validation	F-003	Code node	Valid/invalid; sanitized payload. Invalid → halt, log
3. AI lead analysis	F-004	Gemini/HTTP node	JSON: score, category, intent, course, timeline, summary, recommended_action
3a. Schema validation	Constraint	Code node	Invalid JSON → permanent failure, halt, log
4. Lead scoring	F-005	Set/Code node	Score 0–100
5. Classification	F-006	Set/Code node	HOT / WARM / COLD + intent level
6. CRM storage	F-007	Supabase node	leads + lead_analyses rows
7. AI response generation	F-008	Gemini/HTTP node	Email subject + body
8. Automated email	F-009	Gmail node	Sent confirmation → sent_emails row
9. Follow-up task	F-010	Supabase node	tasks row, counselor = round-robin/default
10. Counselor notification	F-011	Supabase node + Gmail node	notifications row + email copy to counselor
11. Automation logging	F-012	Supabase nodes throughout	automation_runs + automation_run_steps rows

Counselor assignment uses simple round-robin or a single default counselor
(spec Assumption 4). No load-balancing engine.

Rendering: docs/architecture/admissions-workflow.mmd.

6. AI Integration
Two call sites: n8n (pipeline: F-004 analysis, F-008 response) and the
Next.js API layer (interactive tools: F-020–F-024).
Output contract enforcement: pipeline AI output is validated against the
schema from the spec before any persist or send. A malformed model response
is a permanent failure — it is logged and never retried into the database.
Output treatment: per spec §8, all AI output is draft/assistive. The
Admissions email is the one automated send (by design, fully logged); every
other department's AI output is human-reviewed in the UI before use.
Cost control: the Gemini key exists only server-side (n8n credentials and
Next.js env). No per-request billing UI, no token metering beyond logs —
prototype scope.
7. n8n Integration
One instance, one primary workflow ("Admissions Lead Pipeline") plus one
error workflow. No horizontal scaling, no queue mode.
Trigger: Webhook node, path e.g. /webhook/admissions-lead, protected by
a shared-secret header (x-webhook-secret) set by the Next.js API route.
Credentials stored in n8n: Gemini API key, Gmail OAuth2 (service account),
Supabase service-role key + URL.
Retry & error handling: configured per node (see §10/§11); a separate
error workflow catches unhandled failures and writes a final failure record
to automation_runs.
What n8n does NOT do: serve UI, authenticate humans, host the source of
truth, or run interactive AI tools.
8. Supabase Integration
One project. Postgres + Auth + RLS + Storage (if needed later) — no
separate database instances.
Two access patterns:
Next.js (user context): @supabase/ssr client, anon key, RLS fully
enforced. All dashboard reads/writes go through this.
n8n (system context): service-role key, RLS bypassed. Acceptable
because n8n is a trusted system actor per spec (§5, "System actor"); every
write includes explicit attribution fields (created_by = 'n8n-pipeline',
assigned_counselor_id) so records remain auditable.
Schema, RLS policies, and seed data are Phase 2 deliverables — this
document fixes only the table inventory and access patterns.
9. Gmail Integration
Single service-account sender (spec Assumption 3) — no per-counselor
mailboxes, no user OAuth consent flows.
Sends exactly two email types: the lead first-touch email (F-009) and the
counselor notification copy (F-011).
Dry-run mode: an n8n workflow-level toggle (GMAIL_DRY_RUN) that skips
the actual send and marks the sent_emails row as dry_run — required for
local development and safe demos (local dev cannot send real email).
Gmail never composes content and never stores the record of record — the
confirmation (message ID, timestamp) is persisted to Supabase by n8n.
10. Error Handling
Every pipeline step is wrapped by n8n error handling. Errors are classified:

Category
Examples
Action
Permanent — validation	Missing required field, malformed email	Halt, log, no retry
Permanent — AI config	Gemini 4xx, auth, quota, invalid prompt	Halt, log, no retry
Permanent — AI schema	Output fails JSON schema validation	Halt, log, no retry
Transient — AI	Gemini 5xx, timeout, rate limit	Retry ×3 with backoff
Transient — Gmail	Gmail 5xx, transient network	Retry ×3 with backoff
Permanent — Gmail	Gmail 401, revoked token, invalid recipient	Halt, log, no retry
Transient — DB	Supabase 5xx, transient connection	Retry ×3 with backoff
Permanent — DB	Constraint violation, RLS denial	Halt, log, no retry

Guarantee: the pipeline always terminates in a consistent state — either
fully successful with all rows written, or halted with a structured failure
record in automation_runs / automation_run_steps. No error is silently
dropped. This satisfies the spec's success criterion: "a single-step failure
is caught, logged, and retried without crashing the overall pipeline."

Frontend/API errors (outside the pipeline): standard HTTP 4xx/5xx with
user-readable messages; not part of automation logging.

11. Retry Strategy
Where: n8n per-node retry settings (Retry On Fail), plus the error
workflow for anything uncaught. No external job queue (spec Assumption 7).
What gets retried: transient failures only, per the table above.
How: 3 attempts, exponential backoff — 2s, 4s, 8s.
What never gets retried: validation errors, schema mismatches, auth/quota
failures (4xx), constraint violations. Retrying a permanent failure would
only duplicate garbage or mask a configuration problem.
After final failure: the error workflow writes a terminal failure record;
the run is visible as failed in the Automation Logs Viewer.
12. Logging
One log destination: Supabase (automation_runs + automation_run_steps).
n8n's internal execution log exists but is not the system of record and is
not queried by the app — it is developer-side inspection only.
Per run: run ID, trigger source, lead reference, overall status, start/end
timestamps, error summary if failed.
Per step: feature ID (F-003…F-011), status (success/failed/retried),
timestamps, attempt count, and an output/payload snapshot (sanitized — no
full secrets, minimal PII trimming is acceptable at Phase 2).
Consumers: the Automation Logs Viewer (F-019) under RLS (Operations
Manager, Admin only per spec priorities) and the Operations/Admin Dashboard
automation-health widget (F-025).
Application logs: standard console/Next.js server logs at dev time —
nothing custom, nothing aggregated (prototype scope).
13. Security
Auth: Supabase Auth, seeded demo users per role; role in app_metadata,
verified server-side on every request. No SSO (non-goal).
Authorization: RLS on every table; UI role-gating is cosmetic defense-in-
depth only — the database enforces the real policy.
Webhook security: the n8n webhook is reachable only with the shared-secret
header, which only the Next.js API layer holds. The webhook is never exposed
to the browser.
Secrets: Gemini key in Next.js env + n8n credentials; Supabase service-role
key in n8n credentials only; Gmail OAuth in n8n credentials. No secret ever
reaches the client bundle.
n8n trust boundary: service-role writes bypass RLS. Mitigation: n8n runs
as a trusted single-actor, writes attribution fields, and its workflows are
version-controlled artifacts.
Data: all data is synthetic (spec Assumption 8) — no real personal data.
Not claimed: SOC2/ISO certification (spec Constraint).
14. Environment Configuration
Variable
Held by
Purpose
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY	Next.js	Supabase client (RLS context)
SUPABASE_SERVICE_ROLE_KEY	Next.js (server, optional) + n8n	Admin/RLS-bypass writes
N8N_WEBHOOK_URL	Next.js (server only)	Pipeline webhook endpoint
N8N_WEBHOOK_SECRET	Next.js (server) + n8n webhook check	Shared-secret header
GEMINI_API_KEY	Next.js (server) + n8n credentials	AI inference
AI_MODEL	both	Model selection (deferred to impl.)
GMAIL_* (OAuth client/service-account)	n8n credentials	Email sending
GMAIL_DRY_RUN	n8n	Skip real sends in local dev/demo
GMAIL_SENDER_ADDRESS	n8n	The single sender address
NEXT_PUBLIC_APP_URL	Next.js	Base URL for links in notifications

.env.example is a Phase 2 deliverable; this table fixes the inventory.

15. Local Development Architecture
Runs entirely on one machine:

Service
Local setup
Next.js	npm run dev on localhost:3000
Supabase	Free-tier cloud project (no local Postgres to manage; SQL editor + seeded users)
n8n	npx n8n (or Docker) on localhost:5678, webhook at localhost:5678/webhook/admissions-lead
Gemini	Live API (real key, small test volume)
Gmail	Dry-run mode ON — pipeline marks sent_emails rows as dry_run, sends nothing

Flow: localhost:3000/api/leads/submit → localhost:5678/webhook/... → live
Supabase + Gemini → Supabase rows visible back in the dashboard. The n8n editor
UI doubles as the live demo of the workflow itself.

16. Deployment Considerations (Future — Not MVP)
Next.js → Vercel (or any Node host); set env vars in the platform.
n8n → small VPS / container (n8n cloud also viable); webhook must be HTTPS.
Supabase stays a managed cloud project.
Rotate the webhook secret to a long random value; restrict n8n port exposure.
Production-grade additions if this ever went beyond a portfolio: secret
manager, uptime monitoring/alerting, prompt versioning, rate-limit hardening.
Not planned: Kubernetes, multi-region, HA, queues, microservices — permanent
non-goals per spec §23.
17. Architecture Decisions
ID
Decision
Rationale
AD-1	n8n owns the Admissions pipeline end-to-end	Per-step retry and logging are first-class nodes; the visual workflow is itself portfolio evidence
AD-2	Interactive AI tools bypass n8n (Next.js → Gemini directly)	They are synchronous and human-reviewed; n8n routing adds latency with no benefit
AD-3	One Supabase project; no Redis/Kafka/queues	Managed Postgres + RLS covers persistence and auth; enterprise infra is a non-goal
AD-4	Schema-validate AI output in a dedicated n8n Code node before persist	Spec constraint; prevents garbage in Supabase from a malformed model response
AD-5	Automation logs live in Supabase, not n8n	Dashboard must show logs under RBAC; n8n's store isn't queryable from the app
AD-6	Single Gmail service-account sender	Spec assumption; simplifies credentials, avoids per-mailbox OAuth
AD-7	Retry only transient failures, ×3, 2s/4s/8s backoff, in n8n	Permanent failures must not be retried; custom job runners are a non-goal
AD-8	Next.js→n8n over HTTPS with shared-secret header	Simple, adequate auth for a private webhook in a prototype
AD-9	n8n uses the Supabase service-role key (RLS bypass) with attribution fields	n8n is the spec's trusted system actor; attribution keeps writes auditable
AD-10	Dashboard reads exclusively from Supabase	Keeps the read path under RLS and queryable by the Logs Viewer
AD-11	Supabase Auth + role in app_metadata + RLS per table	Matches spec assumption (seeded users, no SSO); DB-level enforcement
AD-12	Gmail dry-run toggle for local dev	Local development cannot send real email; enables safe repeated demos

18. Trade-offs
Workflow visibility vs. code-only pipeline. n8n adds one process to run
and one credential store to manage, in exchange for a visual, editable,
inspectable workflow — the central portfolio artifact. Worth it here.
Single AI provider, no abstraction layer. Direct Gemini calls keep the
code small; switching providers later means a refactor. Acceptable for a
prototype; noted as a future improvement, not built now.
n8n bypasses RLS. Trusted-actor simplicity vs. the theoretical risk of a
buggy workflow writing bad rows. Mitigated by schema validation, attribution
fields, and workflow-as-versioned-artifact. Acceptable at this scale.
Shared-secret webhook vs. signed requests/OAuth. Adequate for a private
prototype; would be upgraded for any real deployment.
Synchronous webhook response vs. full async status polling. The intake
API returns "accepted" immediately; the UI shows results once Supabase rows
appear. Simpler than a status-push channel; slight UX delay is fine for a demo.
19. Future Improvements
Real lead-source integration (live Facebook Lead Ads webhook) replacing the
Test Lead interface (spec §25).
AI provider abstraction if a second provider is ever needed.
Prompt versioning + historical accuracy tracking for lead scoring.
Configurable counselor routing beyond round-robin.
Webhook signature verification (HMAC) replacing the shared-secret header.
Background scheduler if follow-up reminders ever need time-based triggers
(none required for MVP).
Role-scoped visibility on automation logs beyond Operations/Admin.
Phase 2 entry point: define the Supabase schema + RLS policies → build the
n8n workflow JSON with credentials and retry config → scaffold Next.js with
Auth, Test Lead intake, and the Lead Dashboard.

text


---

## 📄 File 2: `docs/architecture/system-architecture.mmd`

```mermaid
flowchart TB
    subgraph USER["Internal Staff (browser)"]
        U1["Admissions Counselor"]
        U2["Operations Manager / Admin"]
        U3["Marketing Staff / Teacher"]
    end

    subgraph NEXTJS["Next.js Application"]
        UI["Role-scoped UI<br/>(Dashboards, Test Lead Intake,<br/>AI Tools, Governance pages)"]
        API1["POST /api/leads/submit<br/>auth + shape check"]
        API2["/api/ai/* proxy routes<br/>interactive tools"]
    end

    subgraph SUPA["Supabase (single project)"]
        AUTH["Supabase Auth<br/>(seeded demo users)"]
        RLS["Row-Level Security"]
        DB[("PostgreSQL<br/>leads · lead_analyses · tasks<br/>sent_emails · notifications<br/>automation_runs · automation_run_steps<br/>profiles · courses")]
    end

    subgraph N8N["n8n (single instance)"]
        WF["Admissions Lead Pipeline<br/>F-002 – F-012<br/>+ error/retry F-013/F-014"]
    end

    subgraph EXT["External Services"]
        OAI["Google Gemini API"]
        GM["Gmail API<br/>(service account sender)"]
    end

    U1 & U2 & U3 --> UI
    UI --> AUTH
    UI -->|Server Components<br/>RLS-enforced reads| RLS
    RLS --> DB
    UI --> API1
    API1 -->|"HTTPS + x-webhook-secret"| WF
    API2 --> OAI
    WF -->|"service-role key<br/>(RLS bypass, attribution fields)"| DB
    WF --> OAI
    WF --> GM
📄 File 3: docs/architecture/admissions-workflow.mmd
invalid (permanent)

valid

invalid JSON (permanent)

valid

yes (local/dev)

no

Test Lead submitted (F-001)
Next.js UI → /api/leads/submit
(auth + RBAC + payload shape check)

n8n Webhook Trigger (F-002)
shared-secret verified

Lead Validation (F-003)
required fields, format, sanitization

AI Lead Analysis (F-004)
Gemini → structured JSON

Schema validation
(Code node)

Lead Scoring (F-005)
score 0–100

Classification (F-006)
HOT / WARM / COLD + intent

CRM Storage (F-007)
Supabase: leads + lead_analyses

AI Response Generation (F-008)
Gemini drafts first-touch email

Gmail dry-run?

Automated Email (F-009)
Gmail API send

Follow-up Task (F-010)
Supabase task row
counselor = round-robin/default

Counselor Notification (F-011)
in-app notification row
+ Gmail email copy

Automation Logging (F-012)
every step → automation_runs /
automation_run_steps in Supabase

HALT — log failure, no retry

Mark sent_emails row as dry_run

📄 File 4: docs/architecture/error-flow.mmd
no

yes

Missing field, malformed email,
schema mismatch, constraint violation,
RLS denial

Gemini 5xx / timeout / rate limit,
Gmail 5xx / network,
Supabase 5xx / connection

yes

no

Pipeline step executing

Step failed?

Continue to next step
log step: success

Classify error

PERMANENT
No retry

TRANSIENT
Retryable

Attempt < 3?

Backoff
2s → 4s → 8s

Retry step

Final failure

n8n Error Workflow

Write terminal failure record
automation_runs = FAILED
automation_run_steps = failed + error detail

Visible in Automation Logs Viewer (F-019)
as a failed, inspectable run

All steps done
automation_runs = SUCCESS
all Supabase rows written

Visible in Lead Dashboard (F-017)
and Automation Logs Viewer (F-019)

Phase 1 Summary
1. Architecture Summary
A four-layer architecture sized for one developer: Next.js (all UI + a thin auth-gated API layer), Supabase (single managed Postgres project with Auth + RLS — the only source of truth), n8n (single instance owning the Admissions pipeline end-to-end), and Gemini + Gmail as external services. One governing rule: n8n orchestrates and integrates; Next.js serves humans; Supabase persists; Gemini thinks; Gmail transports. The dashboard reads exclusively from Supabase, never from n8n's internal store.

2. Component Responsibilities (condensed)
Component
Owns
Never does
Next.js frontend	Role-scoped UI, Test Lead intake, tool forms, governance pages	Call Gemini/Gmail/n8n from the browser
Next.js API layer	Auth/RBAC gate, payload shape check, webhook forward, interactive AI proxy	Scoring, orchestration, retry, email logic
Supabase	Persistence, identity, RLS, automation logs	AI inference, orchestration, business rules
n8n	The full Admissions pipeline, retries, error workflow, external integrations	UI, human auth, source-of-truth storage
Gemini	All AI inference (pipeline JSON + interactive drafts)	Self-validating output, persistence
Gmail	Sending 2 email types from one service account	Composing content, record keeping

3. End-to-End Admissions Data Flow
Staff submits a Test Lead in the UI → POST /api/leads/submit checks session/role/payload shape → forwards to the n8n webhook with the shared-secret header → n8n validates (invalid = halt+log) → Gemini returns the analysis JSON, schema-validated in a Code node → score 0–100 + HOT/WARM/COLD → Supabase rows (leads, lead_analyses) → Gemini drafts the first-touch email → Gmail sends (or dry-run marks it) → follow-up task created with round-robin/default counselor → in-app notification + counselor email copy → every step logged to automation_runs/automation_run_steps → the Lead Dashboard shows the lead, the Logs Viewer shows the run — all via RLS-enforced Supabase reads.

4. Main Failure Points
Gemini transient errors (5xx/rate limit) — retried ×3 with backoff.
Gemini malformed JSON — permanent, schema node halts before persist.
Gail auth/revoked token (401) — permanent, halts at send step.
Supabase transient connection errors — retried.
Constraint/RLS denials on n8n writes — permanent, logged.
Webhook secret misconfiguration — request rejected at trigger; surfaces as an immediate 401 to the API caller.
Every failure terminates as either full success or a structured failed run in Supabase — nothing is silently dropped.
5. Key Architecture Decisions
AD-1: n8n owns the pipeline end-to-end (retry/logging are first-class nodes; the workflow is portfolio evidence).
AD-2: Interactive AI tools bypass n8n — synchronous + human-reviewed, so n8n adds latency for nothing.
AD-3: One Supabase project; zero added infrastructure.
AD-4/AD-5: Schema-validate AI output before persist; logs live in Supabase so the dashboard sees them under RLS.
AD-9: n8n uses the service-role key (trusted system actor) with attribution fields.
AD-12: Gmail dry-run toggle for local dev.
6. Assumptions (to confirm before Phase 2)
Webhook transport is HTTP(S) with a shared-secret header (no HMAC signing).
One n8n instance, not horizontally scaled; no queue mode.
Gemini model selection deferred to implementation.
Schema validation lives in a dedicated n8n Code node.
Counselor notification = in-app Supabase row and Gmail email copy.
Gmail dry-run flag for local development.
No background scheduler is needed for the MVP.
7. Over-Engineering Deliberately Avoided
No message queue / Redis / Kafka — n8n's built-in per-node retry replaces a job system.
No microservices / second backend framework — Next.js API routes + n8n cover all server needs.
No AI provider abstraction layer — direct Gemini calls; a swap later is an accepted refactor cost.
No async status-push channel — the UI simply re-reads Supabase; a 202 response is enough.
No custom logging pipeline — Supabase tables + n8n's editor UI; no log aggregation.
No counselor load-balancing engine, no email scheduling service, no local Supabase emulator — the free cloud tier + round-robin + dry-run flag cover the prototype.