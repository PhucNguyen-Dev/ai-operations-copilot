# Results — not yet measured

**No scenario deployment or business outcome was verified in this documentation task.** This is a results framework for the simulated Vietnamese school, not an account of real users or a completed pilot. Historical project screenshots, experiments and test reports must retain their original context and cannot be relabeled as school results.

## Current evidence ledger

| Item | Status | What it supports |
|---|---|---|
| Repository implementation and source references | Available for inspection | Capability presence and design, not runtime acceptance |
| Historical Tool Lab measurements | Retained in git history only (removed in the 2026-09-20 docs revision) | Original small synthetic experiment only |
| Historical screenshots | [docs/screenshots/](../screenshots/) (6 shots; [README](../../README.md) references `01-dashboard-admin.png`); **no video files exist in the repository** | Earlier demonstration appearance only; video/demo capture is a PENDING deliverable, not retained evidence |
| Working-tree local checks | 350/350 unit tests across 30 files, typecheck, build and 5-workflow validation pass (env-var warnings only for optional values absent locally); [dated evidence](../evidence/LOCAL_VERIFICATION.md) | Latest firsthand results recorded in the evidence ledger (2026-09-20); not scenario deployment |
| Isolated SQL | 28/28 checks pass with `PGLITE_MODULE_PATH` set; a prior invocation without it failed `MODULE_NOT_FOUND` | Temporary dependency resolution prerequisite, not a migration failure; migrations 001–022 applied to hosted 2026-09-20 (situation #12); real multi-connection checks still pending |
| MCP profiles 1 and 2 | Implemented and offline-verified; 36 adapter cases included in the unit total; see [TESTING](../TESTING.md) | Handrolled stdio protocol is not SDK compliance certified; native n8n qualification includes authored signing Code-node logic. Live interoperability, tool calls and captures pending |
| Primary hardening / final build | Hardening implemented; final build passes locally | Build is not live service or database evidence; lint is configured (`npm run lint`) and remote CI was green on 2026-09-20 |
| Scenario local+tunnel walkthrough | Not executed/verified here | No deployment result |
| Current CI/live integration | Remote CI green on `main` at `017c03a` (2026-09-20); live integration not verified here | CI green is not a live-success or deployment claim |
| Interviews, real users, training delivery | Not performed/claimed | No customer/adoption evidence |
| Business impact | Unmeasured | No time-saved, conversion, ROI or cost-reduction result |

## Proposed measurements

| Metric | Measurement method | Baseline | Automated result |
|---|---|---|---|
| Intake response time | Time from synthetic submission to acknowledged storage; separately time triage completion | Not measured | Not measured |
| Complete workflow rate | Reconcile every expected record for a fixed valid/invalid synthetic set; include failures/skips | Not measured | Not measured |
| Qualification agreement | Human rubric versus model score/category on a versioned synthetic set | Not measured | Not measured |
| Review effort | Time comparable manual and AI-assisted drafting tasks with the same review standard | Not measured | Not measured |
| Policy/permission behavior | Observe allowed/denied calls and original-requester scope under final tests | Pending | Pending |
| Cost and latency | Provider-reported usage plus actual request timings; account for paths bypassing Gateway | Not measured | Not measured |
| Bot opt-out/follow-up | Inspect test-chat state, scheduled candidates and actual delivered messages | Not measured | Not measured |

If later measured, state sample size, revision, model/prompt version where known, provider configuration, timing method, failed cases and missing telemetry. A synthetic benchmark cannot establish real enrollment conversion or staff adoption. Do not extrapolate cost savings from assumed salary/volume as observed ROI.

## Completion criteria for this record

Only replace “not measured” with factual observations after the [deployment preflight](DEPLOYMENT.md) and an authorized run. Include negative results and unresolved problems. Keep the scenario simulation label even after local tests succeed. Publish redacted summaries only; retain raw results privately and never include secret values or real student/parent information.

Pending work remains in [ROADMAP](../ROADMAP.md). There is no factual basis for a `REAL_DEPLOYMENTS` document at this time.
