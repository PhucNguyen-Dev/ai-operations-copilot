# MCP profile 2: thin stdio adapter

Node 22+, no build step, no dependencies or installation required. This adapter calls the existing [external agent REST API](../docs/EXTERNAL_API.md); it does not import or change application code. It is implemented and offline-verified, with 36 unit cases included in the final 273-test pass. Live API calls, Inspector interoperability and captures remain pending; see the [execution report](../docs/EXECUTION_REPORT.md). This is a handrolled protocol implementation, not SDK-backed or MCP compliance certified, and not a production-readiness claim.

## Run

From the repository root, set these environment variables in the MCP host or your shell:

| Variable | Required value |
|---|---|
| `COPILOT_API_URL` | App base URL, e.g. `http://localhost:3000`; optional deployment path prefix, no query/fragment/embedded credentials |
| `COPILOT_API_CLIENT` | Provisioned external client ID |
| `COPILOT_API_SECRET` | That client's secret, supplied privately |

The adapter does not load `.env` automatically. Missing or blank configuration exits 1 with a clear stderr error and no stdout output. Use HTTPS outside trusted local development. Redirects are not followed, so custom credential headers cannot be forwarded to a redirected host.

```sh
node mcp/server.mjs
```

For an MCP host, use `node` as the command and the absolute path to `mcp/server.mjs` as its argument, with the three variables in the child environment. No HTTP listener is created. Stdin/stdout carry newline-delimited UTF-8 JSON-RPC 2.0, one message per line; diagnostics use stderr only.

### Inspector

Optional external development tool, not an adapter dependency; this command may download the Inspector into npm's cache. It was not installed or run as part of implementation.

```sh
npx @modelcontextprotocol/inspector node mcp/server.mjs
```

Set the three variables in the Inspector's stdio server environment before connecting. Do not put secrets in command-line arguments, screenshots, or checked-in host configuration. Initialize, list tools, and call `list_capabilities`; calling `run_agent_goal` consumes real API quota.

## Protocol and tools

`initialize` accepts supported versions `2025-11-25`, `2025-06-18`, `2025-03-26`, and `2024-11-05`. Other requested versions receive preferred version `2025-11-25`; clients must disconnect if unsupported. Send `notifications/initialized` before tool requests. `ping` is supported. Only `{ "tools": {} }` is advertised.

| Tool | Arguments | API mapping |
|---|---|---|
| `list_capabilities` | `{}` | GET `/api/external/agent/tools` |
| `run_agent_goal` | `goal`, optional `agentId` | POST `/api/external/agent/runs` |
| `get_run_trace` | `id` | GET `/api/external/agent/runs/{id}` |

Goals are trimmed and must contain 5–2000 characters. Omitted/empty `agentId` retains the API default `external-lead-support`. Trace IDs must be nonempty letters/digits/underscore/hyphen identifiers (including UUIDs); paths and query strings are rejected. Extra arguments are rejected. Authentication uses `x-api-client` and `x-api-secret` headers.

Successful API JSON is returned unchanged as serialized JSON in a single MCP text content block. HTTP 200 is transport success, **not proof of goal completion**: inspect `status`, `error`, `pendingApprovalId`, and other run fields.

HTTP failures, including 401, 403, 429 and all 5xx, return `isError: true` with text containing `{ "code": "HTTP_<status>", "status": 429, "body": ... }`. When present, `Retry-After` is preserved verbatim as `retryAfter`, including HTTP-date values. Non-JSON HTTP error bodies remain text. Network/body-read failures use `TRANSPORT_FAILURE` (with status if already received); malformed successful JSON uses `INVALID_API_RESPONSE` with status. Raw transport exceptions and credentials are not logged. Unknown tools/invalid arguments use JSON-RPC `-32602`; unsupported methods use `-32601`.

There are **no retries**, rate-limit sleeps, redirect following, or automatic resubmissions. A transport failure may occur after a run was accepted; do not blindly resubmit. The adapter has no run timeout, cancellation propagation, progress reporting, batching, tasks, resources, prompts, subscriptions, sampling, or approval-resume tool. Long-running synchronous requests remain pending until the API responds or the host terminates the process. Unknown notifications are ignored without a response.

Authorization, scope, agent allowlists, read limits, and run budgets remain enforced by the API. This adds no tenant isolation: the API's service-client CRM reads may cross employee scopes; client-owned trace filtering is audit visibility only. Provision credentials only for trusted integrations authorized for the dataset.

## Verification

```sh
npm test
npm run typecheck
node --check mcp/server.mjs
node --check scripts/verify-mcp.mjs
node scripts/verify-mcp.mjs
```

The self-contained verifier spawns the real stdio adapter, negotiates initialization and checks three tool schemas. Default mode makes **no HTTP requests**, needs no dev server, and uses dummy credentials when unset. It defaults `COPILOT_API_URL` to `http://localhost:3000`. It prints PASS/FAIL/SKIP lines and exits 0 on success or 1 on failure, cleaning up its child.

To opt into real API verification, run your separately configured dev server, provide provisioned credentials, and set `RUN_MCP_LIVE=1` before the same invocation. In PowerShell:

```powershell
$env:RUN_MCP_LIVE = '1'
node scripts/verify-mcp.mjs
Remove-Item Env:RUN_MCP_LIVE
```

Live mode discovers capabilities, submits one synthetic-lead summary goal, and retrieves its trace. It consumes quota and can create run/audit/approval records; it does not provision clients or clean up records. Failed run status/error fails verification; completed, escalated and awaiting-approval statuses are reported distinctly. The verifier times out live requests after 180 seconds without retrying; killing the adapter does not cancel an accepted server-side run.

`scripts/verify-external-api.mjs` exists and targets the dev API via `EXTERNAL_BASE_URL` (default `http://localhost:3000`). It provisions a temporary client and requires a configured database/dev server. It was inspected, not edited or executed; neither live API behavior nor Inspector interoperability is claimed verified here. Unit tests use injected fetch mocks and spawned stdio processes without live API access.
