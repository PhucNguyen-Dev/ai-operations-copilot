# Known Weak Points & Risks — Review 2026-09-05

Findings from a full project review after Phase 5 close-out. Each item lists
impact, the area it affects, and a suggested priority. Nothing here blocks the
P0 pipeline; items are ordered by how much they will hurt during Phase 6.

## R-01 — No automated tests (High) — FIXED (H3)

**Area:** Platform / all features.

There is no test setup of any kind (no unit, integration, or E2E). Verification
is a manual role matrix in `docs/ROADMAP.md`.

- Impact: Phase 6 adds five AI tools (F-020–F-024) plus governance pages.
  Regression risk compounds with each feature; the RLS matrix especially
  benefits from automated checks (counselor sees assigned only, marketing/teacher
  see 0 leads, runs blocked).
- Suggested fix: add Vitest for pure logic (filter parsing, formatting) and a
  small Playwright smoke suite covering the login + RLS visibility matrix.
- **Resolved:** Vitest unit suite (`npm test`, 30 tests) covers validators,
  filter whitelists, role predicates, UUID guard, formatting, rate limiter.
  Live-Gemini integration path: `npm run test:integration` (explicit only).
  Playwright deferred until the Phase 6 foundation is stable.

## R-02 — Unstandardized AI-call pattern (High) — FIXED (H1)

**Area:** n8n / all AI features.

The Gemini call is a raw HTTP request node with a hand-rolled "Schema check"
Code node and per-failure logging nodes, all inline in
`n8n/admissions-lead-pipeline.json`.

- Impact: every Phase 6 AI feature (F-020–F-024) will copy this pattern.
  Prompt/schema drift, inconsistent retry behavior, and duplicated failure
  handling are the most likely future failure modes.
- Suggested fix: before F-020, define a shared convention — one system-prompt
  template, one JSON schema validation snippet, one retry policy, one logging
  shape — and reuse it in every AI workflow.
- **Resolved:** `lib/gemini.ts` is the mandatory entrypoint for every Gemini
  call (JSON mode, truncation-aware retry, client-safe errors, generation
  logging); validators are pure functions in `lib/ai/schemas.ts`. Convention
  documented in `docs/ROADMAP.md` → Hardening. n8n keeps its node-level
  equivalent with the same policy.

## R-03 — Raw Supabase error messages leak to the client (Medium) — FIXED (H2)

**Area:** `app/api/leads/route.ts` (and likely other routes).

`GET` returns `error.message` from Supabase directly with HTTP 400. Supabase
errors can include table/column hints and filter details.

- Impact: information disclosure; also gives clients an ambiguous 400 for
  what are really server-side faults (should be 500).
- Suggested fix: log the full error server-side, return a generic message and
  500 status for query failures.
- **Resolved:** server-side `console.error` + generic client message +
  correct status (500 for infra faults) on `/api/leads` and all five Phase 5
  pages; upstream 401/422 validation responses still pass through
  (user-relevant by design).

## R-04 — Static shared webhook secret (Medium) — Open (accepted for demo)

**Area:** `N8N_WEBHOOK_SECRET`, used by `app/api/leads/route.ts` and the n8n
validation node.

Single static value in `.env`, never rotated, same secret in two codebases
(app + n8n config).

- Impact: acceptable for a local demo; a leak silently allows anyone to inject
  leads and burn Gemini quota.
- Suggested fix: fine to keep as-is for the demo; if exposed anywhere public,
  rotate and consider per-environment secrets.

## R-05 — No rate limiting on lead intake (Medium) — FIXED (H4)

**Area:** `POST /api/leads`.

Any authenticated admissions/admin user (or anyone with the webhook secret) can
submit unlimited leads, each triggering a paid Gemini call.

- Impact: cost/quota exhaustion; noisy runs data.
- Suggested fix: simple per-user throttle (e.g. in-memory token bucket or a
  per-minute count in `automation_runs`) — demo-adequate.
- **Resolved:** `lib/rate-limit.ts` (in-memory per-user counter, 10/min on
  `POST /api/leads`, 429 + Retry-After). The same limiter gates every
  `/api/ai/*` tool route added in Phase 6. Limitation: in-memory state resets
  on restart and is per-instance — accepted for the demo.

## R-06 — Next.js workspace-root misdetection (Low, fixed)

**Area:** `next.config.ts`.

A stray `pnpm-lock.yaml` in the user home directory caused Next to infer the
wrong workspace root, producing a build warning and risking tracing/packaging
oddities.

- Status: fixed — `outputFileTracingRoot: __dirname` pinned in
  `next.config.ts`.

## R-07 — Stale dev-server renders unstyled pages (Low, fixed)

**Area:** local dev workflow.

A screenshot of the Lead Dashboard rendered as raw unstyled HTML. Investigation
showed the code, PostCSS/Tailwind v4 setup, and production build are all
correct; a fresh dev server serves the compiled stylesheet correctly.

- Root cause: a stale dev server process and/or corrupted `.next` cache in dev.
- **Resolved:** `.next/` deleted and dev restarted (2026-09-05). CSS verified
  serving 200. If it recurs: stop dev, delete `.next/`, `npm run dev`.

## R-08 — Service-role key used for all pipeline writes (Accepted risk)

**Area:** n8n → Supabase.

The pipeline writes with the service-role key, bypassing RLS entirely. This is
documented and intentional, but means every n8n node carries full DB power and
a malformed write is unrestricted.

- Impact: acceptable for a single-workflow demo. If more workflows are added in
  Phase 6, consider a dedicated Postgres role limited to the tables/columns the
  pipeline needs.

## R-09 — Invalid GEMINI_API_KEY in .env (High — action needed)

**Area:** `.env` → Gemini API (n8n pipeline + future Phase 6 tools).

Discovered by the new integration suite: the current key (new `AQ.` format)
is rejected by Google with `API_KEY_INVALID`. The Gemini API used to work
earlier the same day, so the key was likely rotated or replaced.

- Impact: every AI call fails — the n8n pipeline's Gemini node returns 400 and
  all Phase 6 tools would fail.
- Fix (user action): create a key at https://aistudio.google.com (starts with
  `AIza`), set `GEMINI_API_KEY=` in `.env`, restart n8n.

## Summary

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-01 | No automated tests | High | Fixed (H3) |
| R-02 | Unstandardized AI-call pattern | High | Fixed (H1) |
| R-03 | Raw error messages to client | Medium | Fixed (H2) |
| R-04 | Static shared webhook secret | Medium | Open (accepted for demo) |
| R-05 | No intake rate limiting | Medium | Fixed (H4) |
| R-06 | Workspace-root misdetection | Low | Fixed |
| R-07 | Stale dev server / unstyled page | Low | Fixed |
| R-08 | Service-role for pipeline writes | Low | Accepted risk |
| R-09 | Invalid GEMINI_API_KEY in .env | High | Open — user action: new AI Studio key |
