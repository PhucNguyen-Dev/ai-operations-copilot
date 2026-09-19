# Local verification — 2026-09-17

**Revision:** baseline commit `c8506e4` **plus an uncommitted working tree** containing implementation, tests, migration and documentation changes. This is not verification of a new commit, a clean release or a remote deployment. No commit was created by the documentation work.

## Final checkpoint

The primary's final firsthand results, supplied for this consistency update, are **273/273 unit tests across 23 files (including 36 MCP adapter cases), typecheck, build and 4-workflow validation PASS**, with **3 pre-existing Gmail variable warnings**. **28/28 isolated SQL checks PASS** after setting `PGLITE_MODULE_PATH` to the temporary dependency install. One invocation without that path failed `MODULE_NOT_FOUND` before SQL execution: a dependency-resolution/reproducibility issue, **not a migration failure**. For reproduction, point the variable to the temporary install root containing `node_modules`, as shown in the execution report.

These are reported firsthand execution results, not tests rerun by the docs editor. Both MCP profiles are implemented and offline-verified; live MCP, hosted migration application, remote CI, new captures and customer deployment remain pending. See the [execution report](../EXECUTION_REPORT.md) for chronology and reproduction commands. This is not a production-readiness claim.

## Sanitized command evidence — earlier hardening checkpoint

The rows below preserve the earlier 237-test / three-workflow checkpoint and historical link-review counts; the final checkpoint above supersedes those totals, not their provenance.

| Command / checkpoint | Result | Provenance and limit |
|---|---|---|
| `git rev-parse --short HEAD` | `c8506e4` | Observed during documentation finalization; does not include uncommitted changes |
| `npm test` | **237/237 unit tests passed across 22 files** | Reported firsthand by primary on this working tree, 2026-09-17; unit coverage, not live SQL/provider verification |
| `npm run typecheck` | **Passed** | Reported firsthand by primary on this working tree, 2026-09-17 |
| `node scripts/validate-n8n.mjs` | **Passed: 3 workflows valid** | Reported firsthand by primary. Only warnings are missing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN` names; the validator reads local `.env` when present (`scripts/validate-n8n.mjs:21`), so no secret values are recorded here. Remote CI remains unobserved |
| `npm run build` | **Passed: Next.js 15.5.25, 27 static pages generated** | Reported firsthand by primary on this working tree, 2026-09-17. Build loads `.env` automatically; it is not a live service or database check. Not an ESLint success claim — no standalone lint is configured in the package scripts |
| `git diff --check` | **Passed** | LF/CRLF notices only; no whitespace errors |
| `Get-Command` availability checks and `docker version` | Local Docker, psql, postgres and Supabase tooling **initially unavailable** | Reported by implementing agent; later bypassed via temporary PGlite (next row) |
| Isolated PostgreSQL SQL verification: `node scripts/verify-approval-sql.mjs` with `PGLITE_MODULE_PATH` pointed at a temporary install (`@electric-sql/pglite` 0.5.8 + `@electric-sql/pglite-pgvector` 0.0.9, installed under the OS temp directory, not workspace dependencies) | **28/28 checks PASS, 5 migrations applied (001/002/010/011/015 unchanged plus a 015 rerun), 79 queries / 27 execs, exit 0** | Reproduced firsthand on this working tree, 2026-09-17, from the saved harness. Verified: authoritative principal from persisted requester (not approver), role-drift/missing-role fail-closed, lead JSON/visibility, search ordering/filters, per-lead analysis/task/email caps, knowledge keyword + department filter, semantic vector similarity with the `public,extensions` operator resolution, single-connection claim-once/duplicate-null/wrong-run/self-approval denial, exact human-wait accumulation (10250 → 12250 ms across sequential claims), role grants, RLS denial for anon/authenticated, owner-only run/step reads, legacy single-pending backfill leaving ambiguous/decided rows untouched, and idempotent 015 rerun preserving wait/claims. Limits: in-memory single-connection PGlite — **not hosted Supabase, not real multi-connection concurrency**; only five selected migrations applied; auth fixtures emulate Supabase helpers |
| Local Markdown/source-reference review | **170 local file links, 70 unique source locations; no missing targets/locations** | No dependencies installed; external URLs and rendered anchors not verified |
| `git diff --check -- README.md docs` | Passed | Line-ending notices only; historical archive content preserved |

The unit runner emitted a Vite native-config-loader compatibility warning for `vitest.config.ts`; it did not fail the suite. Expected mocked error-path messages are not live provider incidents. No raw console dump, test-results payload, environment contents or credential values are included here.

## Not executed / not established

- **Hosted migration rollout still pending.** The SQL of 001/002/010/011/015 (including the `search_path = public, extensions` requester wrapper) is now verified against an isolated in-memory PostgreSQL (PGlite), but no hosted/managed Supabase project has had migration 015 applied. No real multi-connection concurrency test exists; the claim-once check used a single connection. Migrations 003–009 and 012–014 were not part of this isolated pass.
- No live Gemini, Supabase, Telegram, tunnel, browser workflow, external partner or remote CI verification. Both MCP profiles are implemented/offline-verified, but live MCP/Inspector, Gateway and deployed-service acceptance remain unverified; no real user data was touched or produced.
- The saved harness lives at `scripts/verify-approval-sql.mjs`; it resolves `@electric-sql/pglite`, `@electric-sql/pglite/contrib/pgcrypto` and `@electric-sql/pglite-pgvector` from `PGLITE_MODULE_PATH` when set (recommended for temp-directory installs), otherwise from the workspace. No workspace package changes were made; these remain optional, undocumented-in-package temp dependencies.
- No lint command is defined in the inspected package scripts; do not treat typecheck as lint.
- No school deployment, real users, interviews, training delivery or measured business results. Services for the planned scenario are absent; [case-study](../case-study/README.md) remains a skeleton.

## What the tests do and do not establish

The suite includes approval decision/resume, server/requester OR policy, persisted retention/strengthening, child inheritance, guardrail, tool hardening, external route, fail-open backend and E2E-output-location regressions. Unit mocks and source checks support implementation review; the isolated PGlite pass verifies the approval SQL on a real (in-memory) Postgres engine, but neither establishes hosted-project grants or concurrent-connection behavior. At-most-once claim admission is not exactly-once side-effect delivery.

Classic E2E output now targets ignored `test-results/e2e-results.json`; historical reports remain unchanged. Publish only sanitized summaries, never raw artifacts. Local offline checks include the final build and implemented MCP profiles; hosted migration application, remote CI, live integrations including MCP, new captures and real-user facts remain pending in the [locked roadmap gates](../ROADMAP.md). The stdio protocol is handrolled, not SDK compliance certified; native n8n qualification includes a signing Code node, so “config-only” means no application changes, not no authored code.
