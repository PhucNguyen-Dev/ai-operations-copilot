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

## #8 — "Approve does nothing after approving" — approval-loop execution (2026-09-20)

**Question:** approving an email draft or recommended action dead-ended at "Approved, pending send" — the governed-automation chain had no execution link.

**Discussion/decision:** user chose Brevo as the email provider. Built the execution layer: migration 021 (`sent_simulated` status + dispatch bookkeeping), a dependency-free Brevo HTTP adapter (`lib/email/dispatch.ts` — real send when `BREVO_API_KEY` + `BREVO_FROM_EMAIL` are set, honest simulated dispatch when not), atomic draft claim (double-click races lose), approved recommended actions create a follow-up task (HOT → high priority, due tomorrow, assigned to the lead's counselor, written via service client per the deterministic-writes trust model). Live-verified both paths on a real lead; task-creation RLS failure caught and fixed during verification.

**Pending user action:** create free Brevo account → API key + verified sender → add `BREVO_API_KEY`/`BREVO_FROM_EMAIL` to `.env` → restart. First real test must use Simulate Incoming Lead with the user's own real email (existing drafts point at fake `example.com` addresses — real sends there bounce and hurt sender reputation). Free tier 300/day. **Status: IMPLEMENTED + LIVE-VERIFIED (simulated) / REAL SEND PENDING USER'S BREVO KEY.**

---

## #9 — Morning-briefing push channel exploration (2026-09-20)

**Question:** could briefings auto-send to a person from just their phone number / Instagram / TikTok / YouTube username?

**Discussion:** no free channel allows cold-push by identifier — Telegram/WhatsApp/Instagram all require one-time recipient opt-in (press Start / DM first), TikTok and YouTube have no usable DM API at all, and YouTube community posts are public (data-breach risk for ops data). Only paid SMS truly pushes from a number. Also surfaced a real design concern: pushing internal briefings into the parent-facing bot mixes personas (user uses their phone to role-play parents).

**User decision:** drop external push entirely for now — delivery stays in-app (pinned ☀ Briefing session). Telegram push nodes removed from the n8n workflow (commit `f411184`); re-enabling later = dedicated ops bot + per-recipient opt-in, documented in workflow notes. **Status: RESOLVED / DEFERRED BY DESIGN.**

---

## #10 — Dashboard/detail UX regressions after the command-center rebuild (2026-09-20)

**Symptoms (four, one stretch):** chat dark-theme colors bled into the whole app ("the color ruined other features looks"); Next.js hydration mismatch on `<html className>`; "Open lead" from chat cards felt laggy; the agent kept misreading relative-date commands ("leads this week" answered with wrong scopes).

**Root causes & fixes:** theme bleed = the dark class was being applied globally instead of scoped — fixed by scoping `.theme-dark` to `.askx-surface` containers only (globals.css, theme-toggle, bubble, workspace). Hydration error = server/client class mismatch from the theme-init script — fixed in the root layout. Latency = two serial Supabase queries on Lead Detail — parallelized. Misread commands = the real one: date scoping was prompt-level only; fixed by enforcing date bounds at the runtime/tool boundary so an unbounded search cannot claim to answer "this week" (eval scenario `date-bounded-search` now pins this). **Status: ALL FIXED + REGRESSION-TESTED.**

---

## #11 — `.next` corruption: "can you see the whole layout broken?" (2026-09-20, recurring)

**Symptom:** running `npm run build` while the dev server was up corrupted the shared `.next` — chunks 404, hydration silently died, login stopped working, and eval runs failed for "mysterious" reasons. Hit **three+ times** (each looked like "the app broke", once mid-eval-suite).

**Fix (structural, not another restart):** `npm run build` is now guarded (`scripts/build.mjs`) — it detects a live dev server via netstat and refuses; `BUILD_ANYWAY=1` builds an isolated `.next-build` artifact (smoke-testable via `npm run start:isolated` on :3100) so dev is never clobbered; `predev` warns about port conflicts and stale builds; 13 unit tests pin the decision logic. Verified live: refuse-with-dev-up, isolated build, production smoke test, dev untouched. **Status: FIXED PERMANENTLY (commit `a6485ad`).**

---

## #12 — Migration drift on the hosted Supabase (2026-09-20)

**Problems:** (a) **Migration 015 was never applied** to the hosted project — the approval protocol silently 500'd the moment a run proposed an email for approval (found by the eval suite, not by manual use: the approval path was simply never exercised). Columns + three RPCs pasted in 4 blocks, verified. (b) **Migration 022's first SQL was wrong** — a FK referencing `agent_runs(session_id)`, which is deliberately non-unique (one session = many runs), so Postgres rejected it (`42830`); fixed by dropping the FK — integrity lives in the runtime ownership checks + RLS, same pattern as 016. (c) **SQL-paste ergonomics:** dollar-quoted `$$` blocks got truncated in the SQL editor ("unterminated dollar-quoted string") and multi-part migrations caused confusion ("so I have to paste to 3 query or sth?") — all migrations since are written paste-safe and given as ordered single blocks. Also hit `profiles_id_fkey` violation when seeding with a synthetic uuid that doesn't exist in `auth.users`. **Status: 001–022 ALL APPLIED + VERIFIED; paste-safe authoring is now the convention.**

---

## #13 — Approval→task creation failed: RLS by design (2026-09-20)

**Symptom:** approving a recommended action returned an execution error; no task appeared.

**Root cause:** two stacked bugs — `tasks` has **no authenticated-user insert policy by design** (deterministic writes go through the service role, same trust model as agent tables), and the route also used wrong columns (`created_by` is text, `assigned_counselor_id` was missing). Fixed by writing via the admin client with correct attribution (task assigned to the lead's counselor, created_by = deciding admin). Honest-error path worked as designed: the audit note said exactly what failed. **Status: FIXED + LIVE-VERIFIED (task created, attributed, prioritized).**

---

## #14 — Agent eval harness: five infrastructure bugs before real results (2026-09-20)

**Problems found while first running the shipped eval suite:** per-test timeout of 60s killed every real-model scenario at exactly 1.0m (infra failure, not behavior); two eval processes ran concurrently and collided on fixtures (FK 409); a lingering port-3000 bind made Next pick :59133 so the runner logged into the wrong server; fixture leads had invalid emails with spaces (`Eval Hot Lead@eval.example`) — only the approval scenario surfaced it because only it must actually send; the runs API doesn't echo `sessionId`, so the runner now generates and passes it explicitly (as the UI does); stale fixtures and the outdated `unknown-lead-bounded` expectation (pre-clarification) were corrected. Payoff: the suite immediately proved **migration 015 was missing** — a real production bug no manual testing had caught. **Status: ALL FIXED; suite is the standing regression net.**

---

## #15 — Eval flakes under real-model variance + kill-switch restore race (2026-09-20, open papercut)

**Symptoms (post-Briefing-v2 re-run):** one scenario (`session-follow-up`) failed in-suite but passed in isolation (31.8s, full governed chain) — root cause a transient `AI_UNREACHABLE` model error; `date-bounded-search` failed on first attempt because the kill-switch scenario's config restore **raced** the next scenario's first run (two runs died with `KILL_SWITCH`), then passed cleanly on retry.

**Assessment:** model variance is inherent to real-model suites (retry-once is already the harness's answer); the kill-switch race is a genuine harness papercut — restore should gate/await before the next scenario starts. Both documented in TESTING.md so results are read honestly. **Status: MODEL VARIANCE ACCEPTED / KILL-SWITCH RACE FIX QUEUED.**

---

*Next entries: append above this line, newest first.*
