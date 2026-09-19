# Deployment plan — local services plus temporary tunnel

**Planned skeleton, not an implemented or executed deployment.** Required services are absent for this exercise. Within the at-most-one-week [locked scope](../ROADMAP.md), execute only if services and live authorization become available; otherwise leave the gates pending. Both MCP profiles are implemented and offline-verified in the repository, but no live MCP acceptance, hosted environment or school onboarding is completed.

## Target topology

```text
Local browser → local Next.js app → disposable Supabase project
Local Next.js app → direct Gemini / optional configured JSON Gateway
Authorized test Telegram chat → temporary HTTPS tunnel → local n8n
Local n8n → signed local admissions webhook → synthetic CRM records
```

Supabase and AI providers may be remote services; “local” describes application/orchestrator hosting, not an entirely offline or self-hosted stack. Optional PromptLedger receives content-bearing telemetry if configured. It is not required for explaining the scenario. Optional MCP paths are the [stdio REST adapter](../../mcp/README.md) and [native n8n tools](../WORKFLOW.md#5-mcp-profile-1-native-n8n-admissions-tools); neither is assumed configured or live-accepted for this scenario.

## Preflight — offline checks pass, scenario acceptance pending

1. Final offline checks pass (273 unit tests across 23 files, typecheck, 4-workflow validation with 3 existing Gmail variable warnings, build). Isolated SQL passes 28 checks after `PGLITE_MODULE_PATH` is set; the prior missing-path `MODULE_NOT_FOUND` is not a migration failure. Approval policy is regression-tested, but hosted migration 015 and real multi-connection acceptance remain pending. Close the [release/live gates](../ROADMAP.md) before demonstrating those guarantees.
2. Review/apply the complete ordered migrations through `015_approval_resume.sql` to the authorized disposable project. Reconcile ambiguous legacy approvals and verify requester-role/grant/concurrent-claim behavior; no migration was applied in this docs task.
3. Configure secrets privately; use synthetic records and an authorized test Telegram chat. Review access/retention and broad external service-client visibility in [SECURITY](../SECURITY.md).
4. Keep n8n Gmail dry-run enabled. Agent `prepare_email` remains dry-run independently of approval settings. Remember that Telegram can send real messages to the test chat.
5. Review tunnel exposure, local ports, process ownership, import/publish effects and scheduled follow-ups. Close unintended public editor access; a random tunnel URL is not access control.

Commands and credential names are canonical in [RUNBOOK](../RUNBOOK.md) and [TELEGRAM-CHATBOT](../TELEGRAM-CHATBOT.md); do not duplicate secret-bearing configuration here.

## Planned walkthrough

| Step | Planned action | Capture only if observed |
|---|---|---|
| Staff baseline | Log in with disposable role accounts and inspect synthetic CRM visibility | Redacted role/resource observations; no credentials |
| Classic flow | Submit a synthetic lead through the internal form | Correlated n8n run, analysis, dry-run email, task and notification |
| Chatbot | Ask a fictional-course question, submit synthetic details, then opt out | Redacted reply/state and pipeline reconciliation |
| Agent | Ask a scoped follow-up question and inspect tool outcomes | Run status, allowed/denied tool names and source excerpts |
| Approval | Review a dry-run draft through finalized approval flow | Exact reviewed action and resulting dry-run record, not a sent-mail claim |
| External REST | Optional disposable trusted client exercise | Auth/revocation and own-run history, with explicit CRM visibility limitation |
| Failure handling | Controlled failure case in the disposable setup | Actual error, record state and recovery observation |

Do not run live scripts solely to populate a success table. Every action needs authorization for its data writes, quota and messaging effects. Failed or skipped steps remain failed/skipped rather than being rewritten as outcomes.

## Stop / rollback

Stop owned local processes and the tunnel; revoke the disposable external client; review bot registration and scheduled follow-up state. Restore runtime/tool flags to their recorded prior values only after investigating failures. Reconcile accepted leads and pending approvals before retrying non-idempotent actions. Remove fixtures deliberately without deleting unrelated records.

Never commit raw test-results, credentials or unredacted chat traces. Record revision, command, environment class and limitations in [RESULTS](RESULTS.md) only after measurement. The demonstration stays local+tunnel; production infrastructure and real user onboarding need a separate approved plan.
