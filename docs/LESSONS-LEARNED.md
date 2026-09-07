# Lessons Learned — the complete error catalog

**Purpose:** one document to *study*, not just to fix. Every non-trivial error
this project has hit — symptom → diagnosis → root cause → fix → the lesson
that generalizes. Organized by theme, newest first.

Deep-dive companions: `TELEGRAM-INCIDENT-2026-09-07.md` (the full n8n/Telegram
saga) · `archive/fix-pipeline-content-type.md` (one 400 dissected completely)
· `WEAK_POINTS_AND_RISKS.md` (living risk register R-01…R-10).

---

## Part 1 — The n8n + Telegram outage (2026-09-07)

Five problems stacked on one day. Full timeline in
`TELEGRAM-INCIDENT-2026-09-07.md`; here in study form:

### 1.1 "Bad request – please check your parameters" on every Telegram activation

- **Symptom:** the chatbot workflow retried activation forever with exponential backoff.
- **Root cause:** the project's n8n had been upgraded to 2.8.4. n8n 2.x **removed the `--tunnel` CLI flag — silently**. With no public URL, n8n told Telegram to deliver webhooks to `http://localhost:5678/...`, and Telegram rejects non-public/non-HTTPS webhook URLs with exactly that generic error.
- **Fix:** run an external tunnel (localtunnel) and pass it to n8n as `WEBHOOK_URL` (`scripts/start-n8n.mjs`).
- **Lesson:** *when an upgrade lands, config that relied on removed features fails silently, not loudly.* A one-line changelog check of "breaking changes" before upgrading saves hours. n8n even ships machine-readable breaking-change rules — read them.

### 1.2 "The connection cannot be established… incorrect host (domain) value" (Fire admissions pipeline node)

- **Symptom:** chatbot worked, but the hand-off to the admissions pipeline failed with a DNS-level error.
- **Root cause:** `.env` `N8N_WEBHOOK_URL` still pointed at a **dead cloudflare quick-tunnel** from a previous session. Quick-tunnel URLs die with their process; the config survived.
- **Fix:** pinned to `http://localhost:5678/webhook/admissions-lead` — and made `start-n8n.mjs` *force* that value so `.env` drift can't recur.
- **Lesson:** *config outlives the thing it points at.* Any URL stored in a file should be either stable-by-contract or validated at startup. (Registered as risk R-09.)

### 1.3 `502 Bad Gateway` / dead tunnel despite green n8n

- **Symptom:** n8n healthy on localhost; the public tunnel URL 502s; bot silent.
- **Root cause:** localtunnel's relay held a **stale registry entry** ("zombie") for our fixed subdomain `aileads-dev.loca.lt` — the relay accepted the claim but routed to a dead socket. Free random tunnels also die mid-session without warning.
- **Fix:** fresh random subdomain per start, then later: re-claim the fixed name with **verification before use** (temporary stub server answers `/healthz` during the claim so a zombie 502 can't be misread) plus automatic fallback to a random URL, plus a 30s watchdog that heals dead tunnels mid-session.
- **Lesson:** *a URL you were handed is a hypothesis, not a fact.* Verify the full path (public → local) before declaring success. And free relays are fine for machine-to-machine callbacks but unreliable for browser asset bursts (see 1.5).

### 1.4 "The service is receiving too many requests from you" (Telegram 429)

- **Symptom:** webhook registration calls intermittently rejected; activation delayed.
- **Root cause:** dozens of `setWebhook`/`getWebhookInfo` calls from a full day of restart cycles hit Telegram's rate limit. n8n's own activation retry then 429'd first, widening the broken window.
- **Fix:** fewer Telegram calls per start (verify-only at startup), honor the 429 body's `retry_after` when retrying.
- **Lesson:** *rate limits punish restart loops.* When a provider tells you how long to wait (`retry_after`), waiting is the only correct retry policy. Backoff must match the failure's timescale — a 2s retry against a daily quota (see 2.3) or a 30s rate window does nothing.

### 1.5 The silent bot: webhook registration race + secret mismatch (the sneakest bug)

- **Symptom:** stack fully green (`✓ Bot stack ready`), messages sent… bot says nothing, and n8n shows **no execution row at all**.
- **Root cause:** n8n's Telegram Trigger registers the webhook with a **secret token** (`<workflowId>_<triggerNodeId>`). Every Telegram delivery must carry that header; mismatches get `403 {"message":"Provided secret is not valid"}` and are **dropped without any execution record**. Our launcher also called `setWebhook` (without the secret) — and *whoever registers last wins*. Launcher-last ⇒ secret gone ⇒ every message 403 ⇒ bot "online" but dead.
- **Fix:** at startup the launcher **never registers** — it polls `getWebhookInfo` until n8n's own secret-protected registration appears. The mid-session watchdog *does* register, but with the exact same secret n8n uses, so the two paths are equivalent.
- **Lesson:** *when two components can do the same job, they will race.* Assign ownership (n8n registers, launcher verifies). And *silence is data*: "no execution row" itself proves the failure is upstream of n8n — a three-row diagnosis table (no row / red row / green row) turns a vague "bot broken" into a located fault in seconds.

---

## Part 2 — Environment & configuration (the #1 time sink)

### 2.1 Stale OS env var shadowed `.env` — "AI service unreachable"

- **Symptom:** every AI tool returned "AI service is unreachable"; n8n worked fine on the same machine.
- **Root cause (two layers):** an obsolete `GEMINI_API_KEY` exported at **Windows User scope** — dotenv does *not* override existing process env — plus our own error mapper that labeled every 4xx as "unreachable/busy", misdirecting debugging for days.
- **Fix:** deleted the User-scope var; `classifyHttpStatus` now distinguishes permanent `AI_CONFIG` (400/401/403/404) from transient `AI_UNREACHABLE` (429/5xx).
- **Lesson:** *env inheritance beats your config file, in the opposite direction most people assume.* When credentials "mysteriously" fail, print `process.env` first. And **honest error classification is a feature**: one wrong label cost days.

### 2.2 Retired model names return 404

`gemini-2.0-flash` etc. → "model is no longer available". **Lesson:** never hardcode a model as silent default; classify 404 as config error so it can't masquerade as an outage.

### 2.3 Gemini free-tier quota is per-model AND per-day

`429 quota exceeded` survived 2s backoff. Switching model = switching quota bucket. **Lesson:** on free tiers, model choice is a *capacity* decision; retry backoff must match the quota's timescale (day ≠ seconds).

---

## Part 3 — n8n workflow idiosyncrasies

### 3.1 Duplicate `Content-Type` → generic 400 (the "six of seven nodes" bug)

- **Symptom:** pipeline green until the *last* node; "Bad request – please check your parameters"; lead saved but zero `automation_run_steps`.
- **Root cause:** nodes with `specifyBody: "json"` + a manual `Content-Type` header → duplicated header → Supabase rejects. Six object-body nodes were *content-sniffed* and passed anyway; only the **array** body (8 batch rows) was rejected. Full autopsy in `archive/fix-pipeline-content-type.md`.
- **Fix:** script-stripped the manual header from all 15 affected nodes — fix the class, not the instance.
- **Lesson:** *let the platform set standard headers.* A generic gateway 400 often means malformed *envelope*, not bad payload. And the canvas shows red only on the failing node — visually invisible for the other six.

### 3.2 PostgREST/Supabase API shape traps (five bugs, one theme)

- Bare filter values fail: `?status=eq.failed`, never `?status=failed`.
- Response shapes vary: array vs `vnd.pgrst.object+json` vs n8n wrapping bodies as strings — normalize at the boundary, never assume one shape flows through.
- Bulk inserts need **identical key sets**; `JSON.stringify` silently drops `undefined` keys from conditionally-built literals.
- Column names live in `001_schema.sql` — grep the schema before writing inserts (guessed `description`/`due_date` vs real `details`/`due_at`).

### 3.3 Hand-edited JSON with embedded code corrupted the workflow file

Literal newlines inside a `jsCode` string → invalid JSON → push failed. **Lesson:** never hand-maintain JSON containing code strings — generate it programmatically and `JSON.parse`-validate before commit.

### 3.4 Windows process-tree hygiene

Closing the terminal does **not** kill n8n/localtunnel — orphaned trees hold port 5678 and 100MB+ RAM each. **Lesson:** on Windows, `taskkill /PID x /T /F` is the kill; provide `npm run kill-stack` so "try turning it off and on again" actually turns it off.

---

## Part 4 — Data & platform behaviors

### 4.1 Supabase auth trigger broke user creation

"Database error creating new user" + trigger on `auth.users` = trigger guilty ~always; the auth API hides real DB errors. **Lesson:** platform APIs that swallow errors force you to debug blind — design so the error surface is visible (direct upserts beat opaque triggers for a fixed user set).

### 4.2 Non-idempotent seeds crash on re-run

`23505 duplicate key` on a "fresh" run. Rewrote as idempotent `if not exists` blocks. **Lesson:** every migration/seed will be run twice; make that safe.

### 4.3 Telegram does not queue — lost messages are lost forever

Deliveries to a dead webhook are dropped, no replay. **Lesson:** in event-driven integrations, "it works now" ≠ "the backlog arrived". Always test with a *fresh* event after downtime, and tell users why the old ones vanished.

### 4.4 Free tunnels: machines yes, browsers no

Telegram's single POSTs flow fine; the n8n editor's ~40-asset burst 502s through the relay, plus an IP-confirmation interstitial for browsers. **Lesson:** know your infrastructure's *audience*. Localhost for humans, tunnel for machines.

---

## Part 5 — Meta-lessons (the transferable ones)

1. **Error messages lie by omission.** Auth API, n8n HTTP nodes, our own first error map, and Telegram's generic "Bad request" all hid the true cause. Build honest error classification early — it pays for itself the same week.
2. **"Green in one place" ≠ working end-to-end.** Nearly every bug here was only visible through the real user path (browser click, real Telegram message). Synthetics and SQL editors prove parts; the flow proves the system.
3. **Silence is a clue, not a void.** No execution row ⇒ fault is upstream. Blank page + 502s on every asset ⇒ transport, not app. Binary-search the delivery chain before touching code.
4. **Ownership beats race conditions.** Two things doing the same job (registering a webhook) will fight. Assign one owner; make the other verify.
5. **Verify claims.** A tunnel URL, a "Success" toast, a green banner — each is a hypothesis until probed on the real path.
6. **Fix the class, not the instance** — one node's missing header was fifteen nodes' disease; the stale env key shadowed five tools at once.
7. **Environment drift is the top time sink in two-runtime projects** (Next.js + n8n): same `.env`, one inherited variable away from silent divergence. Pin what code assumes; audit what shadows.
8. **Windows servers need explicit process-tree lifecycle design** — spawn/kill pairs (`taskkill /T`), port cleanup before start, `kill-stack` as the reset button.
