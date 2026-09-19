# Execution report — 2026-09-17

**Audience:** project owner and portfolio reviewers.  
**Revision:** baseline commit `c8506e4` plus the uncommitted working tree, not a clean release or deployed revision.  
**Voice and evidence:** we describe our team's session in first person. The owner's session account supplies the baseline, intermediate test counts, review chronology and sub-agent process details. Repository sources corroborate the resulting implementation and selected checkpoints. We did not rerun tests, install dependencies, apply migrations or contact live services while writing this report.

## 1. Executive summary

We hardened approval/resume behavior in the existing Next.js agent runtime, strengthened external API and tool validation, improved operational diagnostics and trace refresh, added fast CI configuration, consolidated documentation, and subsequently added two distinct MCP profiles. This was engineering hardening and evidence preparation, not a production rollout or a completed school case study.

Our headline unit-test progression was **170 → 220 → 228 → 237 → 273**. The primary's final firsthand results, supplied by the owner for this consistency update, are **273/273 tests across 23 files, typecheck, build and validation of four n8n workflows PASS**, with **three pre-existing Gmail variable warnings**. The MCP adapter contributes **36 cases**, included in the total, not added on top. The [local verification record](evidence/LOCAL_VERIFICATION.md) now distinguishes this final checkpoint from the earlier 237-test / 22-file / three-workflow checkpoint (whose build recorded Next.js 15.5.25 and 27 static pages). No tests were rerun while updating these docs; this is reported firsthand evidence, not an inference from test-count arithmetic.

The final isolated SQL rerun also passed **28/28 checks** with `PGLITE_MODULE_PATH` set for the temporary dependency install. One invocation without the path failed `MODULE_NOT_FOUND` before SQL execution; this is a reproduction prerequisite, **not a migration failure**. The harness applies five selected migrations unchanged and reruns 015; the saved detailed checkpoint records **79 queries / 27 execs, exit 0**. Offline results do not establish live MCP, hosted migration application, remote CI, captures or a completed customer deployment, and do not make the prototype production-ready.

Read-only Git inspection confirmed `c8506e4` at HEAD, no staged changes, and substantial existing modifications and untracked additions. `git diff --stat HEAD` reported **37 tracked files changed, 40,884 insertions and 4,352 deletions** before this report. That includes a large pre-existing package-lock diff and excludes untracked files such as the migration, MCP additions, new tests and new docs. We therefore do not use these totals as authored-code volume or attribute every changed line to this session.

## 2. Timeline and division of labor

All stages below refer to **2026-09-17**. We have a sequence, not timestamped duration measurements.

### Baseline → first fix

We started from an operationally healthy baseline in the owner's session account: **170 unit tests**, typecheck and build green. “Healthy” describes that starting checkpoint, not newly verified Supabase, model-provider or hosted-service health.

We focused first on the boundary between a human approval decision and resumed execution. The initial implementation introduced durable wait accounting and approval binding/claiming, requester-scoped reads, renewed authorization and execution checks, and explicit treatment of uncertain effects. The relevant result is documented in [AGENT_CORE](AGENT_CORE.md) and implemented in [migration 015](../supabase/migrations/015_approval_resume.sql) and `lib/agent/runtime.ts:144`.

### Review round 1 → resolution

Our independent reviewer found **seven findings in our new work**, according to the session account. These were not all inherited defects that we merely discovered in somebody else's code. Four explicitly identified findings were:

- **Self-approval could strand a run:** rejecting it only later in resume was too late if the endpoint had already persisted the decision.
- **SQL JSON/JSONB shape mismatch:** mocked requester reads did not prove that the new SQL returned the expected JSON object/array types.
- **Retry was unreachable:** the decision endpoint blocked the same-decision retry needed to recover a failure before the execution claim.
- **Wrong source of role authority:** the profile role mirror was not the authoritative Auth metadata used for requester authorization.

The supplied sources do not preserve the complete seven-item review transcript. We retain the reported count but do not invent the other three findings or assign them severities.

We resolved these named issues by checking self-decisions before mutation, returning consistent JSONB results, allowing an immutable same-decision retry into safe resume, and comparing the persisted requester role with `auth.users.raw_app_meta_data.role`. Conflicting decisions remain 409; self-decisions remain 403. A retry is recovery before an unclaimed execution, not permission to repeat a claimed side effect.

The unit checkpoint sequence moved through **220** and **228** during implementation and review resolution. Those intermediate totals come from the session account; we have no saved per-command transcript that would justify allocating each added test to a particular individual finding.

### Review round 2 → resolution

The second independent review caught two further problems in our implementation:

1. **pgvector operator resolution:** the requester wrapper's restricted search path could prevent semantic retrieval from resolving extension operators. We changed the wrapper to `search_path = public, extensions` (`supabase/migrations/015_approval_resume.sql:111`).
2. **Approval policy could weaken:** requester flags, resumed runs and delegated children needed one consistent server-enforced policy, not a request-controlled override. We combined server requirement **OR** requester opt-in, persisted `current_state.require_approval`, retained or strengthened it on resume, and inherited it in children (`lib/agent/runtime.ts:101`, `:131`, `:368`).

The resolved hardening checkpoint reached **237** tests. This is the point explicitly captured by the consolidated evidence documents. Review mattered because a passing mock-based suite had not ruled out either defect.

### Isolated PostgreSQL verification

We initially lacked usable local Docker, psql, postgres and Supabase tooling. Rather than label unexecuted SQL “verified,” we used a temporary installation of **PGlite 0.5.8** and **pglite-pgvector 0.0.9** outside workspace dependencies. We saved [a reproducible harness](../scripts/verify-approval-sql.mjs). For this temporary-install setup, `PGLITE_MODULE_PATH` is required and points to the install root containing `node_modules`. Without it, one invocation failed `MODULE_NOT_FOUND` before migrations ran; setting it restored the 28-check pass. This was dependency resolution, not a SQL migration failure.

The harness applied unchanged migrations **001, 002, 010, 011 and 015**, then reran 015. It exercised real in-memory PostgreSQL functions rather than mocking the migration functions. Supabase Auth helpers, users, roles and grants were environment fixtures; the historical schema received an Auth metadata alias fixture.

The **28 checks** covered requester identity, role drift/missing-role denial, visible/hidden lead results, ordered and bounded history arrays, keyword/department lookup, semantic vector resolution with a public-only caller search path, claim-once behavior, wrong-run and self-approval denial, grants/RLS, owner reads, legacy backfill and rerun preservation. Exact accumulated wait progressed **10,250 → 12,250 ms** across sequential claims.

This was a material improvement over SQL-shaped mocks, but still a **single-connection in-memory** test. It did not apply 015 to hosted Supabase, test independent concurrent connections, or validate migrations 003–009 and 012–014.

### Additional hardening and verification plumbing

We added a shared **60 reads/minute/client** budget for external run list/detail routes, rejected unregistered or malformed `allowedAgents`, and returned 500 instead of starting an unattributed run when the provisioning owner was missing. We sanitized direct PostgREST keyword-filter syntax while preserving Unicode and scope filters, and validated visible-lead email addresses before recording dry-run drafts.

We added manual **Refresh run trace** in Ask X, made deliberate cache/limiter fail-open behavior observable, and moved classic E2E output to an ignored JSON artifact instead of a public documentation report. We added [.github/workflows/ci.yml](../.github/workflows/ci.yml) for PRs and main pushes: Node 22, `npm ci`, typecheck, unit tests, n8n validation and build. A workflow file is configuration, not a green remote CI run.

### MCP profile 2 → MCP profile 1

**Profile 2** is the [zero-dependency stdio adapter](../mcp/README.md), using Node's built-in facilities and the existing external agent REST API. Its tools are `list_capabilities`, `run_agent_goal` and `get_run_trace`. It adds protocol negotiation, strict tool arguments, error mapping and preservation of `Retry-After`, without retries, redirect following, automatic resubmission or an HTTP listener. Authorization still belongs to the API; the adapter does not add tenant isolation. Its protocol handling is **handrolled**, not SDK-backed or MCP compliance certified; unit tests and offline negotiation do not certify interoperability.

[The MCP unit suite](../tests/unit/mcp-adapter.test.ts) adds **36 cases**, taking the session-reported total from **237 to 273**. It combines injected HTTP mocks with spawned stdio processes. [The verifier](../scripts/verify-mcp.mjs) can negotiate initialization and inspect three tool schemas without any HTTP calls; its live mode is explicitly opt-in. Inspector interoperability and real API execution remain unverified.

**Profile 1** is the separate [native n8n workflow](../n8n/mcp-server-tools.json), described in `docs/WORKFLOW.md:79`. We used the installed native `@n8n/n8n-nodes-langchain.mcpTrigger` v2.1 contract, not an invented MCP trigger/response node. `qualify_lead` calls a self-subworkflow that signs the existing admissions envelope; `recent_runs` reads agent-runtime history through PostgREST. Both connect into the trigger's `ai_tool` input. Qualification includes an authored signing **Code node**: “config-only” means no application-code changes, **not literally no authored code**.

Bearer authentication remains enabled; the operator must bind an independent n8n Bearer Auth credential before publishing. This profile does **not** inherit the governed agent API's approval, per-client scope or rate-limit controls. Its recent-run view is service-role, cross-user access, and qualification runs belong to the classic pipeline rather than `agent_runs`.

The later workflow record reports four valid JSONs and passing typecheck, plus an ephemeral offline contract/envelope check. No n8n import/publish, server, Inspector or live tool call was executed in that implementation pass.

### Documentation consolidation and team process

Our sub-agent division separated **implementer**, **independent reviewer**, and **documentation** roles. The implementer owned changes and corrective tests; the reviewer challenged authorization, state transitions and SQL assumptions; the docs role reconciled source behavior with public claims and operator gates. The primary integration role owned accepting those outputs and reporting their evidence limits.

One delegated round was aborted after producing only a proposal rather than the requested implementation. That was our process miss: a proposed approach is not a completed change. We should have checked the actual diff and acceptance evidence earlier instead of treating delegation itself as progress. This detail comes from the owner's session account, not a retained public agent transcript.

The new documentation inventory includes:

- [AGENT_CORE.md](AGENT_CORE.md), [SECURITY.md](SECURITY.md), and [TESTING.md](TESTING.md).
- Case-study skeleton: [README](case-study/README.md), [DISCOVERY](case-study/DISCOVERY.md), [DEPLOYMENT](case-study/DEPLOYMENT.md), and [RESULTS](case-study/RESULTS.md).
- Historical archives: [ROADMAP_HISTORY.md](archive/ROADMAP_HISTORY.md) and [PHASE_9_AGENTIC_CORE_UPGRADE.md](archive/PHASE_9_AGENTIC_CORE_UPGRADE.md).
- Dated evidence: [LOCAL_VERIFICATION.md](evidence/LOCAL_VERIFICATION.md).

We also consolidated existing roadmap/runbook/workflow material. The final authorized docs-only consistency update reconciles current **237-test**, **three-workflow** and **MCP absent/deferred** statements with the final firsthand checkpoint and both implemented/offline-verified profiles. The earlier checkpoint remains explicitly historical in the local evidence record; archives are unchanged. README and ROADMAP link this execution report. No implementation edits, test/service runs or commits are part of this consistency update.

## 3. Bugs fixed and regression evidence

“Test” below identifies coverage in source or the recorded SQL pass, not a new execution during report writing.

| Symptom | Root cause | Fix | Test / evidence |
|---|---|---|---|
| Human approval wait exhausted the runtime timeout | Elapsed wall time included suspended human time | Persist wait start/accumulation; subtract wait from active budget | `tests/unit/agent-guardrails.test.ts:54`; SQL exact wait accumulation |
| Repeated resume could repeat an approved effect | No durable, bound admission claim | Bind pending approval and claim before execution; do not replay claimed work | `tests/unit/agent-runtime.test.ts:294`; SQL claim-once/duplicate-null checks; real connection races still pending |
| Self-decision left an unusable decided approval | Endpoint mutation preceded resume's self-approval rejection | Reject self-decisions before mutation; retain SQL claim denial | `tests/unit/agent-approvals-route.test.ts:53`; SQL self-approval check |
| A pre-claim failure could not recover via the same decision | Endpoint rejected already-decided approvals wholesale | Permit immutable same-decision retry; reject conflicts | `tests/unit/agent-approvals-route.test.ts:70`; `tests/unit/agent-runtime.test.ts:379` |
| Resumed reads could use the approver's authority | Resume reused the wrong client; initial role check trusted a mirror | Requester-read RPC anchored to persisted user and authoritative Auth role | `tests/unit/agent-runtime.test.ts:312`; SQL principal/role-drift/missing-role checks |
| New requester SQL did not reliably match tool result shapes | SQL JSON/JSONB type mismatch | Explicit JSONB object/array results and null-versus-empty semantics | `scripts/verify-approval-sql.mjs:138` through history checks |
| Semantic requester lookup could fail | Restricted wrapper search path omitted pgvector operator schema | Include `extensions` in wrapper search path | `scripts/verify-approval-sql.mjs:167` |
| Approval policy could weaken on request/resume/delegation | Server requirement and requester preference were not consistently combined/persisted | OR policy, persisted requirement, resume retention/strengthening and child inheritance | `tests/unit/agent-runs-route.test.ts:40`; `tests/unit/agent-runtime.test.ts:322` |
| Changed tool/resource state could invalidate an old approval | Approval was treated as sufficient without fresh checks | Recheck identity, permission, resources, enabled state and guards around execution | `tests/unit/agent-runtime.test.ts:284`, `:459` |
| Interrupted claimed execution lacked actionable recovery context | Side-effect completion and trace persistence can diverge | Persist reconciliation context; refuse blind replay | `tests/unit/agent-runtime.test.ts:365`, `:414`, `:427` |
| Ordinary resource denial prematurely failed a run | New shared execution path treated recoverable refusal as terminal | Record denial and feed it back for replanning on the unapproved path | `tests/unit/agent-runtime.test.ts:441` |
| Run-history reads lacked a shared client budget | List/detail paths had no common read limiter | Shared 60/minute key, 429 and `Retry-After`, before DB reads | `tests/unit/external-routes.test.ts:57` |
| Invalid client configuration reached provisioning/runtime | Agent allowlist and provisioning identity were insufficiently validated | Reject malformed/unregistered agents; missing owner returns 500 | `tests/unit/external-routes.test.ts:97`, `:115` |
| Keyword punctuation could alter filter syntax or become match-all | Raw search text entered PostgREST filter grammar | Sanitize direct filters; preserve Unicode; short-circuit empty terms | `tests/unit/agent-tool-hardening.test.ts:15` |
| Malformed recipient could be recorded as an email draft | Visible lead's stored address was not validated | Validate before insert; keep email dry-run | `tests/unit/agent-tool-hardening.test.ts:62` |
| Backend degradation was insufficiently observable | Fail-open limiter/cache errors were not consistently surfaced | Log returned/thrown failures while preserving deliberate fallback | `tests/unit/backend-fallback.test.ts:20` |
| Awaiting/running Ask X display could remain stale | No manual refetch affordance | Refresh persisted run trace on demand | Source behavior documented in `docs/AGENT_CORE.md:51`; browser acceptance pending |
| Classic E2E output could overwrite public evidence | Runner wrote a public report rather than an ignored artifact | Route output into ignored test-results JSON | `tests/unit/e2e-results.test.ts:5` |

MCP was an additive capability, not an existing production bug fix. Its tests prove adapter contracts, not end-to-end deployment. Likewise, at-most-once claim admission does not mean exactly-once side-effect delivery.

## 4. What is not done / release gates

1. **Hosted migration 015:** review prerequisites and legacy states, then apply `supabase/migrations/015_approval_resume.sql` in the authorized project's **Supabase SQL Editor**. Verify grants and requester behavior there. Ambiguous, already-decided, multiple-pending or missing-pending legacy approvals require manual reconciliation, not forced replay.
2. **Real concurrency:** exercise competing claims over separate database connections and real runtime requests. Neither the mock runtime race nor sequential PGlite duplicate claims establishes this.
3. **Remote CI first run:** commit/push only with owner authorization, then inspect the actual CI run and revision. We have no verified first remote run of the new workflow.
4. **Live verification scripts:** external API, signed lead intake, persistent limiter/cache, provider integration, browser/RLS, agent evals and classic E2E checks remain environment-dependent gates. Existing script files are not execution evidence.
5. **Live MCP captures:** use Inspector for both profiles; capture redacted initialization, tool discovery, auth failures and authorized tool results. Profile 1 additionally needs credential binding, import/publish, task-runner/subworkflow and admissions-pipeline acceptance. Profile 2 needs provisioned API credentials and live run/trace checks.
6. **Real-deployment facts:** no hosted school deployment, production users, interviews, delivered training, adoption or measured ROI. The Vietnamese-school case study remains planned and synthetic. There is no factual basis for a real-deployment record.
7. **Known limits:** no tenant-level CRM isolation for external service-client reads, global parent/child budget, universal idempotency, durable triage worker, automatic recovery after uncertain claimed execution, or real agent email transport. Fail-open rate limiting is not a hard spend ceiling.
8. **Evidence maintenance:** current pre-MCP claims are reconciled in this authorized docs-only update; archives retain their historical context. Live evidence and redacted captures remain pending. Establish a maintainer-approved lint command; none exists in the inspected package scripts.

## 5. How to reproduce the checks

These are **operator instructions, not commands executed while preparing this report**. Run from the repository root with Node 22 and the intended checkout. Configure secrets privately; never paste values into commands, transcripts or captures. The local paths linked in this report were checked through file reads/directory listings; rendered anchors and external services were not checked.

### Revision, offline suite, build and whitespace

```powershell
git status
git log --oneline -5
git diff --stat HEAD
git diff --check
npm ci
npm run typecheck -- --incremental false
npm test
node scripts/validate-n8n.mjs
npm run build
```

`npm ci` changes installed dependencies; run only when an install is intended. The validator/build can load private local configuration. The four-workflow expectation applies after profile 1, not to the earlier three-workflow checkpoint. Typecheck/build are not lint. Reproducing 170/220/228 exactly would require the corresponding intermediate trees; this uncommitted final tree does not preserve them as checkoutable revisions.

For targeted regression checks:

```powershell
npm test -- tests/unit/agent-approvals-route.test.ts tests/unit/agent-runs-route.test.ts tests/unit/agent-runtime.test.ts tests/unit/agent-guardrails.test.ts
npm test -- tests/unit/agent-tool-hardening.test.ts tests/unit/external-routes.test.ts tests/unit/backend-fallback.test.ts tests/unit/e2e-results.test.ts
npm test -- tests/unit/mcp-adapter.test.ts
node --check mcp/server.mjs
node --check scripts/verify-mcp.mjs
```

### Isolated PostgreSQL harness

Install only the optional harness dependencies into a fresh temporary directory, not the repository manifest:

```powershell
$sqlTemp = Join-Path ([System.IO.Path]::GetTempPath()) ('copilot-approval-sql-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $sqlTemp
npm install --prefix "$sqlTemp" --no-save --package-lock=false @electric-sql/pglite@0.5.8 @electric-sql/pglite-pgvector@0.0.9
$env:PGLITE_MODULE_PATH = $sqlTemp
node scripts/verify-approval-sql.mjs
Remove-Item Env:PGLITE_MODULE_PATH
```

Expected saved checkpoint: 28 passed, zero failed, five migrations, 79 queries and 27 execs. The database is in memory; temporary package files remain for deliberate operator cleanup. This cannot replace hosted migration application or multi-connection acceptance.

### MCP offline and live

With live mode absent, the verifier uses dummy credentials when necessary and makes no HTTP requests:

```powershell
Remove-Item Env:RUN_MCP_LIVE -ErrorAction SilentlyContinue
node scripts/verify-mcp.mjs
```

Expected offline behavior: PASS initialization, PASS three tool schemas, SKIP live API calls. The adapter's protocol support is narrower than a universal MCP implementation; inspect [its README](../mcp/README.md) for unsupported capabilities.

For profile 2, start the authorized configured app separately, privately supply `COPILOT_API_URL`, `COPILOT_API_CLIENT` and `COPILOT_API_SECRET`, then:

```powershell
$env:RUN_MCP_LIVE = '1'
node scripts/verify-mcp.mjs
Remove-Item Env:RUN_MCP_LIVE
npx @modelcontextprotocol/inspector node mcp/server.mjs
```

Live verification submits one goal and retrieves its trace, consumes quota and leaves run/audit/possible approval records. It does not clean up or retry. Inspect the run status: completed, escalated and awaiting approval are distinct; HTTP 200 alone is not task completion. Inspector may download into npm's cache.

For profile 1:

```powershell
node scripts/validate-n8n.mjs
npx @modelcontextprotocol/inspector
```

Follow the explicit import, credential binding, publishing and Streamable HTTP procedure in `docs/WORKFLOW.md:134`. Test both missing/wrong bearer rejection, `recent_runs` bounds/empty results, and one authorized synthetic qualification with email dry-run. Inspect HTTP body/status and classic pipeline records; do not expect qualification to appear in agent history. The earlier ephemeral node-contract check has no saved standalone harness in the cited artifacts, so we cannot offer a one-command replay of it; the documented acceptance steps remain necessary.

### Remaining configured/live checks

After reviewing [TESTING](TESTING.md) and [RUNBOOK](RUNBOOK.md), on an authorized disposable target only:

```powershell
npm run dev
```

In a separate terminal, select the checks appropriate to the configured services:

```powershell
npm run test:integration
npm run test:e2e
npm run evals:agent
node scripts/verify-external-api.mjs
node scripts/verify-lead-webhook.mjs
node scripts/verify-persistent-infra.mjs
node scripts/e2e-tests.mjs
$env:AGENT_VERIFY = '1'
npx playwright test tests/e2e/agent-verify.spec.ts
Remove-Item Env:AGENT_VERIFY
```

These can consume quota, mutate fixtures/runtime flags or send Telegram messages. Confirm the intended app process and database, review cleanup first, and record skips and failures honestly. Refresh UI behavior, hosted grants and multi-connection claims require the manual acceptance matrix, not merely a successful script launch.

The historical documentation-link result was **170 local links and 70 unique source locations** in the earlier consolidation, as recorded in local evidence. It is not this report's link count, and the cited artifacts do not retain a dedicated checker command for that historical scan. For this report we resolved links by reading the target files/directories rather than claiming a rerun of an unavailable checker.

## 6. Process lessons

- **Review caught defects in our own fixes.** We should credit independent review without disguising the first implementation as correct. Tests missed endpoint ordering, SQL types/operator resolution and policy propagation until reviewers questioned the assumptions.
- **SQL needed a real engine.** PGlite let us test unchanged SQL despite missing local database tooling. Explicit fixtures, a saved harness and bounded claims were more useful than either untested confidence or calling an isolated engine “Supabase verified.”
- **Additive-only held where it applied.** The MCP profiles added an adapter and a separate workflow without rewriting application behavior or existing workflows; profile 1 appended its documentation section. The earlier hardening necessarily edited existing code. We do not describe the entire dirty tree as literally additions-only. The final consistency update edits documentation only and preserves existing implementation/package/launcher changes, archives and private workspace state.
- **Delegation needs acceptance evidence.** Separate implementer/reviewer/docs roles helped, but one proposal-only aborted round demonstrated that assigning work is not completion. Require changed paths, tests and explicit blockers before accepting a handoff.
- **Verification numbers need revision and stage labels.** 273 unit tests, 28 SQL checks and four workflow validations describe different surfaces. None proves a hosted rollout, remote CI, live MCP interoperability or business results. The final docs update reconciles current claims while preserving earlier checkpoint labels and historical archives.
- **No lint script is a real gap.** We ran no invented lint command and do not rebrand typecheck or build as lint. Agreeing a lint command with the owner belongs in a future authorized change. (Closed 2026-09-19: see the addendum below.)

## 7. Addendum — 2026-09-19 revision and firsthand re-verification

A follow-up revision committed the previously uncommitted working tree in five logical chunks (`.gitattributes` line-ending hygiene verified code-neutral, agent/approval hardening, both MCP profiles, docs consolidation + CI + verification plumbing + the n8n security pin, and ESLint), then reran the offline gate firsthand on the final committed tree: lint (new ESLint 9 flat config, all 27 initial findings fixed), typecheck, **273/273 unit tests across 23 files**, 4-workflow n8n validation (same 3 Gmail warnings) and build (Next.js 15.5.25, 27 static pages) all PASS. See [LOCAL_VERIFICATION](evidence/LOCAL_VERIFICATION.md) for the dated entry. The section 6 "no lint command" item is resolved; every other release gate in section 4 remains open and unchanged — hosted migration 015, real multi-connection concurrency, remote CI evidence, live MCP/Inspector captures and any real-deployment facts are still pending.
- **Honest evidence includes limits and recovery.** At-most-once admission, dry-run email, manual reconciliation and unmeasured case-study outcomes are meaningful boundaries, not embarrassing footnotes to remove for a portfolio. Our deliverable is a more defensible implementation and reproducible verification path, with explicit gates still owned by the project owner.
