# AI Operations Copilot

**Type:** Portfolio prototype — internal business operations platform
**Status:** Historical Phase 0 product definition and assumed requirements, retained as design context; not current implementation status.

## Reading this historical specification

The numbered sections below preserve the original scope, targets and assumptions. They are not discovery findings from a real school or evidence of delivered outcomes. Later additions include the Telegram customer-facing chatbot, governed agents, signed intake and external REST; the original claims of no code, no public-facing surface and no additional principals are therefore historical, not current facts. The original shadcn/ui constraint is not a claim that the current UI uses it.

Current sources: [FEATURES](FEATURES.md), [ARCHITECTURE](ARCHITECTURE.md), [AGENT_CORE](AGENT_CORE.md), [EXTERNAL_API](EXTERNAL_API.md), and [remaining work](ROADMAP.md). Historical success criteria are targets, not passed acceptance tests. The AI score is a heuristic, agent email remains dry-run, and provider-shaped intake is not a live Facebook/Zalo account integration. See the explicitly [simulated Vietnamese school case study](case-study/README.md) for the local+tunnel demonstration plan; no real interviews, users or business results are claimed.

---

## 1. Product Overview

AI Operations Copilot is a prototype **internal operations platform** for a simulated education/training company. It demonstrates how AI and workflow automation can be applied inside a real organization's departments — Admissions, Marketing, Academic, and Operations — to reduce repetitive manual work and speed up internal processes.

This is not a public-facing product. There is no student portal, no public marketing site, and no customer-facing surface. Every screen and workflow in this system is used by employees (or by automation acting on their behalf). The project exists to demonstrate the skill set of an **AI Automation Specialist**: identifying automatable business processes, designing AI use cases, building automated pipelines, evaluating AI tools, and producing internal AI governance material.

---

## 2. Business Problem

Education/training companies generate leads continuously (ads, referrals, partner channels) and run recurring internal processes that are largely manual today:

- Leads arriving from external sources are manually read, qualified, and routed by admissions staff — response time is slow and inconsistent, which directly hurts conversion.
- Marketing staff manually draft ad copy, captions, and campaign summaries for every campaign.
- Teachers manually build lesson plans and quizzes from scratch for each class/topic.
- Operations managers manually assemble recurring operational reports from data scattered across systems.
- There is no consistent, documented way for staff to evaluate new AI tools before using them, or to be trained on safe/effective AI usage — adoption is ad hoc and unmanaged.

---

## 3. Business Goals

- Reduce repetitive manual work across all four departments.
- Improve employee productivity through AI-assisted drafting, analysis, and reporting.
- Respond to incoming leads faster through automation.
- Automate repetitive internal communication (lead response emails, notifications, task creation).
- Give employees AI assistance for content creation, lesson/quiz preparation, and reporting — with human review built into the workflow, not bypassed by it.
- Establish a repeatable process for evaluating new AI tools before adoption.
- Provide a structure for training employees to use AI effectively and safely.
- Establish internal AI usage guidelines (SOPs) so AI use is consistent and auditable.

---

## 4. Target Organization

A simulated mid-sized education/training company (e.g., a language center or exam-prep institute) that runs paid lead generation, enrolls students into courses, and operates internal marketing, academic, and operations functions. No real company, employees, or students are represented; all data in the prototype is synthetic.

---

## 5. Departments

| Department | Primary Responsibility |
|---|---|
| Admissions | Qualify and respond to incoming leads, convert them toward enrollment |
| Marketing | Produce campaign content, analyze campaign performance |
| Academic | Plan lessons, create quizzes/assessments |
| Operations | Compile operational reports, manage internal AI governance (tool evaluation, training, SOPs) |

---

## 6. User Roles

| Role | Description | Primary Modules |
|---|---|---|
| Admin | Full system access; manages users and views all data/logs across departments | All modules |
| Marketing Staff | Uses content generation and campaign analysis tools | Marketing |
| Admissions Counselor | Views/manages leads, receives notifications, works assigned follow-up tasks | Admissions |
| Teacher | Uses the lesson planner and quiz generator | Academic |
| Operations Manager | Generates reports, reviews automation logs, owns AI Tool Lab / Evaluation / Training / SOP content | Operations, Governance |

**System actor (non-human):** the n8n automation pipeline acts as a system actor for the Admissions workflow — it validates, analyzes, stores, and notifies without a human triggering each step. It is not a user role with login access; it is referenced in FEATURES.md as "System" where relevant.

No additional roles are introduced beyond those listed above.

---

## 7. Core Business Processes

1. **Lead intake and qualification** (Admissions) — the primary process, automated end-to-end from lead arrival to counselor follow-up.
2. **Campaign content production and analysis** (Marketing) — AI-assisted drafting and summarization, human-reviewed before use.
3. **Lesson and quiz preparation** (Academic) — AI-assisted generation, human fact-checked before classroom use.
4. **Operational reporting** (Operations) — AI-assisted summarization of internal operational data.
5. **AI tool experimentation and evaluation** (Operations/Admin) — structured process for testing and deciding whether to adopt a new AI tool.
6. **Employee AI training and internal documentation** (Operations/Admin) — designed (not delivered) training content and SOPs governing AI use.

---

## 8. AI Use Cases

| Use Case | Department | AI Task |
|---|---|---|
| Lead analysis | Admissions | Score, classify, extract intent/course/timeline, summarize, recommend next action |
| Personalized response generation | Admissions | Draft first-touch email based on lead analysis |
| Content generation | Marketing | Draft headlines, ad copy, social copy, and CTA variations from a campaign brief |
| Campaign analysis | Marketing | Summarize campaign metrics; identify strong/weak segments, trends, recommendations |
| Lesson planning | Academic | Generate a structured lesson plan (structure, activities, materials, homework) |
| Quiz generation | Academic | Generate quiz questions, answers, and explanations from a topic or source content |
| Report generation | Operations | Generate an executive summary, key metrics, problems, and trends from operational data |

All AI output in this system is treated as **draft/assistive material**. Admissions email sending is automated per the business scenario, but every step is logged; all other department AI outputs (content, lesson plans, quizzes, reports) are explicitly designed for human review before use.

---

## 9. Core Admissions Workflow

This is the primary, fully automated workflow and the strongest demonstration of AI + automation working together.

**Important scope clarification:** the lead entry point in this system is a **Test Lead / Lead Intake Interface** — an internal tool used to simulate an incoming lead from an external source (Facebook Lead Ads, CRM, or another channel) for development and demonstration purposes. It is **not** a public-facing form for prospective students. No real external lead-source integration (e.g., a live Facebook Ads connection) is built; the interface exists to inject a lead payload into the pipeline as if it had arrived from one of those sources.

```
External Lead Source (simulated via Test Lead / Lead Intake Interface)
   → n8n Webhook
   → Lead Validation
   → AI Lead Analysis
   → Lead Scoring
   → HOT / WARM / COLD Classification
   → CRM Storage (Supabase)
   → AI Personalized Response
   → Automated Email (Gmail API)
   → Follow-up Task
   → Counselor Notification
   → Automation Logging
```

Error handling and retry logic wrap each automated step; failures are captured in the automation log rather than silently dropped.

Example AI output contract:

```json
{
  "score": 92,
  "category": "HOT",
  "intent": "HIGH",
  "course": "IELTS",
  "timeline": "3 months",
  "summary": "...",
  "recommended_action": "Contact within 30 minutes"
}
```

The exact scoring methodology (prompt design, weighting, thresholds) is an implementation detail deferred to a later phase — Phase 0 only defines the required inputs, outputs, and pipeline shape.

---

## 10. Marketing Use Cases

**AI Content Generator**
- Input: campaign, target audience, platform/channel, tone, objective.
- Output: headlines, ad copy, social copy, CTA, multiple variations.
- Nature: an assistive drafting tool. Output is a starting point for a human marketer, not a final published asset.

**Campaign Analyzer**
- Input: campaign metrics/data, entered manually or via CSV/mock data upload.
- Output: performance summary, strong segments, weak segments, trends, recommendations.
- Nature: summarization/insight tool over data the user provides — not a live analytics platform and not connected to real ad accounts.

---

## 11. Academic Use Cases

**AI Lesson Planner**
- Input: grade/level, subject, topic, duration, objectives.
- Output: lesson structure, activities, materials list, homework.
- Human review: the teacher is expected to review and adapt the plan before use; this is stated explicitly as part of the product concept, not left implicit.

**AI Quiz Generator**
- Input: topic, difficulty, number of questions, question type, optional source content.
- Output: questions, answers, explanations.
- Human review: the teacher fact-checks generated questions/answers before administering them — generated content is not assumed correct by default.

---

## 12. Operations Use Cases

**AI Report Generator**
- Input: operational data, selected date range, selected metrics.
- Output: executive summary, key metrics, problems, trends, recommendations.
- Nature: summarizes data already present in the system (e.g., lead volume, automation success/failure counts) — it does not pull from external data sources.

---

## 13. AI Tool Lab

The AI Tool Lab demonstrates hands-on experimentation with AI tools, not a bookmark list of AI websites. It represents the research practice of an AI Automation Specialist: try a tool against a real business task, record what happened, and compare results.

**Process:**
```
Select AI tool(s)
   → Define a practical business test (tied to a real department task)
   → Run the test
   → Record results (output, time taken, cost, quality notes)
   → Compare results across tools tested for the same task
   → Document findings
```

**Tool categories in scope:** LLM, image generation, transcription, OCR, automation, research.

The implementation may be lightweight (a structured log/record of experiments rather than a live tool-execution sandbox), but the portfolio evidence must show genuine experiments and findings, not placeholder text.

---

## 14. AI Tool Evaluation

AI Tool Evaluation is distinct from AI Tool Lab:

| | AI Tool Lab | AI Tool Evaluation |
|---|---|---|
| Purpose | Experiment with a tool on a real task | Decide whether to formally adopt a tool |
| Output | Raw findings, notes, comparisons | A documented adoption decision |

**Evaluation criteria:**
- Output Quality
- Accuracy
- Cost
- Speed
- Ease of Use
- Integration
- Security / Privacy
- Scalability

**Recommendation outcomes:** Recommended / Conditional / Not Recommended, each with a documented rationale explaining *why* the tool received that outcome.

---

## 15. Employee AI Training

The system contains **designed training material and program structure**, per department, for how employees would use AI responsibly in their role. This is a designed artifact for the portfolio — it does not claim that real training was delivered to real employees.

| Department | Training Content |
|---|---|
| Marketing | AI content creation, prompting basics, campaign analysis with AI, output verification before publishing |
| Admissions | How AI lead scoring works, reviewing AI-generated responses, when to override AI, escalation process |
| Academic | Using the lesson planner and quiz generator, fact-checking generated content, responsible AI use in the classroom context |
| Operations | Using the AI Report Generator, interpreting AI-generated summaries, workflow automation basics |

---

## 16. Internal AI Workshop

A designed example workshop (content only — not claimed to have been delivered):

**"AI for Everyday Work" — 90 minutes**

| Time | Segment |
|---|---|
| 0–10 min | Introduction |
| 10–25 min | Prompting basics |
| 25–45 min | Department-specific use cases |
| 45–65 min | Live automation demonstration (Admissions pipeline) |
| 65–80 min | Hands-on exercise |
| 80–90 min | Q&A / best practices |

---

## 17. Internal AI Documentation / SOP

Documented internal guidance defining how staff should use and review AI output. Content only (markdown-based); not an interactive workflow engine.

- AI Usage Guidelines
- AI Prompt Guide
- AI Lead Handling SOP
- AI Response Review SOP
- AI Automation User Guide
- AI Troubleshooting Guide
- AI Data Privacy Guidelines

---

## 18. Product Scope

**In scope:**
- One complete, automated end-to-end business workflow: Admissions lead handling.
- A Test Lead / Lead Intake Interface to simulate external lead arrival (no live third-party lead-source integration).
- One AI-assisted tool per department beyond Admissions (Marketing x2, Academic x2, Operations x1).
- Role-scoped internal dashboards (leads, automation logs, admin overview).
- Automation execution logging with error handling and retry logic.
- Governance content: AI Tool Lab (experimentation records), AI Tool Evaluation (adoption decisions), Employee AI Training (designed program), Internal AI Workshop (designed agenda), Internal AI Documentation/SOP (written guidance).

**Out of scope:** see [Non-Goals](#23-non-goals).

---

## 19. MVP

The MVP is **one complete end-to-end business workflow**, plus the minimum platform needed to observe it:

```
Test Lead → n8n → AI Analysis → Lead Score → HOT/WARM/COLD →
Supabase CRM → AI Response → Email → Follow-up Task →
Counselor Notification → Automation Log → Internal Dashboard
```

Also included in the MVP: basic authentication and role-based access, so the dashboard and pipeline results are only visible to authorized internal roles.

**The MVP explicitly does not require:**
- A real Facebook API (or any live external lead-source) integration
- A real third-party CRM integration
- A mobile application
- A payment system
- Public student accounts
- Complicated analytics/BI
- Microservices
- Enterprise infrastructure (multi-region, HA, SSO, etc.)

This scope is realistic for a single developer to build and demonstrate.

---

## 20. P0 / P1 / P2 Priorities

### P0 — Core / Must Be Fully Functional
- Test Lead / Lead Intake Interface
- n8n Webhook Trigger
- Lead Validation
- AI Lead Analysis
- Lead Scoring
- Lead Classification (HOT/WARM/COLD)
- CRM Storage
- AI Response Generation
- Automated Email
- Follow-up Task Creation
- Counselor Notification
- Automation Logging
- Error Handling
- Retry Handling
- Authentication
- Role-Based Access Control

### P1 — Important / Functional Prototype
- Lead Dashboard
- Lead Detail View
- Automation Logs Viewer
- AI Content Generator (Marketing)
- Campaign Analyzer (Marketing)
- AI Lesson Planner (Academic)
- AI Quiz Generator (Academic)
- AI Report Generator (Operations)
- Operations/Admin Dashboard

### P2 — Supporting / Demonstration / Documentation
- AI Tool Lab
- AI Tool Evaluation
- Employee AI Training
- Internal AI Workshop
- Internal AI Documentation / SOP

Rationale: P0 is scoped tightly to the one workflow that must work end-to-end plus the platform baseline (auth/RBAC) required to make that workflow demonstrable and secure — nothing else is elevated to P0, so the project stays achievable for one developer. P1 covers functioning single-purpose AI tools and the dashboards needed to see pipeline/tool output. P2 covers governance material that is valuable evidence of AI-automation-specialist thinking but does not need to be a fully interactive system to make its point.

---

## 21. Assumptions

1. The Test Lead / Lead Intake Interface is an internal form (built in the app itself), used only by staff/developer to inject a simulated lead — not exposed publicly.
2. A single, small, seeded course catalog is assumed (e.g., IELTS, TOEFL, Business English) — not a full course management system.
3. Email sending uses a single sender/service account via the Gmail API, not per-counselor mailboxes.
4. Counselor assignment for a lead uses simple logic (round-robin or a single default counselor) for demonstration purposes, not a workload-balancing engine.
5. Campaign Analyzer accepts manually entered or CSV-uploaded metrics; there is no live ad-platform API integration.
6. Authentication uses Supabase Auth with seeded demo users per role; no SSO/enterprise identity provider.
7. "Retry Handling" means automatic retry with backoff for transient failures (e.g., Gemini/Gmail API errors) at the n8n workflow level — not a general-purpose job queue system.
8. All data in the system (leads, campaign metrics, students, staff) is synthetic; no real personal data is used.
9. AI Tool Lab experiments and AI Tool Evaluation records are genuine work performed by the developer during the project, documented as evidence — not simulated placeholder content.
10. Employee AI Training and Internal AI Workshop content are designed artifacts for portfolio evidence; no claim is made that real employees were trained or that a workshop was delivered.

---

## 22. Constraints

- Must run as a portfolio-scale prototype (single environment; no multi-region/high-availability requirements).
- Must use the specified stack: Next.js, TypeScript, Tailwind CSS, shadcn/ui, n8n, Google Gemini API, Supabase/PostgreSQL, Gmail API.
- AI outputs used downstream (e.g., lead analysis JSON) must be schema-validated before being persisted or acted upon.
- No production security certification (SOC2, ISO 27001, etc.) implied or required.
- Phase 0 defines product scope only — no API endpoints, database schema, n8n node configuration, Gemini model selection, authentication implementation, or deployment architecture are decided here; those belong to later phases.

---

## 23. Non-Goals

- Not a public student portal.
- Not a full education management system.
- Not a full CRM replacement (no deal pipelines, invoicing, contract management).
- Not a real Facebook Ads (or other live lead-source) integration.
- Not a full marketing automation platform.
- Not a Learning Management System (no course delivery, grading at scale, student login).
- Not a payment or checkout system.
- Not a mobile application.
- Not enterprise-scale infrastructure (no multi-tenancy, SSO, HA, microservices).
- Not a SaaS product — no subscription billing, no public sign-up, no multi-tenant account management.

---

## 24. Success Criteria

- A Test Lead submitted through the intake interface is validated, analyzed, scored, classified, stored, emailed, task-created, and notified — without manual intervention, in a single automated run.
- Automation log shows a complete, inspectable record of each pipeline step (status, timestamps, AI output, errors).
- A single-step failure (e.g., email send failure) is caught, logged, and retried without crashing the overall pipeline.
- Each department (Marketing, Academic, Operations) has at least one working AI-assisted tool reachable from its role-scoped dashboard.
- AI Tool Lab contains genuine experiment records comparing at least two tools on a real business task.
- AI Tool Evaluation contains at least one documented adoption decision with rationale.
- Employee AI Training, Internal AI Workshop, and Internal AI Documentation/SOP content exist and clearly communicate intended AI usage practices for each department.

---

## 25. Future Improvements

- Real lead-source integration (e.g., a live Facebook Lead Ads webhook) replacing the Test Lead / Lead Intake Interface.
- Real ad-platform integrations for Campaign Analyzer (Meta Ads, Google Ads APIs).
- Configurable counselor routing/load balancing.
- Multi-language lead handling.
- Prompt-versioned lead scoring with historical accuracy tracking.
- Role-scoped visibility on automation logs (currently viewed by Operations Manager/Admin only).
- LMS integration so Academic tools can publish directly into a course.
