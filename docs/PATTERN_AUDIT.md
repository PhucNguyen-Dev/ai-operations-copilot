# Whole-app pattern audit — AI-operations patterns across all 21 screens

Roadmap item **#4** (2026-09-20). Review deliverable: what AI-operations patterns the
product already has, which are worth adding, and which we deliberately reject. No code
was changed for this audit. Every claim was checked against the live code on the current
revision; page inventory cross-checked **21/21** pages under `app/**/page.tsx`.

## 1. Screen inventory (21/21)

| Surface | Screens | Primary pattern |
|---|---|---|
| Command center | `/` dashboard, `leads/new` | Operational KPIs, priority queue, inline AI next-actions |
| Lead workspace | `leads/[id]` | AI assessment → human approval → executed → audit timeline |
| Assistant | `/agent` Mission Control, `agent/approvals` | Governed chat, decisions inbox, run inspector |
| Automation | `runs`, `runs/[id]` | Execution logs with step-level status |
| Governance | hub, `tool-lab`, `tool-evaluation`, `training`, `workshop`, `sop` | Evidence-first adoption + human-review rules |
| Department tools | `content-generator`, `campaign-analyzer`, `lesson-planner`, `quiz-generator`, `report-generator` | Single-purpose AI tools, draft-only outputs |
| Platform | `admin`, `/login` | Ops health stats, role-demo login |

## 2. Present and worth keeping (evidence-backed)

| Pattern | Where it lives | Why it earns its place |
|---|---|---|
| **AI-content provenance tags** | Lead detail `AiTag` ("AI-generated"), email "draft · dry-run" labels, tool pages "Every output is a draft for your review" | The core honesty pattern — AI output is never presented as fact. |
| **Human approval affordance, not text** | Lead detail approve/edit/reject → `lead_action_decisions` (append-only); agent approvals inbox with independent-decider enforcement | Recommendation → decision → execution → audit, proven end-to-end. |
| **State honesty badges** | `badge-dry_run`, `sent_simulated` (blue, honest), task/automation status pills | Failed/simulated states are shown, never laundered into success. |
| **Trace transparency** | Run inspector (steps, tokens, status), StepTrace expander, `/runs` step timeline | Every AI answer is explainable down to the tool call. |
| **One snapshot, many surfaces** | `lib/ops/snapshot` powers dashboard KPIs + morning briefing | Dashboard and briefing can never disagree — drift is designed out. |
| **Role-scoped everything** | `NotAllowed` component on every gated page; RLS-backed queries; login page explains each role's visibility | Governance is visible in the UI, not just enforced invisibly. |
| **Deterministic numbers, verbatim AI copy** | Priority actions shows the model's recommended action word-for-word; briefing is SQL-only | No invented urgency, no paraphrased AI claims. |
| **"One rule" framing** | Guidelines page: "AI drafts — you decide", repeated in SOPs, training, workshop | Consistent human-oversight doctrine across all educational surfaces. |
| **Graceful error states** | Uniform red-panel pattern with server-side logging (`console.error('[page] …')`) on every data page | Failures are disclosed, logged, and actionable. |
| **Chat-theme scoping** | `.theme-dark` scoped to `.askx-surface` only (globals.css, theme-toggle, bubble, workspace) | The earlier full-app dark bleed was correctly contained to chat surfaces. |

## 3. Worth adding (ranked)

1. **Decisions count in the sidebar** (`app/(app)/layout.tsx`). Pending approvals are visible only inside `/agent/approvals` and a dashboard KPI. A badge on the nav entry turns approval from a place you remember into something that finds you. *Effort: low. Feeds: adoption of the governance chain.*
2. **Escape-to-close + minimize for the bubble** (`components/chat/AgentBubble.tsx`). The redesign spec promised Escape close; no keydown handler exists today. *Effort: low.*
3. **Real empty states for governance data** (`tool-lab`, `tool-evaluation`). Tool Lab has one (with seeding instructions); Tool Evaluation has none. *Effort: low. Feeds: first-run experience.*
4. **Cross-links from tools to Ask X.** Every tool page ends at a draft; none points to Ask X, which can chain follow-up actions. One line each closes the loop between the two AI surfaces. *Effort: lowest.*
5. **Unified status-pill taxonomy.** Task, automation-run, email and approval statuses each have their own color map (three separate `STATUS_STYLE` records, `badge-*`). One shared module prevents future drift. *Effort: medium, purely refactor.*

## 4. Should NOT add (with reasons)

| Rejected pattern | Why |
|---|---|
| Fake confidence scores / "AI certainty %" on cards | Nothing in the backend produces calibrated confidence; displaying it would fabricate a state the governance model forbids (same rationale as the 2026-09-20 dashboard rebuild). |
| Pipeline-diagram dashboards, neon "AI" styling | Already declined for the dashboard; adds motion without information. |
| External push channels (Telegram/Instagram/TikTok/YouTube) | Declined by design (situations #9); delivery stays in-app unless a dedicated opt-in ops bot exists. |
| Auto-publishing any AI output (tool pages, emails, quizzes) | Violates the "AI drafts — you decide" doctrine that every governance surface teaches. |
| Live token/step polling in chat | The approved redesign explicitly kept the run flow as-is; polling adds load and a second code path. |

## 5. Consistency findings (verified)

| # | Finding | Status |
|---|---|---|
| C1 | **"Dashboard bell" in the AI Lead Handling SOP does not exist.** `governance/sop` step 1 tells counselors to check notifications from a bell; no bell/notification component exists anywhere (code search: 0 matches). | **Stale copy — fix the SOP text** |
| C2 | **Bubble is missing the promised Escape handler** (spec Stage 5). | **Gap — add (rec #2)** |
| C3 | **`governance/training` is NOT orphaned.** The docs cleanup deleted only the file `docs/TRAINING.md`; the in-app feature is linked from the governance hub and from `/guidelines` (role-aware deep link). | Healthy |
| C4 | **Five `tools/*` pages are first-class, not legacy.** F-020–F-024 with role gates (`canUseTool`) and draft-only outputs; governance lab/evaluation pages reference the same feature IDs. The real gap is discoverability (rec #4), not existence. | Healthy, discoverability gap |
| C5 | **AI-tag consistency is good but not total.** Lead detail, chat email cards and tool pages all label AI output; the chat knowledge card ("Sources consulted") does not carry an AI tag — acceptable since citations are attributed, but worth one look if cards grow. | Minor |
| C6 | **Status color maps are triplicated** (runs list/detail, admin, lead badges). Same values today; drift risk tomorrow. | Refactor (rec #5) |

## 6. Ranked recommendations → next builds

1. **Governance papercut build** (recs 1 + 2 + 3 + C1 fix): sidebar decisions badge, bubble Escape, Tool Evaluation empty state, SOP bell fix. One small commit, zero risk, directly serves adoption.
2. **Tool↔Ask X cross-links** (rec 4): one line per tool page.
3. **Status-pill unification** (rec 5): the only refactor; schedule with the next feature that touches statuses.
4. Then return to roadmap #5 (Briefing v2) — the audit found no blocker for it.

*Nothing in this audit changes the product thesis: recommend → approve → execute → audit, with honest state everywhere.*
