# External integration API

Two independent Next.js surfaces exist: credential-based agent REST and a shared-secret signed lead webhook. They use the governed runtime, but neither is proof of a live partner connection or multi-tenant isolation. **Both MCP profiles are implemented with offline verification; live acceptance remains pending.**

- [Profile 2: stdio adapter](../mcp/README.md) wraps this REST API via [mcp/server.mjs](../mcp/server.mjs), exposing `list_capabilities`, `run_agent_goal` and `get_run_trace`. Its 36 unit cases are included in the final 273-test pass; [scripts/verify-mcp.mjs](../scripts/verify-mcp.mjs) supports offline discovery and opt-in live checks. It is a handrolled protocol implementation, not an SDK-backed or compliance-certified server.
- [Profile 1: native n8n tools](WORKFLOW.md#5-mcp-profile-1-native-n8n-admissions-tools) exposes classic-pipeline qualification and service-role recent agent runs through [n8n/mcp-server-tools.json](../n8n/mcp-server-tools.json). It does not inherit the governed REST API's scopes, approvals or rate limits. Its signing Code node means “config-only” describes no application-code changes, not no authored code.

Inspector interoperability, live calls and redacted captures for both profiles remain pending; offline verification is not production readiness (see [TESTING](TESTING.md)).

Scope model: machine clients are provisioned with an allowlisted scope set (`agent.run`, `briefing.generate`) enforced at provisioning time and checked per route. A `briefing.generate` client is rejected on the general run route with 403 — scope isolation is regression-tested. Secrets are stored hashed and shown once.

## Agent REST authentication and boundary

Send provisioned `x-api-client` and `x-api-secret` headers on external requests. Values are secrets; examples here deliberately omit them. `lib/agent/external-server.ts:25` checks client shape, stored SHA-256 secret hash and enabled state. Unknown clients and invalid/disabled credentials share an invalid-credentials response; missing/malformed input has its own 401 response.

Operations/Admin session routes provision clients (secret returned once), list nonsecret metadata and revoke access:

| Method | Route | Body / purpose |
|---|---|---|
| GET | `/api/agent/external-clients` | List clients |
| POST | `/api/agent/external-clients` | `{"name":"local-demo-client","maxRunsPerHour":10}`; returns client plus one-time secret |
| PATCH | `/api/agent/external-clients/{id}` | `{"enabled":false}` |

Keep the issued secret privately; do not include it in evidence or checked-in commands. Optional `allowedAgents` must be an array of registered agent IDs; malformed/unknown entries return 400. Omitted or empty arrays use `external-lead-support`. Registration validation does not grant tools outside the permission engine.

`POST /api/external/agent/runs` checks `agent.run`, the client's `allowed_agents`, and the client's per-hour budget (`app/api/external/agent/runs/route.ts:20`). Default external agent: `external-lead-support`, with CRM/history/knowledge read tools and finish/escalation outcomes. No CRM write tool is in its allowlist (`lib/agent/agents.ts:56`).

**Critical distinction:** runtime `userClient` and `adminClient` are both the service client (`app/api/external/agent/runs/route.ts:58`). The API does not give callers raw database credentials, but permitted CRM read tools can read across employee scopes. There is no per-client tenant ownership filter for CRM records. Own-run filtering is audit visibility, not tenant isolation. Only grant credentials to trusted integrations authorized for that dataset.

## Agent REST endpoints

| Method | Route | Behavior |
|---|---|---|
| POST | `/api/external/agent/runs` | Start a goal; synchronous response after outcome or suspension |
| GET | `/api/external/agent/runs` | Client's newest 50 runs |
| GET | `/api/external/agent/runs/{id}` | Trace of one client-owned run; other/nonexistent run yields 404 |
| GET | `/api/external/agent/tools` | Capability discovery for the client |

Example request body, **not an executed request**:

```json
{
  "goal": "Summarize the available synthetic leads and cite the follow-up SOP.",
  "agentId": "external-lead-support"
}
```

`goal` must be 5–2000 trimmed characters. Run output fields are `runId`, `status`, `finalOutcome`, `error`, `pendingApprovalId`, `stepCount` (`lib/agent/runtime.ts:67`). Do not infer completion from HTTP 200: inspect the run status and error. Auth/validation/policy/rate errors use 401/400/403/429; 429 includes `Retry-After`; unexpected failures can return 500.

Run creation returns **500** if the client has no `created_by` provisioning identity; it no longer substitutes a zero UUID. Run list and detail GETs share a **60 reads/minute/client** bucket and return 429 with `Retry-After` when blocked. This new read limit applies to run history, not every external endpoint. Creation retains its separate per-hour client budget.

Run rows attribute the client and provisioning identity. Revocation blocks subsequent requests, not an already-running request. Postgres limiter errors deliberately fail open. Route unit tests pass; live enforcement and database state remain unverified.

## Signed lead webhook — separate from REST client credentials

`POST /api/webhooks/lead` accepts the project's custom signed envelope and starts system-level admissions triage (`app/api/webhooks/lead/route.ts:96`). It is not the n8n admissions webhook and does not invoke that fixed pipeline.

Required authentication:

- `x-webhook-secret` matching the configured lead secret (`LEAD_WEBHOOK_SECRET`, falling back to `N8N_WEBHOOK_SECRET`).
- Envelope fields `timestamp`, `signature`, `payload`, using `signPayload` / `verifyEnvelope` in `lib/webhook-signing.ts:33` and `lib/webhook-signing.ts:48`.
- HMAC-SHA256 over the timestamp and serialized payload, with replay-window validation. Use the shared helper rather than guessing serialization or treating the static header as sufficient.

Payload requires a stable `external_id` (string/number) for duplicate detection; `source` identifies the source. Field aliases normalize inputs such as `full_name`, `email_address`, `phone_number`, `program` and Facebook-shaped `field_data` arrays. The inspected route validates name and email after normalization; it should not be described as equivalent to every classic pipeline field/length validation. This remaining webhook limitation is distinct from the implemented recipient validation in the agent email tool.

| Result | Meaning |
|---|---|
| 202, `accepted: true`, `duplicate: false` | Lead stored and in-process triage invoked; **not completed triage** |
| 200, `duplicate: true` | Existing source/external key acknowledged; does not prove the original triage succeeded |
| 400 / 401 / 422 / 429 / 500 | JSON, authentication, validation, rate or storage/configuration failure |

Migration 013 adds source-key uniqueness. The route handles duplicate delivery and insertion races, assigns a counselor and invokes the admissions agent under trusted system/admin context. Background dispatch at `app/api/webhooks/lead/route.ts:182` has no durable worker queue; reconcile accepted leads if the process exits or triage fails. Durable background dispatch and broader intake-validation changes are not part of the completed hardening scope.

Supporting a Facebook-shaped payload is not native provider signature verification, subscription setup or a live account integration. Telegram uses the distinct n8n chatbot path documented in [WORKFLOW](WORKFLOW.md).

## Setup, testing and scope

External-client schema is in migration 012; lead-source keys in 013; limiter/cache in 014. Apply the complete ordered schema through `015_approval_resume.sql` per [RUNBOOK](RUNBOOK.md), including its legacy reconciliation review. Application to a live database is unverified.

Verification scripts are listed in [TESTING](TESTING.md). They may provision clients, create records and consume quota; no current run result is claimed here. Use the local app or an explicitly authorized temporary tunnel, never an assumed production host. See [SECURITY](SECURITY.md) before exposing the API.
