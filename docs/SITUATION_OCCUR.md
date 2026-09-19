# Situation Occur — user questions, ideas & complaints log

A running record of situations the user raised during sessions — questions, ideas, complaints,
unexpected behaviors — captured while fresh, to be revisited and discussed later.

**Rules for the assistant:** append every new user-raised question / idea / complaint here
(newest first). Do not delete entries; mark status instead. Keep each entry factual:
what was observed, why, what was decided, what remains open.

---

## #1 — "I think the bot doesn't understand my second command" (2026-09-19)

**Source:** screenshot of the Ask X chat + user comment.

**What happened:**

| Message sent | Agent's stored goal (`agent_runs.goal`) | Outcome |
|---|---|---|
| 1. "find the coldest lead for me" | `find the coldest lead for me` | OK: found *nguyen phuc nguywn* (COLD, score 25, Business English), ID `3280de72-…` |
| 2. "what we gonna do with this lead" | `what we gonna do with this lead` | WRONG TARGET: agent picked **Emma Nguyen** (HOT, IELTS) by its own criteria and ran the full SOP — created a follow-up task + a dry-run email draft for a lead the user never named |

**Root cause (verified in DB):** each chat message starts a **completely stateless agent run** —
run #2's goal text was stored verbatim with zero memory of run #1. "This lead" had no antecedent,
so the agent guessed. Two distinct gaps:

1. **No conversation context** — the chat UI *looks* multi-turn but every run is isolated.
2. **No clarify-before-act policy** — given an unresolved reference plus an action-looking
   phrasing ("what we gonna do"), the agent guessed and mutated CRM state instead of asking
   "which lead?".

Cost: 17,095 tokens spent acting on the wrong lead.

**Options considered (discussed, then deferred by user):**
- Context + clarify guard (inject previous run outcome; ask when reference unresolved) — recommended, no schema change
- Full session memory (`agent_sessions` / `parent_run_id`, prior-run summaries in planner) — needs migration, more tokens
- Clarify-guard only — least code, most friction

**User decision:** *"leave this aside, we won't design it to be more complex now"* — recorded here
for later discussion. **Status: DEFERRED (open idea).**

**Workaround until revisited:** make every message self-contained
(e.g. "What should we do with nguyen phuc nguywn — Business English, score 25?").

**Open cleanup:** the wrong-target run left a real follow-up task and a `dry_run` email draft
for Emma Nguyen (created ~2026-09-19). Harmless (dry-run), but should be deleted or acknowledged
at some point.

---

## #2 — "I feel like you broke my app" (2026-09-19, earlier session)

**What happened:** during a documentation/preview task the user saw repeated tool errors
(`str_replace` "file does not exist" on `.freebuff/` paths) and felt the app was broken.

**What it actually was:** (a) an editor-tool quirk refusing `.freebuff/` paths — no product code
touched; (b) the real annoyance: **two orphaned dev servers** left listening on ports 51839/58595
from earlier verification runs (Windows didn't propagate a shell `kill` to the child process).

**Resolution:** orphaned processes killed, ports freed; working tree verified clean; full gate
(280/280 tests, lint, typecheck, build) green on the committed tree.

**Idea worth remembering:** any script that starts a dev server on Windows should use
`taskkill /PID <pid> /T /F` (process-tree kill) rather than shell `kill` — the same trap
`scripts/start-bot.mjs` already solves with `killPid()`. **Status: RESOLVED (lesson kept here).**

---

## #3 — "wait, you didn't need to start n8n or anything else?" (2026-09-19)

**The question:** what actually needs to run for the app to work?

**Answer recorded (for future reference):**

| To test | Needs | Local command |
|---|---|---|
| Login, dashboards, leads, Ask X agent | Next.js + hosted Supabase (`.env`) + `GEMINI_API_KEY` | `npm run dev` |
| Classic admissions pipeline (form → n8n → CRM → email) | + n8n on :5678 (`N8N_WEBHOOK_SECRET`) | `npm run n8n` (Node ≥ 24!) |
| Telegram parent chatbot | + tunnel + bot token | `npm run bot` (opens tunnel, registers webhook) |

The agent core and the n8n pipeline are **separate execution paths** — docs state the agent does
not require n8n. Postgres is hosted (Supabase), nothing else to boot.

**Related discovery the same day:** the pinned n8n 2.37.7 requires **Node ≥ 24** while the
project's README specifies Node 22 — on this machine n8n runs via nvm's Node 24.11.0 with a
PATH scoped to n8n commands only. Worth reconciling the README requirement vs the n8n pin.
**Status: RESOLVED locally / README-RECONCILIATION OPEN.**

---

## #4 — "the published button is locked like that, usually we can toggle on off" (2026-09-19)

**What happened:** in the n8n 2.x editor the user expected an on/off toggle and found a
"Published ●" pill with a chevron instead — read it as locked/broken.

**Explanation:** pure UI rename in n8n 2.x. **"Published" = the old "Active"** (green dot = on);
the `⌄` chevron menu holds Deactivate. No app defect. **Status: RESOLVED (explanation).**

---

## #5 — Telegram bot would not activate: env-var name collision (2026-09-19, found while chasing #3/#4)

**Symptom:** Telegram trigger kept failing with
`400: bad webhook: An HTTPS URL must be provided for webhook`, looping forever even with the
cloudflared tunnel up.

**Root cause:** n8n reserves **`N8N_WEBHOOK_URL`** as *its own public webhook base URL*, but this
project used that same name for the *app's local admissions callback*
(`http://localhost:5678/webhook/admissions-lead`). n8n won the collision and tried to register the
bot webhook at the localhost address → Telegram rejected non-HTTPS.

**Fix applied:** renamed the project variable to **`LEAD_WEBHOOK_URL`** in `.env`, `.env.example`,
`scripts/start-n8n.mjs` (with explanatory comment + `delete secrets.N8N_WEBHOOK_URL`),
`app/api/leads/route.ts`, `n8n/telegram-parent-chatbot.json`, `scripts/validate-n8n.mjs`.
Workflows re-imported; bot verified live afterwards (webhook registered via tunnel).

**Open:** this fix is **not yet committed** — working tree still has the change uncommitted.
**Status: FIXED ON DISK / COMMIT PENDING.**

---

## #6 — "Why does the agent feel like a simple pre-AI bot? Or am I wrong?" (2026-09-19)

**Question:** after watching Ask X runs, the user felt the agent behaves like a scripted bot from before AI.

**Discussion:** the feeling is partly correct. The admissions SOP is deterministic — HOT lead → same-day task + first-touch email draft — so a governed agent can produce workflow-like traces on the happy path. The state space is also small, and every chat message currently starts a stateless run, so the interface lacks conversational continuity. The wording is AI-generated while much of the decision policy remains SOP-driven.

The feeling is also incomplete: Ask X accepts open-ended goals and compiles them into plans at runtime; unlike a fixed n8n workflow, it can inspect state, choose tools, adapt to guards, escalate nonexistent leads, and pivot when a tool is unavailable. Those differences appear at the edges, not in a clean happy-path demo.

**Best falsification tests:** give it a novel competitor/refund situation, revoke a tool permission and rerun a goal, or ask a follow-up such as "now draft it". The main missing capability is continuity and clarify-before-act behavior, not simply a larger model or more tools.

**User decision:** no design change now; keep the system simple and revisit later. **Status: DISCUSSED / DEFERRED.**

---

## #7 — Ask X hybrid chat redesign and assistant behavior (2026-09-19)

**Idea:** replace the narrow Ask X page with a floating bubble plus a full-page Mission Control workspace sharing one ChatPanel, session history, rich business cards, theme support and a read-only inspector.

**Discussion/decision:** use derived sessions from agent_runs, user-owned history by default, and only ephemeral last-turn context — no long-term memory yet. Add clarification-before-action for ambiguous references so “this lead” cannot silently mutate the wrong CRM record. Preserve the governed runtime, RLS, approvals and no-live-polling behavior. **Status: IMPLEMENTED IN WORKTREE / VALIDATION PENDING.**

---

*Next entries: append above this line, newest first.*
