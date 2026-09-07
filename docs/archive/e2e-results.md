# E2E Failure-Case Results (Phase 8.1)

Run: 2026-09-06T18:37:31.979Z — 8/8 passed

| # | Case | Result | Detail |
|---|---|---|---|
| 1 | valid lead → accepted + persisted + run success | ✅ pass | score 95 HOT, run success |
| 2 | invalid phone → 422 + failed run | ✅ pass | rejected, failed run recorded |
| 3 | missing name/email → 422 | ✅ pass | rejected: name is required |
| 4 | malformed email → 422 | ✅ pass | rejected |
| 5 | wrong secret → 401 | ✅ pass | rejected, failed run recorded |
| 6 | duplicate lead → accepted both times (no dedupe, by design) | ✅ pass | 2 rows — flagged as a known limitation (dedupe is future work) |
| 7 | oversized fields → handled gracefully | ✅ pass | HTTP 200 — no crash |
| 8 | unreachable pipeline → connection refused (app maps to 502) | ✅ pass | connection refused as expected |
