# External Agent API (Phase 9.10)

Authenticated REST surface for approved external applications to invoke governed agent capabilities. External callers get **no database access** — they invoke the same governed agent runtime used internally: tool allowlist, permission engine, guardrails, approvals, and full execution trace apply identically.

**MCP**: deliberately deferred — this REST surface is the primary interface; an MCP adapter can wrap it later over the same capability model.

---

## Authentication

Every request carries a provisioned client credential pair:

```
x-api-client: ac_<16 hex chars>
x-api-secret: sk_<43 base64url chars>
```

- Credentials are provisioned by Operations/Admin (`POST /api/agent/external-clients`); **the secret is shown exactly once** and only its SHA-256 hash is stored.
- Clients are individually revocable (`PATCH /api/agent/external-clients/[id]` → `{"enabled": false}`); disabled clients fail authentication immediately.
- Unknown client and wrong secret return the identical `401` — no existence leak.

## Capability model

```
External App → Auth → scopes ∩ allowed_agents → Agent Runtime → Tool Registry
```

| Boundary | Enforced by |
|---|---|
| Scopes | Client row (`scopes`, e.g. `agent.run`) — checked server-side per request |
| Agent identity | `allowed_agents` on the client — only listed agents can be invoked |
| Tools | The agent's registry allowlist — the external agent (`external-lead-support`) is **read-only by construction**: `get_lead`, `search_leads`, `get_lead_history`, `search_knowledge`, `escalate_to_human`, `finish`. No write tool is reachable. |
| Rate limit | `max_runs_per_hour` per client (default 10) |
| Audit | Every run traced in `agent_runs` + `agent_run_steps`, attributed to the client (`client_id`) and its provisioning admin |
| Budgets | Same guardrails as internal runs: step cap, wall-clock timeout, token budget, per-turn call cap, repeat-call loop guard, kill switch |

External runs execute under the `external` principal. Reads run with service-level visibility **by capability design** — the granted tool allowlist is the boundary (no raw database exposure exists at any point). Write capabilities would require an explicit new agent definition + scope, never a permission loosening.

---

## Endpoints

### `POST /api/external/agent/runs`

Start a governed agent run.

```json
{ "goal": "Which leads need follow-up today and what does the SOP say?", "agentId": "external-lead-support" }
```

Response (synchronous loop — the run completes or suspends for approval before responding):

```json
{
  "runId": "…", "status": "completed",
  "finalOutcome": "…", "error": null,
  "pendingApprovalId": null, "stepCount": 4
}
```

Statuses: `completed` · `escalated` · `awaiting_approval` · `failed`. Errors: `400` (validation) · `401` (auth) · `403` (scope/agent) · `429` (rate limit, with `Retry-After`) · `500`.

### `GET /api/external/agent/runs`

The client's own runs (newest 50), for audit/reconciliation.

### `GET /api/external/agent/runs/{id}`

Full trace of **one of the client's own runs** — steps with tool name, version, permission decision, status, errors. Another client's run returns `404` (indistinguishable from nonexistent).

### `GET /api/external/agent/tools`

Capability discovery: the agents and tools this client may use.

---

## Provisioning (Operations/Admin, session-authenticated)

- `GET /api/agent/external-clients` — list clients (no secrets).
- `POST /api/agent/external-clients` `{"name": "partner-app", "maxRunsPerHour": 10}` → `201 {client, secret}` — **store the secret now**.
- `PATCH /api/agent/external-clients/{id}` `{"enabled": false}` — revoke.

## Example (curl)

```bash
curl -s https://<host>/api/external/agent/runs \
  -H "x-api-client: ac_0123456789abcdef" \
  -H "x-api-secret: sk_…" \
  -H "Content-Type: application/json" \
  -d '{"goal": "Summarize the newest HOT lead and the recommended next step."}'
```

## Migration

Requires `supabase/migrations/012_external_api.sql` (idempotent): `agent_api_clients` table + `agent_runs.client_id`.
