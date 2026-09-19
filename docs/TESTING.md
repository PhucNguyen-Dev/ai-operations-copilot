# Testing and evidence

Commands are taken from `package.json:5`. Final local result reported firsthand by the primary: **280/280 unit tests across 24 files, typecheck, n8n validation (4 workflows, 3 existing Gmail variable warnings) and `npm run build` all pass** on the committed revision, 2026-09-19 (the prior 273/273 checkpoint on 2026-09-17 plus seven approval-inbox client tests). **28/28 isolated SQL checks pass** with `PGLITE_MODULE_PATH` set. No checks were rerun for this docs update; hosted migration, live MCP/integrations, remote CI and captures remain pending. Dated provenance and reproduction requirements are in [LOCAL_VERIFICATION](evidence/LOCAL_VERIFICATION.md) and the [execution report](EXECUTION_REPORT.md).

## Offline checks

Run from the repository root with existing dependencies:

```sh
npm run lint
npm run typecheck -- --incremental false
npm test
node scripts/validate-n8n.mjs
```

The latest lint/type/unit checks were rerun firsthand on the committed revision (2026-09-19): lint clean on the new ESLint 9 flat config, typecheck clean, and 273/273 unit tests pass, including five approval-route tests. The Vite config-loader warning remains non-fatal. The n8n validator passed with only missing-credential-name warnings (`GOOGLE_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN`); it loads local `.env` when present, and this record contains no secret values. A standalone SQL verification exists: `node scripts/verify-approval-sql.mjs` runs the unchanged 001/002/010/011/015 migrations (plus a 015 rerun) against in-memory PGlite and reports 28 checks (79 queries / 27 execs); see [LOCAL_VERIFICATION](evidence/LOCAL_VERIFICATION.md) for the `PGLITE_MODULE_PATH` note and its single-connection limits. It does not replace hosted migration application or live checks below.

## MCP offline verification and live boundary

Both profiles are implemented. The [stdio adapter](../mcp/README.md) has 36 unit cases included in the 273-test total; these use injected HTTP mocks and spawned processes, not a live API. With `RUN_MCP_LIVE` unset, `node scripts/verify-mcp.mjs` checks initialization and three tool schemas without HTTP calls. The handrolled protocol is not SDK-backed or compliance certified.

The [native n8n profile](WORKFLOW.md#5-mcp-profile-1-native-n8n-admissions-tools) passes JSON validation and the recorded offline node-contract/envelope checks; these do not prove import/publish, a working signing Code-node runner or live calls. “Config-only” means no app changes, not no authored code. Inspector, live tools/auth checks and redacted captures for both profiles remain pending; follow their linked operator instructions only with authorization.

## Configured / live checks

Run only against an authorized disposable project with synthetic records. Review fixture cleanup first; errors can leave records or runtime flags behind. Some runners load private configuration themselves, spend API quota, mutate database state or send Telegram messages. A docs-only review should not run them to manufacture a success claim.

| Command | Intended coverage | Requirements / side effects |
|---|---|---|
| `npm run test:integration` | Real Gemini client integration | Provider credentials and quota |
| `npm run test:e2e` | Playwright auth and role/RLS visibility | Local app, seeded users, configured database; opt-in specs may skip |
| `npm run evals:agent` | Real-model behavior scenarios and trace scoring | App, Gemini, database/service credentials; fixtures and runtime controls may change |
| `node scripts/verify-external-api.mjs` | External auth, discovery, run attribution | Configured app/DB/model; temporary client and run records |
| `node scripts/verify-lead-webhook.mjs` | Signed intake and duplicate handling | Configured app/DB/model and webhook secret; synthetic leads and triage |
| `node scripts/verify-persistent-infra.mjs` | Postgres limiter/cache round-trip | Database/service credentials; infrastructure state mutation |
| `node scripts/e2e-tests.mjs` | Classic admissions failure cases | Running n8n/app and configured services; synthetic pipeline records |

For the opt-in agent walkthrough in PowerShell:

```powershell
$env:AGENT_VERIFY = '1'
npx playwright test tests/e2e/agent-verify.spec.ts
Remove-Item Env:AGENT_VERIFY
```

Run the local app separately with `npm run dev` and confirm the intended instance/port before browser checks. A test hitting an old process is not evidence for the current checkout. No Playwright browser/dependency installation was performed in this docs task.

## Live acceptance matrix after migration application

- Approval: live authoritative requester role/resource checks, independent approver, **real concurrent durable claims across connections**, wait accounting and legacy reconciliation. Unit coverage and the isolated PGlite SQL pass exist; hosted migration grants/behavior remain unverified. Server/requester OR policy, persisted resume retention/strengthening and child inheritance are implemented with regression coverage; validate them live after the unapplied migration gate in [ROADMAP](ROADMAP.md).
- Runtime: bounded steps/time/tokens, kill-switch behavior, tool disables, malformed/unknown calls, failed persistence and delegated-child limits.
- Retrieval: role/department scope for both vector and keyword paths, unavailable embeddings, unauthorized documents and untrusted document instructions.
- Webhook: malformed input, signed-envelope failure, duplicate delivery/races, storage failure, and reconciliation when background triage does not complete.
- Classic workflows: valid synthetic lead, validation rejection, provider/schema failure, email dry-run, task/notification and error-log behavior.
- External REST: credential revocation, scope/agent denial, own-run history, and an explicit demonstration of the documented service-client CRM visibility boundary.

## CI is configuration, not current evidence

`.github/workflows/ci.yml:3` runs on pull requests and pushes to `main`: install, lint, typecheck, unit tests, n8n validation and build. `.github/workflows/agent-evals.yml:14` separately defines scheduled 02:00 UTC and manual agent evaluations, fixture seeding and artifact upload. It does not establish that repository secrets exist, migrations are applied, the latest run succeeded, or the final code was evaluated. Current CI/live results were **not verified** here. Review an actual run and its revision before reporting a result; inspect skipped scenarios and cleanup failures as well as process exit status.

## Reporting results safely

`scripts/e2e-tests.mjs:116` now writes ignored `test-results/e2e-results.json`, not a public docs report. Record revision, date, environment class (local/disposable), exact command, outcome, skips and limitations. Keep raw `test-results` artifacts out of commits; redact personal data and credentials before sharing any trace. A green test is evidence only for its assertions, not proof of tenant isolation, prompt safety, production capacity or business ROI.

Historical records such as [the old E2E report](archive/e2e-results.md) and [roadmap history](archive/ROADMAP_HISTORY.md) retain their original claims. They are not the current baseline. Business results remain unmeasured in [the simulated case study](case-study/RESULTS.md).

## Documentation checks

A dependency-free local checker can resolve Markdown links relative to each file, ignoring external URLs and inline code, and check tracked source references separately. Preserve archived documents byte-for-byte; report historical stale references rather than rewriting their evidence. Private ignored notes and environment files must not be scanned or used as public link targets. External website availability is a separate check, not implied by local link success.
