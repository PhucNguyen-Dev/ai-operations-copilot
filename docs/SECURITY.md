# Security boundaries and limitations

Source-based review of the hardened working tree for a synthetic-data local demonstration, not security certification. Offline checks (unit/type/n8n validation/build) and an isolated PGlite SQL verification of the approval migrations pass; hosted migration 015 application and live SQL/role/CI acceptance remain unverified. [Local evidence](evidence/LOCAL_VERIFICATION.md) records results; [ROADMAP](ROADMAP.md) locks remaining gates.

## Trust boundaries

| Boundary | Existing mechanism | Limitation / validation needed |
|---|---|---|
| Employee session | Supabase Auth, server role gates and RLS client | Validate the final role/resource matrix; UI visibility is not authorization |
| Initial employee agent reads | Requester's client in `app/api/agent/runs/route.ts:19` | Service-role persistence and writes still require resource checks |
| Tool execution | Allowlist/role/policy engine, `lib/agent/permissions.ts:36`; resource checks inside tools | Prompt instructions do not replace server authorization |
| Approval resume | Independent Operations/Admin decision, durable claim, service-role requester RPC using authoritative Auth role | Implemented; migration application/live grants and resource tests pending; uncertain claimed effects require reconciliation |
| External agent REST | Hashed client secret, enabled flag, scopes, agent allowlist and run-history client filter | Reads use the service client (`app/api/external/agent/runs/route.ts:58`); **no tenant-level CRM isolation** |
| Lead webhook | Shared-secret header plus HMAC envelope/replay-window validation | Trusted system/admin triage; not native Facebook/Zalo account authentication |
| n8n pipeline | Signed internal intake, trusted workflow code, server credentials | Current launcher disables custom-role JWT minting (`scripts/start-n8n.mjs:40`); do not claim migration 008 makes hosted pipeline writes least-privilege |
| Knowledge | Sanitized direct keyword filters; resumed reads verify authoritative requester via RPC and filter role/department | Live grants/semantic-keyword matrix pending; excerpts remain untrusted input |
| Rate limit | Postgres RPC or memory alternative | Postgres RPC failure currently fails open (`lib/rate-limit.ts:88`); not a hard abuse/spend ceiling |

## Approval and side effects

`prepare_email` records only a dry-run draft (`lib/agent/tools/comms.ts:64`). Approval does not send it. Keep n8n's separate Gmail path in dry-run mode for demonstrations and avoid real recipient addresses.

Migration 015 implements a durable bound approval claim and service-role-only requester-read RPCs, SQL-verified in isolated PGlite (28 checks; single connection). Resume compares the saved identity/role with `auth.users.raw_app_meta_data.role`, not the profile mirror, and does not expose the approver's client to tools. Permission/resource/enabled/kill checks run again before execution. Same-decision retries preserve the decision, conflicting changes return 409, and self-decisions return 403.

The claim permits at-most-once entry to approved execution, not exactly-once effects. After interruption or timeout the effect can be uncertain: no blind replay, and `RECONCILIATION_REQUIRED` needs operator review. The claim SQL is verified in isolated PGlite; hosted application, managed-project grant/role behavior and real multi-connection concurrency need live acceptance; [RUNBOOK](RUNBOOK.md) covers ambiguous legacy rows. Server approval requirements and requester opt-in are combined with OR and persisted in `current_state.require_approval`. Resume retains/strengthens the requirement and children inherit it; requester flags cannot weaken it. This fix has regression coverage; live acceptance is still pending.

The lead webhook acknowledges storage before background agent completion (`app/api/webhooks/lead/route.ts:182`). Process exit, provider errors or a kill switch can leave accepted leads without completed triage. Source/external-key uniqueness is intake deduplication, not a durable job queue or universal idempotency.

## Secrets and local exposure

- Configure keys outside versioned documentation; never include secret values, tokens, cookies, signed credentials or environment-file contents in screenshots or reports.
- Service-role keys, webhook secrets, Gmail OAuth material, Telegram credentials and optional Gateway/PromptLedger keys remain server/operator secrets. Use disposable demo accounts; never reuse demo access for real data.
- The n8n launcher permits workflow environment access and disables secure cookies for its local editor (`scripts/start-n8n.mjs:71`). Those local settings are not a hardened public deployment configuration.
- A tunnel can expose more than one webhook path on the origin service. Keep the editor local, review tunnel exposure/access controls, use a disposable demo environment and close the tunnel after the authorized exercise. Do not equate a random URL with access control.
- Migration 008 contains a custom pipeline role, but availability of a SQL role is not proof that hosted PostgREST can assume it. Verify the actual credential path without printing credentials.

## Personal data, prompts and traces

Use synthetic leads, campaign metrics and course data. Even names, phone numbers, chat history, goals, task text and generated drafts may become personal data in a real deployment; this repository does not establish a consent or retention program for real students or minors.

`lib/runtrace.ts:18` defines full input/output capture; `lib/runtrace.ts:116` sends optional telemetry to PromptLedger. Pipeline payload snapshots, agent feedback, n8n static chat state and shared response-cache values may also contain content. Do not describe logging as metadata-only or automatically redacted. Treat database access, observability access and optional satellite access as data-access decisions.

PromptLedger run telemetry is best-effort and may fail independently from inference. A deployment-pin or trace entry does not imply that PromptLedger owns that prompt. Ownership and provider routing are mapped in [AI_DESIGN](AI_DESIGN.md).

Before real-data use, define retention/deletion, redaction, access review, vendor data-processing terms, incident ownership and backup handling. No regulatory compliance, comprehensive audit immutability or enterprise isolation is claimed.

## Stop and recover

Use the agent kill switch and tool-disable controls in [RUNBOOK](RUNBOOK.md). They affect subsequent checks, not necessarily an already-running provider request or side effect. Disable compromised external clients, stop the bot/tunnel and rotate affected credentials privately. Inspect only necessary redacted records; reconcile pending approvals and accepted-but-untriaged leads before restarting. Keep raw test results private and do not publish environment dumps.

Validation commands and evidence boundaries: [TESTING](TESTING.md). No live service or secret configuration was inspected for this documentation consolidation.
