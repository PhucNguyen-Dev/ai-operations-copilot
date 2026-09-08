AI Operations Copilot — Phase 7 Summary (Governance)
Status: Phase 7 — complete. All 30 roadmap features (P0+P1+P2) are built.
Derived from: PRODUCT_SPEC.md §13–§17, FEATURES.md F-026–F-030
Scope: portfolio governance evidence — genuine tool experiments, one adoption decision, and designed training/workshop/SOP artifacts

1. What Phase 7 Delivers
Five governance features, one page hub (/governance), two new database tables, and one reusable experiment runner:
- F-026 AI Tool Lab: 4 genuine experiments recorded against real department tasks (raw evidence committed: docs/governance-data/experiments.json)
- F-027 AI Tool Evaluation: 1 documented adoption decision — gemini-3.5-flash-lite, scored 36/40, "Recommended" with conditions
- F-028 Employee AI Training: designed per-department programs (Marketing, Admissions, Academic, Operations)
- F-029 Internal AI Workshop: "AI for Everyday Work" 90-minute agenda with facilitator guide
- F-030 Internal AI Documentation/SOP: 7 SOPs, with the Troubleshooting SOP sourced from real incidents

2. The Genuine Experiments (spec §13 requires real work, not placeholders)
All runs executed by scripts/run-lab-experiments.mjs against the live Gemini API on the actual production prompt:
A. Head-to-head — gemini-3.5-flash vs gemini-3.5-flash-lite on the F-004 lead-qualification prompt
   (5 runs each, 3 rotating real leads, JSON mode, temperature 0.4):
   - flash:      5/5 parse · 5/5 schema-valid · 4/5 category-correct · avg 3,693 ms
   - flash-lite: 5/5 parse · 5/5 schema-valid · 5/5 category-correct · avg 1,056 ms
   - Verdict: flash-lite matched every hard requirement, classified all leads correctly, and was ~3.5× faster → adopted as the production model.
B. Negative control — gemini-2.0-flash (retired): HTTP 404 in 159 ms with Google's migration message. Kept as evidence
   that model retirement fails as a plain 404 — the reason the app now classifies 404 as a permanent AI_CONFIG error.
C. JSON-mode vs plain-prompt — quiz generation on flash-lite: parity (3/3 parse each, ~1.7 s). JSON mode kept as the
   project-wide guardrail (R-02) because it costs nothing and removes reliance on instruction-following.
Context from the build period: the free tier's per-model daily quota exhausted once
mid-testing, and retired models were discovered the hard way — both limitations are recorded in the experiment rows.

3. The Adoption Decision (spec §14)
gemini-3.5-flash-lite — scored on the 8 spec criteria:
Quality 4 · Accuracy 5 · Cost 5 · Speed 5 · Ease of Use 5 · Integration 5 · Security/Privacy 4 · Scalability 3 → 36/40
Recommendation: Recommended, conditional on free-tier quota limits.
Rationale (short): matched the larger model on every hard requirement at ~3.5× the speed, zero cost, one-line model swap;
the honest weak spot is scalability — per-model daily quota exhausted once during testing, so real growth would need a
paid tier or a model-fallback chain. Every score cites an experiment.

4. Database (supabase/migrations/004_governance.sql)
- tool_experiments: tool, category, business_task, test_definition, output_summary, per-criterion notes (quality/speed/
  cost/ease/integration/limitations), evidence file
- tool_evaluations: tool, use_case, scores jsonb (8 criteria), total, recommendation (recommended/conditional/
  not_recommended), rationale, strengths/weaknesses arrays, experiment_refs uuid[] (decision → evidence linkage)
- RLS: all authenticated staff read; writes restricted to admin/operations (by profile role).
- Seed: supabase/seed_governance.sql (idempotent), populated from the real experiment output.

5. Pages
- /governance — hub with live counts and links
- /governance/tool-lab — head-to-head comparison table + full experiment records (including the negative result)
- /governance/tool-evaluation — scored criteria bars, total, recommendation, rationale, strengths/weaknesses
- /governance/training — 4 department programs: objectives, agenda, practical exercise, prompt template, review rule
- /governance/workshop — 90-minute agenda table, hands-on exercise brief, facilitator guide
- /governance/sop — 7 SOPs (Usage Guidelines, Prompt Guide, Lead Handling, Response Review, Automation User Guide,
  Troubleshooting, Data Privacy), each with steps and escalation path
Governance is visible to all roles in the nav (reading governance material is everyone's business; changing adoption
decisions is Operations/Admin — enforced by RLS, not just the UI).

6. Assumptions honored (spec §21)
- Experiments and evaluation records are genuine work performed during the project, with committed raw output — Assumption 9 ✓
- Training and workshop content are designed artifacts; no claim of real delivery — Assumption 10 ✓
- Tool Lab is a structured record, not a live execution sandbox — explicitly permitted by spec §13 ✓

7. What was deliberately avoided
- No live tool-execution sandbox in the app (experiments run from a script; the app displays evidence)
- No weighted scoring model in the evaluation (equal weights, transparent totals)
- No interactive training delivery/tracking (designed content only, per spec)
- No fake "5–8 tools" padding — 2 live models + 1 negative control beat 8 hypotheticals for honesty

8. Project complete — the 30-feature roadmap is fully built
Phase 0 spec → Phase 1 architecture → Phase 2 database/RLS → Phase 3 core pipeline → Phase 4 response/actions/error
handling → Phase 5 dashboards → Phase 6 department AI tools → Phase 7 governance.
Success criteria (spec §24): all seven bullets are demonstrable — end-to-end automated lead handling (E2E-verified:
run success, 8/8 steps logged, dry-run email, task, notification), inspectable logs, graceful single-step failure
handling, five working department tools, genuine tool experiments, one documented adoption decision, and complete
governance content.

9. Known limitations (honest list)
- Gmail sending is dry-run by design locally; real sends need credentials + GMAIL_DRY_RUN=false
- Gemini free-tier quota can interrupt heavy testing; mitigation is model switching or a paid tier
- Model names age quickly (2.0/2.5 generations retired during this project); AI_MODEL is env-pinned and swappable
- Real incidents and their root causes live in the project's internal lessons-learned register — the Troubleshooting SOP links there

10. Future work: governance-driven access (the registry loop)

Phase 7 is deliberately static — documents and records, per spec §13/§15/§17. The natural evolution for a real
deployment is to make governance a **loop that drives access**, not just evidence of judgment:

    Decision → Approved-tool Registry → Access → Training gate → Usage → Audit → back to Decision

Concretely, mapped onto this codebase:
- `tool_evaluations` gains an approval status + department scope → becomes an **approved-tool registry**.
  A "Recommended" decision no longer just documents itself; it flips a status: tool X approved for departments
  A and B, under condition C.
- Tool access stops being hardcoded. Today `canUseTool(role, 'F-020')` (lib/roles.ts, lib/auth.ts, wired in
  components/site-header.tsx and the API routes) is static code. The registry version reads: *Marketing can use
  the Content Generator because evaluation #id approved it for Marketing on date Y* — so governance decisions
  can grant or revoke tool access per role, and every tool page displays
  "Approved for: [roles] · per evaluation [id/date] · training required".
- Training becomes the entry ticket: each department training module gets a completion record, and access to
  a tool can require its department's training. The workshop/training content stays a document — but it gates
  something real.
- The audit surfaces that already exist (`ai_generations` usage logs, `automation_runs`) close the loop:
  usage volume and incidents feed periodic re-evaluation, and a "conditional" approval's conditions get
  re-checked against real data.

Communication-app integration (alerts to employees): registry state changes — tool approved, tool revoked,
training now required, a conditional approval's condition triggered — should notify the affected employees
automatically. The natural connector is the **n8n instance already in the stack** (it owns all webhook
orchestration): a workflow watches registry changes and posts to Slack / Telegram / Microsoft Teams (or email
via Gmail), e.g. "Lesson Planner access revoked pending re-evaluation — complete the Academic training module
to restore access" or "Content Generator is now approved for Marketing; training session on Thursday."
No new infrastructure is needed — it is one more workflow plus registry webhook hooks.

Why not built now: the spec intentionally scopes governance as designed artifacts and records. The registry
loop is the next phase of a real deployment — and the fact that every ingredient for it (evaluations table,
role gating, training content, usage logs, an orchestration engine) already exists in this codebase is
itself part of the design story.

11. Future work: live lead sources & social auto-reply

The prototype's front door is deliberately an internal Test Lead form (spec §9, §23) — the pipeline, however,
is already a webhook waiting for JSON. Two levels of "going live" are foreseeable:

a) Auto-collecting real customer submissions (planned — spec §25): a live Facebook Lead Ads (or Google Ads
   lead form, website chat export, etc.) webhook replaces the Test Lead form. Because the pipeline's trigger
   is a plain webhook accepting a documented JSON shape, the real version is one n8n branch: platform event →
   map the platform's fields to the lead shape → existing webhook. Nothing downstream changes: validation,
   AI analysis, scoring, CRM, email, tasks, notifications, and logging all work unchanged.

b) Auto-answering on social media (not in scope — gated future concept): a bot that converses with prospects
   in Messenger/Instagram DMs or replies to comments. Technically it is a second branch off the same analysis
   (the pipeline already generates a personalized first-touch response; route it to Messenger instead of
   Gmail), but it changes the system's risk class and is therefore gated behind explicit design decisions:
   public, unreviewed AI output (breaks the "AI drafts, humans decide" principle), platform API policies and
   spam limits, and an approval policy defining when the bot may speak and when it must hand off to a human.
   If ever built: bot replies are drafted by the same schema-gated analysis, logged in a new sent-channel
   record alongside sent_emails, reviewed in an approvals dashboard, and covered by new SOPs — same
   governance pattern as everything else in this system.
