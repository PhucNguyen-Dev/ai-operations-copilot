# Dev Fix Log — Lessons from Real Bugs

A running record of every non-trivial error hit while building this project, what caused it, and how it was fixed. Read this before debugging anything similar — most of these bit us more than once.

---

## 1. Stale system env var shadowed `.env` (the "AI service is unreachable" bug)

**Date:** 2026-09-06 · **Affected:** all interactive AI tools (F-020–F-024)

**Symptom:** Every AI tool returned "The AI service is unreachable or busy — try again in a moment." The n8n pipeline worked fine on the same machine with the same `.env`.

**Root cause (two layers):**
1. The Windows account had an **obsolete `GEMINI_API_KEY` (AIzaSy…) exported at User scope** in the registry. Next.js's dotenv loader does **not** override variables that already exist in the process environment, so the app kept sending the dead key. Google rejected it with `400 API key not valid`.
2. `lib/gemini.ts` mapped **every** non-429/5xx HTTP status (including 400/401) to `AI_UNREACHABLE` ("busy — try again"), which pointed debugging at the wrong thing for days.

**Fix:**
- Deleted the User-scope variable: `[Environment]::SetEnvironmentVariable('GEMINI_API_KEY', $null, 'User')`
- `classifyHttpStatus` now returns a distinct permanent `AI_CONFIG` code for 400/401/403/404 ("misconfigured — contact admin") vs. transient `AI_UNREACHABLE` for 429/5xx.
- Note: only **new** terminals get the registry change. Shells started before the fix still carry the stale var — launch dev/n8n with `unset GEMINI_API_KEY && ...`.

**Lesson:** When a service "mysteriously" rejects credentials that work in scripts, check `process.env` inheritance *before* the config file. The env var → `.env` shadowing direction is the opposite of what most people assume.

---

## 2. Retired Gemini models return 404

**Date:** 2026-09-06 · **Affected:** `lib/gemini.ts` default model, `.env.example`

`gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` all return **HTTP 404 "model is no longer available"** on the current key. Working models: `gemini-3.5-flash`, `gemini-3.5-flash-lite` (current `AI_MODEL`).

**Lesson:** Never hardcode a model name as a silent default; pin it, and classify 404 as a config error (see #1) so it can't masquerade as a transient outage.

---

## 3. Gemini free-tier quota is per-model **and** per-day

**Date:** 2026-09-05/06

**Symptom:** `429 You exceeded your current quota` — first on the lead-analysis call, later on the email-draft call. Retries with 2s backoff did nothing.

**Root cause:** `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — the free tier's daily quota is **per model**. Also, 2-second backoff is useless against an exhausted daily window.

**Fix:** Switched `AI_MODEL` to `gemini-3.5-flash-lite` (separate quota bucket); raised AI-node retries to ×4 @ 10s for genuine RPM blips.

**Lesson:** On free tiers, "which model" is a capacity decision, not just a quality decision. Retry backoff must match the failure's timescale.

---

## 4. Duplicate `Content-Type` header → Supabase 400 in n8n HTTP nodes

**Date:** 2026-09-06 · **Affected:** "Log pipeline steps" + 14 other nodes

**Symptom:** Successful leads still ended as `failed` runs: "Unhandled error at Log pipeline steps: Bad request - please check your parameters".

**Root cause:** Nodes set `specifyBody: "json"` (n8n adds `Content-Type: application/json` itself) **and** a manual `Content-Type` header. The duplicated header made Supabase's gateway reject the request.

**Fix:** Script-stripped the manual header from all 15 nodes + 1 in the error workflow (`scripts`-style one-off in bash/node, commit `c43a17c`).

**Lesson:** Let the platform set standard headers; hand-set only auth/custom ones. A generic "Bad request" from a gateway is often a malformed *request envelope*, not a bad payload.

---

## 5. Supabase Auth trigger broke user creation ("Database error creating new user")

**Date:** 2026-09 Phase 2 setup

**Symptom:** `supabase.auth.admin.createUser()` failed for all 5 demo users with a generic DB error. The SQL Editor said "Success" for every migration.

**Root cause:** The `handle_new_user` trigger on `auth.users` errored mid-insert (inside GoTrue's transaction). The auth API hides real DB errors, and trigger debugging via the API is blind.

**Fix:** Dropped the trigger entirely; the seed script now upserts `profiles` rows directly with the service key. Simpler and more robust for a fixed user set.

**Lesson:** "Database error creating new user" + a trigger on `auth.users` = the trigger is guilty ~always. Also: a diagnostic probe must be *valid* — our first probe inserted a random UUID that failed the FK for a trivially misleading reason.

---

## 6. `seed.sql` duplicate-key crash on re-run

**Date:** 2026-09 Phase 2 setup

**Symptom:** `23505 duplicate key value violates unique constraint "courses_code_key"` on a seemingly-fresh run.

**Root cause:** A double-run of a non-idempotent seed script.

**Fix:** Rewrote `seed.sql` as an idempotent `DO` block: each section checks `if not exists (...)` before inserting.

**Lesson:** Every seed/migration script should be safe to run twice. You will run it twice.

---

## 7. PostgREST filter syntax: bare values are parsed as operators

**Date:** 2026-09-06 · **Affected:** ad-hoc REST verification queries

**Symptom:** `?status=failed` → `PGRST100: "failed to parse filter (failed)"`.

**Root cause:** PostgREST requires an explicit operator: `?status=eq.failed`. A bare value is read as an operator name.

**Lesson:** `eq.` everywhere in hand-written PostgREST URLs.

---

## 8. PostgREST response wrapping: array vs object vs `{data: "..."}`

**Date:** 2026-09 Phase 4 (found by Codex)

PostgREST returns **an array** for `return=representation` by default, **an object** only with `Accept: application/vnd.pgrst.object+json`, and n8n HTTP nodes sometimes wrap the body as a string in `json.data`. Downstream nodes that assumed `json.id` blew up.

**Fix pattern used across the workflow:**
```js
const body = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw
const row = Array.isArray(body) ? body[0] : body
```
Plus the `Accept: vnd.pgrst.object+json` header on inserts where a single object is expected.

**Lesson:** Normalize third-party response shapes at the boundary; never assume one shape travels through the whole pipeline.

---

## 9. Column-name drift between workflow and schema

**Date:** 2026-09 Phase 4 (found by Codex)

**Symptom:** 400s on task/notification inserts.

**Root cause:** Nodes were written against guessed column names (`description`, `due_date`) while `001_schema.sql` defines `details`, `due_at`.

**Fix:** Aligned node bodies to the schema.

**Lesson:** Schema-first: grep the migration file before writing any insert. Column names live in exactly one place.

---

## 10. `error-handler.json` committed with invalid JSON

**Date:** 2026-09 Phase 4 (Codex) · fixed 2026-09-06

**Symptom:** `npm run push:n8n` → "Bad control character in string literal".

**Root cause:** A `jsCode` string contained literal newlines instead of `\n` escapes — hand-editing JSON.

**Fix:** Regenerated the file programmatically (`JSON.stringify` guarantees escaping) and validated with `JSON.parse` before committing.

**Lesson:** Never hand-maintain JSON with embedded code strings — generate it, and make the build validate it.

---

## 11. n8n's own bulk-insert rule: all rows need identical keys

**Date:** 2026-09 Phase 4

PostgREST bulk inserts reject `[ {...}, {..., extra: 1} ]`. Rows built conditionally (e.g. `payload_snapshot: ok ? {...} : undefined`) silently drop `undefined` keys during `JSON.stringify`, producing mismatched key sets.

**Fix:** `Build step log` constructs all 8 rows with every key present, `null` where empty.

**Lesson:** `JSON.stringify` quietly deletes `undefined` fields — conditional object literals in bulk payloads are a trap.

---

## 12. Assumed AI-model column mismatch in `lead_analyses.raw_response`

**Date:** 2026-09 Phase 4

Initially stored the model's raw JSON string; later nodes expected structured data. Changed to store the **parsed analysis object** (jsonb column handles both, but downstream consumers should not `JSON.parse` blindly).

---

## 13. Minor but real, from the Phase 2 build

- **`const URL = ...` shadowed the global `URL` class** in `seed-users.mjs` → `Cannot access 'URL' before initialization` (TDZ). Rename shadows of built-ins.
- **`@supabase/ssr` cookie callback typing**: `setAll(cookiesToSet)` needs an explicit `{ name, value, options }[]` type under strict TS — the docs' untyped snippet doesn't compile.
- **PowerShell 5 has no `??` operator** — use `if ($x) {...} else {...}` when scripting env queries on Windows.
- **`n8n --kill` on Windows**: closing the terminal does not kill n8n's process tree; `npm run push:n8n -- --kill` exists for this.

---

## Meta-lessons

1. **Error messages lie by omission.** The auth API, n8n's HTTP node, and our own first error map all hid the real cause. Build honest error classification early (R-03 exists because of #1/#4).
2. **"Success" in one place ≠ working end-to-end.** Most bugs here were only visible when testing the actual user flow (browser click or webhook curl), not the SQL editor or unit tests.
3. **Environment drift is the #1 time sink** in a two-runtime project (Next.js + n8n). Both read the same `.env`, but both are one inherited variable away from silently using something else.
4. **Fix the class, not the instance.** #4 was one node's symptom but fifteen nodes' disease — the fix script swept all of them.
