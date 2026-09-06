# AI Operations Copilot — Feature Inventory

Phase 0 feature inventory, derived from `PRODUCT_SPEC.md`. This is a scope document, not an implementation plan — no API, schema, or n8n node design is implied by this table.

Priority legend: **P0** = core/must be fully functional, **P1** = important/functional prototype, **P2** = supporting/demonstration/documentation.

---

## Feature Table

| ID | Feature | Department | Description | User Role | Priority | AI Required | Automation Required | Input | Output | Dependencies | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-001 | Test Lead / Lead Intake | Admissions | Internal interface to inject a simulated incoming lead (as if from Facebook Lead Ads, CRM, or another external source), used for development/demo — not a public student form | Admissions Counselor, Admin | P0 | No | No | Simulated lead fields (name, email, phone, course interest, message, source) | Lead payload submitted to pipeline | Next.js frontend | Done |
| F-002 | n8n Webhook Trigger | Admissions | Receives the lead payload and starts the automation pipeline | System | P0 | No | Yes | Lead payload | Triggered n8n workflow execution | F-001 | Done |
| F-003 | Lead Validation | Admissions | Validates required fields and formats; rejects malformed submissions before AI analysis | System | P0 | No | Yes | Raw lead payload | Valid/invalid result, sanitized payload | F-002 | Done |
| F-004 | AI Lead Analysis | Admissions | Calls the Gemini API to extract structured signals from the lead | System | P0 | Yes | Yes | Sanitized lead payload | JSON: score, category, intent, course, timeline, summary, recommended_action | F-003, Gemini API | Done |
| F-005 | Lead Scoring | Admissions | Derives a numeric score (0–100) indicating conversion likelihood | System | P0 | Yes | Yes | Lead payload + context | Score value | F-004 | Done |
| F-006 | Lead Classification | Admissions | Classifies the lead as HOT / WARM / COLD and assigns intent level, from AI analysis | System | P0 | Yes | Yes | AI analysis output | Category + intent labels | F-004 | Done |
| F-007 | CRM Storage | Admissions | Persists the lead record and AI analysis to Supabase | System | P0 | No | Yes | Validated lead + AI analysis JSON | Stored CRM row | F-003, F-004, Supabase | Done |
| F-008 | AI Response Generation | Admissions | Generates a personalized first-touch email draft based on lead analysis | System | P0 | Yes | Yes | AI analysis + lead data | Email subject + body text | F-004, Gemini API | Done |
| F-009 | Automated Email | Admissions | Sends the generated response to the lead via the Gmail API | System | P0 | No | Yes | Email subject + body, recipient address | Sent email confirmation | F-008, Gmail API | Done |
| F-010 | Follow-up Task | Admissions | Creates a follow-up task record assigned to a counselor | System | P0 | No | Yes | Lead ID, recommended_action, category | Task record in Supabase | F-006, F-007 | Done |
| F-011 | Counselor Notification | Admissions | Notifies the assigned counselor of a new hot/warm lead | Admissions Counselor | P0 | No | Yes | Task record, counselor contact | Notification (in-app and/or email) | F-010 | Done |
| F-012 | Automation Logging | Admissions | Logs every pipeline run — steps executed, status, timestamps, payload snapshots | Operations Manager, Admin | P0 | No | Yes | Execution metadata from each step | Log record in Supabase | F-002–F-011 | Done |
| F-013 | Error Handling | Admissions | Catches step failures (validation, AI call, email send, DB write) so the pipeline fails gracefully instead of crashing | System | P0 | No | Yes | Error from any pipeline step | Structured error record; pipeline halts/continues gracefully | F-002–F-011 | Done |
| F-014 | Retry Handling | Admissions | Automatically retries transient failures (e.g., Gemini/Gmail API timeouts) with backoff, at the workflow level | System | P0 | No | Yes | Failed step + retry count | Retry attempt result (success or final failure) | F-013 | Done |
| F-015 | Authentication | Platform | Login and session management for internal staff roles | All roles | P0 | No | No | Credentials | Authenticated session | Supabase Auth | Done |
| F-016 | Role-Based Access Control | Platform | Restricts module/page visibility and actions based on user role | All roles | P0 | No | No | User role claim | Access-filtered UI/routes | F-015 | Done |
| F-017 | Lead Dashboard | Admissions | Lists leads with score, category, and status; filter by category and date | Admissions Counselor, Admin | P1 | No | No | Filter/sort query params | Lead list view | F-007, F-015, F-016 | Done |
| F-018 | Lead Detail View | Admissions | Shows a full lead record: AI analysis, task history, and sent email | Admissions Counselor, Admin | P1 | No | No | Lead ID | Lead detail page | F-007, F-010, F-015, F-016 | Done |
| F-019 | Automation Logs Viewer | Operations | UI to inspect automation execution logs, filterable by status/date | Operations Manager, Admin | P1 | No | No | Filter/date query params | Log list/detail view | F-012, F-015, F-016 | Done |
| F-020 | AI Content Generator | Marketing | Generates draft ad/social copy (headlines, CTA, variations) from a campaign brief | Marketing Staff | P1 | Yes | No | Campaign, audience, platform, tone, objective | Draft headlines/copy/CTA variations | Gemini API, F-015, F-016 | Done |
| F-021 | Campaign Analyzer | Marketing | Summarizes manually entered/CSV campaign metrics into performance insights | Marketing Staff | P1 | Yes | No | Campaign metrics (manual entry or CSV) | Performance summary, strong/weak segments, trends, recommendations | Gemini API, F-015, F-016 | Done |
| F-022 | AI Lesson Planner | Academic | Generates a structured lesson plan from grade/level, subject, topic, and duration | Teacher | P1 | Yes | No | Grade/level, subject, topic, duration, objectives | Lesson structure, activities, materials, homework | Gemini API, F-015, F-016 | Done |
| F-023 | AI Quiz Generator | Academic | Generates quiz questions, answers, and explanations from a topic or source content | Teacher | P1 | Yes | No | Topic, difficulty, question count/type, optional source content | Questions, answers, explanations | Gemini API, F-015, F-016 | Done |
| F-024 | AI Report Generator | Operations | Generates an executive summary and metrics report from operational data | Operations Manager | P1 | Yes | No | Operational data, date range, selected metrics | Executive summary, key metrics, problems, trends, recommendations | Gemini API, Supabase, F-015, F-016 | Done |
| F-025 | Operations/Admin Dashboard | Operations | Cross-department overview: lead volume, automation health, department tool activity | Operations Manager, Admin | P1 | No | No | System data | Overview dashboard | F-007, F-012, F-015, F-016 | Done |
| F-026 | AI Tool Lab | Governance | Records hands-on AI tool experiments against real business tasks: tool selected, test defined, results, comparison, findings | Operations Manager, Admin | P2 | No | No | Tool name, test definition, output, cost/speed/quality notes | Experiment record, comparison notes | F-015, F-016 | Done |
| F-027 | AI Tool Evaluation | Governance | Structured adoption decision for a candidate AI tool, scored against defined criteria | Operations Manager, Admin | P2 | No | No | Tool name, scores across evaluation criteria | Evaluation record with recommendation (Recommended / Conditional / Not Recommended) + rationale | F-015, F-016, F-026 (informs evaluation) | Done |
| F-028 | Employee AI Training | Governance | Designed training content per department on responsible AI use in that role | All roles | P2 | No | No | N/A (static designed content) | Per-department training material pages | F-015, F-016 | Done |
| F-029 | Internal AI Workshop | Governance | Designed workshop agenda ("AI for Everyday Work") describing session structure and content | All roles | P2 | No | No | N/A (static designed content) | Workshop agenda page | F-015, F-016 | Done |
| F-030 | Internal AI Documentation / SOP | Governance | Written internal guidance: AI Usage Guidelines, Prompt Guide, Lead Handling SOP, Response Review SOP, Automation User Guide, Troubleshooting Guide, Data Privacy Guidelines | All roles | P2 | No | No | N/A (static markdown content) | SOP documentation pages | F-015, F-016 | Done |

---

## Feature Count by Priority

| Priority | Count |
|---|---|
| P0 | 16 |
| P1 | 9 |
| P2 | 5 |
| **Total** | **30** |

---

## Notes

- P0 = the complete Admissions pipeline (F-001–F-014) plus the platform baseline required to run and secure it (F-015 Authentication, F-016 RBAC). Nothing outside the Admissions pipeline is P0.
- P1 = dashboards needed to observe pipeline/tool output, plus one working AI tool per remaining department (Marketing x2, Academic x2, Operations x1).
- P2 = governance evidence (tool experimentation, tool adoption decisions, training design, workshop design, SOP documentation). These are intentionally scoped as records/documentation rather than interactive systems.
- F-026 (AI Tool Lab) and F-027 (AI Tool Evaluation) are related but distinct: F-026 is experimentation, F-027 is an adoption decision. F-027 may reference F-026 findings but does not depend on a specific tool count or format from it.
- "Status" values should be updated as work proceeds (`Planned` → `In Progress` → `Done`). No feature has started implementation as of this Phase 0 document.
