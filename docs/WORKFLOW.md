# Workflows — fixed automation and agent orchestration

Versioned n8n definitions are in `n8n/`; import/publish through `npm run push:n8n` only after stopping the intended instance. These diagrams describe source behavior, not a fresh successful execution. Setup and safety checks: [RUNBOOK](RUNBOOK.md).

## 1. Classic admissions pipeline

Source: `n8n/admissions-lead-pipeline.json:3`. Staff intake (`/api/leads`) and the Telegram chatbot feed this workflow, not the Next.js agent API.

```text
Signed webhook envelope + shared-secret header
  → Validate & authorize → invalid: record rejection / respond
  → Log run started → prepare qualification prompt → Gemini JSON
  → Schema check → retry eligible failure OR record terminal failure
  → Score & classify → insert lead → insert analysis
  → prepare email prompt → Gemini draft → email schema gate
  → dry-run record OR separate Gmail send + sent record
  → get counselors → assign counselor → assign lead
  → create follow-up task → create notification
  → build/write step logs → finish run → respond
```

Key references: intake validation at `n8n/admissions-lead-pipeline.json:32`, classification at `:337`, email gate at `:600`, dry-run branch at `:668`, counselor assignment at `:870` and step-log builder at `:1003`.

- The model proposes a score; code applies HOT/WARM/COLD thresholds (70/40). It is not a validated probability of enrollment.
- The email branch is separate from the agent's `prepare_email`. Keep `GMAIL_DRY_RUN=true`; real Gmail transport requires a deliberate credential/configuration decision outside this demonstration.
- Validation/schema/email failure branches and the error workflow are intended to record failures, but database/log-write failures can still prevent complete evidence. Do not claim that nothing can be silently lost without exercising these paths.
- This workflow does not gain the Next.js webhook's source/external-key deduplication simply because both accept leads.
- PromptLedger lookup in unattended nodes can fall back to last-known-good/committed prompts with source/error tags. This differs from interactive staff-tool fail-closed behavior; see [AI_DESIGN](AI_DESIGN.md).

## 2. Telegram parent inquiry chatbot

Source: `n8n/telegram-parent-chatbot.json:3`; conversation preparation at `:35`.

```text
Telegram update → prepare turn / workflow static chat state
  ├→ quick command (/start, /help, /stop) → deterministic reply/state update
  └→ prompt + simulated school knowledge → Gemini JSON → resolve turn
       ├→ FAQ answer / next collection question → Telegram reply
       └→ enrollment submission → signed classic admissions webhook
                                  → Telegram confirmation path
Hourly follow-up trigger → eligible CRM leads → nudge → update counters
```

The workflow collects lead information and marks Telegram origin. A synthetic email address substitutes where the classic pipeline requires an email; it is not verified parent contact information. Chat history and activity/language state live in workflow static data, not the agent knowledge store. Scheduled follow-ups use CRM flags/counters and can send real Telegram messages even when email is dry-run.

The embedded school facts and language behavior are demonstration assumptions, not a real institution's approved catalog. Follow-up counter/update races and static-data concurrency remain limitations. Full operations: [TELEGRAM-CHATBOT](TELEGRAM-CHATBOT.md).

## 3. Admissions error handler

Source: `n8n/error-handler.json:3`.

```text
Error Trigger → build error payload → attempt to close existing running row
  → check whether a row was closed → fallback crashed-run record when needed
```

`Close zombie run` is at `n8n/error-handler.json:100`; `Zombie closed?` at `:138`; fallback `Record crashed run` at `:63`. Inspect workflow connections rather than relying on JSON node order. This mechanism depends on the database and matching run identifiers; a configured handler is not proof that all failures are captured.

## 4. Next.js signed lead webhook and agent loop

This is **not an n8n workflow**:

```text
/api/webhooks/lead → verify custom envelope → normalize/validate
  → duplicate check / unique insert → counselor assignment
  → in-process system agent triage → registered tools → agent trace
```

`app/api/webhooks/lead/route.ts:96` implements intake; `:182` starts background triage. Acceptance of a lead does not prove completion of the agent run. This source-shaped adapter is not a deployed Facebook/Zalo account integration. Contract and lifecycle caveats: [EXTERNAL_API](EXTERNAL_API.md).

Employee `/api/agent/runs` and external REST also invoke the governed runtime. The model chooses tool order there; code checks authorization, validation and policy. Agent state, approvals, RAG, guardrails and delegation are documented once in [AGENT_CORE](AGENT_CORE.md), not duplicated node-by-node here.

## Operational conventions

Use the project's launcher so workflow configuration reaches n8n, but do not expose those values in logs/docs. The current launcher disables custom-role JWT minting; migration 008 alone does not establish least-privilege hosted writes. Review [SECURITY](SECURITY.md).

HTTP node serialization, headers, response wrapping and PostgREST bulk-row shapes must match the checked-in workflow; there is no universal instruction to always add or always omit `Content-Type`. Validate the workflow before import and verify the actual response format during the authorized local exercise. Local unit/type checks and the final build pass for the hardened working tree; live workflow behavior and remote CI remain unverified. The classic E2E runner now writes ignored `test-results/e2e-results.json`, not a new public Markdown report.

## 5. MCP profile 1: native n8n admissions tools

Source: [n8n/mcp-server-tools.json](../n8n/mcp-server-tools.json). This additive workflow changes no application code or existing workflow. “Config-only” means no application-code changes, **not no authored code**: qualification includes a signing Code node. It is independent of the [profile 2 stdio adapter](../mcp/README.md), which calls the governed external agent API instead. Both profiles are implemented with offline verification; live acceptance and captures remain pending, as recorded in the [execution report](EXECUTION_REPORT.md).

### Native node contract

Inspected locally: n8n **2.37.7**, `@n8n/n8n-nodes-langchain` **2.37.3**, `dist/nodes/mcp/McpTrigger/McpTrigger.node.js`.

- Exact trigger type: `@n8n/n8n-nodes-langchain.mcpTrigger`, `typeVersion: 2.1` (not `mcpServerTrigger`). Parameters: `authentication: "bearerAuth"`, `path: "admissions-tools"`, and `instructions` (string). Path is required; the node's source default is an empty string, not a fixed generated endpoint.
- The trigger accepts `ai_tool` connections and has no main output. Both tool nodes connect **into** the trigger's Tools input. It handles protocol responses natively: there is no `respondToMcpCall` node or configurable trigger `responseMode`. Its webhook descriptors use `onReceived`; the handler returns `noWebhookResponse: true` while MCP transports own the response.
- With default endpoint prefixes, production URL is `http://127.0.0.1:5678/mcp/admissions-tools`; test URL is `http://127.0.0.1:5678/mcp-test/admissions-tools`. Version 2.1 uses the same path for GET/POST/DELETE, without the legacy v1 `/sse` and `/messages` suffixes. Use Streamable HTTP for the tests below; the native trigger also supports SSE. Copy the editor URL if deployment prefixes differ.
- Built-in bearer auth requires an n8n **Bearer Auth** credential (`httpBearerAuth`, field `token`). Clients must send **`Authorization: Bearer <token>`** on every request, including session requests. HTTP header names are case-insensitive; the implemented value comparison requires exactly `Bearer ` followed by the token. Missing/wrong bearer values return 403; absent credential configuration returns 500. No credential ID, token, or placeholder secret is committed: bind the credential in the editor before publishing. Authentication is never silently downgraded to none.

### Tool mapping and responses

```text
qualify_lead --ai_tool--> Admissions MCP Server <--ai_tool-- recent_runs
      |
      | Call n8n Sub-Workflow Tool, workflowId = current $workflow.id
      v
Lead tool input -> Sign lead envelope -> Call admissions webhook
```

The subworkflow invocation starts at `executeWorkflowTrigger`, not at the MCP trigger; it does not recursively call MCP. Keep both entry points in this single workflow and publish them together. `callerPolicy: workflowsFromSameOwner` limits subworkflow callers to the same project/ownership boundary; this is not employee-level authorization.

| Tool | Input and native nodes | Destination / behavior |
|---|---|---|
| `qualify_lead` | `{ "payload": { "name": "...", "email": "..." } }`; `@n8n/n8n-nodes-langchain.toolWorkflow` v2.2, `source: "database"`, resource-locator `workflowId.value = $workflow.id`; `workflowInputs.value.payload` uses `$fromAI(..., "json")`, with an object resource-mapper schema | Calls its own subworkflow entry, signs the unchanged payload, then POSTs to `http://127.0.0.1:5678/webhook/admissions-lead` through `n8n-nodes-base.httpRequest` v4.2. Header `x-webhook-secret` comes from `$env.N8N_WEBHOOK_SECRET`. |
| `recent_runs` | `{ "N": 10 }` or `{}`; native HTTP Request's generated tool variant `n8n-nodes-base.httpRequestTool` v4.2; `$fromAI("N", ..., "number", 10)` | GET `$env.SUPABASE_URL/rest/v1/agent_runs`, `select=run_id:id,status,agent_id,created_at:started_at`, `order=started_at.desc,id.desc`, `limit` rounded down and clamped to 1–100. Both `apikey` and `Authorization: Bearer ...` use `$env.SUPABASE_SERVICE_ROLE_KEY`. No anon key is needed for this service-role pattern. |

The existing admissions webhook rejects a bare lead even with the secret header. The Code node creates `{ payload, timestamp, signature }`, with a millisecond timestamp and hex HMAC-SHA256 of `timestamp + '.' + JSON.stringify(payload)`, using the same secret. The existing five-minute freshness and signature checks remain intact; callers never receive or supply the signing secret. Optional lead fields are `phone`, `source`, `course_interest`, `budget`, `timeline`, `message`, and `telegram_chat_id`; the existing pipeline remains responsible for field validation. The native `$fromAI` JSON schema is broad, so the signing branch explicitly rejects arrays/non-object payloads.

The database columns actually are `agent_runs.id` and `agent_runs.started_at` (migration 010). PostgREST aliases provide the requested `run_id` and `created_at` output names without a migration. **These are agent-runtime runs, not the classic pipeline's `automation_runs`; a successful `qualify_lead` does not create an `agent_runs` row.**

Both HTTP nodes configure `options.response.response = { responseFormat: "json", fullResponse: true, neverError: ... }`. Full responses retain `body`, `headers`, `statusCode`, and `statusMessage`, including an empty `body: []` for zero recent runs. The native tool/MCP adapter serializes results into text content; expect n8n item-array wrapping, not an application-specific top-level JSON-RPC result schema.

- `qualify_lead`: `neverError: true`, timeout 300000 ms. JSON HTTP rejection bodies/statuses are returned as data; inspect `statusCode` and `body.accepted`, not just MCP `isError`. A successful pipeline response body includes `accepted`, `run_id`, `lead_id`, score/category/intent, summary and recommended action. Non-JSON responses or transport failures can still become tool errors.
- `recent_runs`: `neverError: false`, timeout 15000 ms. Non-2xx responses become native tool errors rather than misleading empty run lists.
- Neither tool retries automatically; redirects are disabled on both HTTP nodes. A timeout/disconnect is not proof that the pipeline stopped. Do not blindly resubmit; this classic pipeline has no intake deduplication guarantee.

### Required configuration (no `.env` edits included)

| Name / setting | Requirement |
|---|---|
| `N8N_WEBHOOK_SECRET` | Nonempty existing admissions secret, available to the n8n HTTP and signing nodes. |
| `SUPABASE_URL` | Supabase project URL; launcher derives it from `NEXT_PUBLIC_SUPABASE_URL` when not explicitly supplied. |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server-only service-role key, never provided to an MCP client. |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | Required for existing `$env` expressions; already set by `scripts/start-n8n.mjs`. |
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto,node:crypto` | Required by the signing Code node and existing webhook validator; already set by the launcher. External task runners must receive equivalent configuration. |
| `GEMINI_API_KEY` | Existing admissions pipeline prerequisite; `AI_MODEL` remains optional with the pipeline default. |
| `GMAIL_DRY_RUN=true` | Keep enabled for the synthetic test. This still writes CRM, email-draft, task and notification records and consumes model quota. Real Gmail requires the existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` setup and a deliberate opt-in. |
| MCP bearer credential | Configure an independent random token in n8n's encrypted `httpBearerAuth` credential and privately in the MCP client. No new MCP environment variable is required. Do not reuse the webhook secret or Supabase key. |

Existing pipeline database migrations, counselor profiles, model access and optional PromptLedger configuration remain prerequisites; this workflow does not provision them. The launcher sets port 5678 and its self-webhook URL uses `localhost`; this workflow deliberately uses equivalent IPv4 loopback `127.0.0.1`, never the public Telegram tunnel URL.

### Import and live test (user-run only)

No n8n server, Inspector, import/publish command, or live tool call was run during implementation.

1. Validate from the repository root: `node scripts/validate-n8n.mjs`.
2. In an already configured local n8n editor, create a workflow, choose **Import from File**, and select `n8n/mcp-server-tools.json`. Open **Admissions MCP Server**, keep **Bearer Auth**, create/select its Bearer Auth credential, and enter only the token (without the `Bearer ` prefix). Save. Verify `qualify_lead` still targets the current `$workflow.id` and both tools connect to the server's Tools input. Never publish with authentication set to None.
3. Publish this workflow before testing its self-subworkflow call. Ensure the existing **Admissions Lead Pipeline** is published with the same secret and prerequisites. Do not import or overwrite other workflows just to test this addition. If n8n is not already running, starting it via `npm run n8n` is a separate explicit operator action, not part of validation.
4. Optional offline CLI import instead of the editor: first deliberately stop the intended n8n instance; from the same n8n user/database environment run `npx --no-install n8n import:workflow --input="n8n/mcp-server-tools.json"`. Then start the configured instance yourself, bind the credential and publish in the editor. The repository deployment shortcut, **only after credentials are bound and the intended instance is stopped**, is `npm run push:n8n -- --input n8n/mcp-server-tools.json`; it imports and attempts to publish this file. Do not use `--kill`, `--force`, or the unfiltered all-workflows push for this test.
5. Optional official MCP Inspector (may download into npm's cache): run `npx @modelcontextprotocol/inspector`. In its UI choose **Streamable HTTP**, URL `http://127.0.0.1:5678/mcp/admissions-tools`, and add header `Authorization` with value `Bearer <your private token>`. Set request timeout to at least 360000 ms for qualification. Do not put tokens in command-line arguments, committed host configuration, logs or screenshots. Connect/initialize, then **List Tools**; expect exactly `qualify_lead` and `recent_runs`. The Inspector manages initialization and session headers.
6. For the test endpoint, keep the saved/published subworkflow available, open the MCP trigger and click **Listen for test event / Execute step**, then connect a **new** Inspector session to `http://127.0.0.1:5678/mcp-test/admissions-tools` with the same bearer header. The test listener is temporary; re-arm it and reconnect when it expires. Testing here still invokes the **production admissions webhook**, not `/webhook-test/admissions-lead`.
7. Call `recent_runs` with `{ "N": 2 }`, then `{}`. Expect at most 2 and 10 rows respectively in the returned HTTP body, newest first, with exactly the four selected field names. Empty agent history should return `body: []`, not a missing-response error. `{ "N": 1000 }` is capped at 100; `{ "N": 0 }` becomes 1; nonnumeric N should be rejected by the tool schema.
8. With explicit permission for synthetic CRM mutations, a disposable dataset, and email dry-run confirmed, call `qualify_lead` once with:

   ```json
   {
     "payload": {
       "name": "MCP Synthetic Lead",
       "email": "mcp-profile1@example.invalid",
       "source": "mcp-profile-1",
       "course_interest": "English",
       "message": "Synthetic integration test; please do not contact."
     }
   }
   ```

   Inspect MCP text content for the HTTP response (`statusCode: 200`, `body.accepted: true`) and inspect n8n executions plus the returned `automation_runs`/lead IDs. Confirm `sent_emails.status = dry_run`. Do not expect this run in `recent_runs`. Pipeline/configuration errors must be reported rather than counted as successful qualification. Remove synthetic records using your approved cleanup process.
9. Disconnect and try a new session with no bearer token and then an incorrect token: both should fail with HTTP 403 without executing tools. Reconnect with the correct token. Test on a disposable dataset if exercising invalid-lead payloads: rejection branches also write logs. Do not disable auth to troubleshoot a 500; check the bound credential instead.

### Verification and limitations

Implementation checks: `node scripts/validate-n8n.mjs` exited 0 and reported **all four n8n workflow JSONs valid (3 warnings)**. Warnings are the pre-existing admissions `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` names missing from the local environment; the new workflow was clean. `npm run typecheck -- --incremental false` passed. No lint script exists in the inspected manifest; a maintainer-provided lint command is still needed.

An ephemeral offline check against installed node implementations passed tool schemas, N defaults/clamping, bearer comparison semantics, response settings, and the new envelope against the unchanged pipeline validator (including tampered/stale/wrong-secret rejection). This is **not** evidence of an imported workflow, working task runner, live MCP handshake, self-subworkflow execution, Supabase access, or completed admissions run. Perform the user-run acceptance steps above before deployment.

The default native MCP server constructs an `InMemorySessionStore`; this profile targets the existing single local instance. Sessions can disappear on restart/expiry and clients must reinitialize. The installed package also has queue/Redis support, but distributed deployment/session routing is not configured or verified here. Loopback port 5678 assumes both endpoints share the same instance/network namespace; a container or proxy topology needs deliberate configuration. Execution concurrency must leave capacity for the nested subworkflow and loopback admissions request, or synchronous self-calls can stall.

The bearer token grants both tools to its holder: no per-tool scopes, employee identity, tenant filters, approval gates, or rate limits are added. `recent_runs` uses service-role access across users; `qualify_lead` invokes the classic pipeline, not the governed agent API. Restrict this profile to trusted operators authorized for that dataset, use HTTPS if exposing it beyond loopback, and account for n8n execution logs retaining lead data. Tool descriptions are guidance, not authorization controls.
