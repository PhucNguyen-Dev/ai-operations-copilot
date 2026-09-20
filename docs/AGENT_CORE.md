# Agent core

How the Ask X agent works: runtime, tools, permissions, sessions and the briefing path.

## Runtime

`lib/agent/runtime.ts` executes every run inside hard bounds — max steps, wall-clock time and token budget — with a kill switch and per-tool disable checks honored before each tool call. The clock is **injected**, so tests and the date-bounds guard share one time source. Every step is traced via `lib/runtrace.ts` (tool name, input/output summaries, duration) — this trace is what the chat UI renders as step summaries and what the rich answer cards are derived from. No live step polling: the run flow is request → bounded execution → persisted trace → rendered.

## Agents

| Agent | Purpose |
|---|---|
| **Oracle** (default) | Routes a goal to the right specialist(s), synthesizes results, asks clarifying questions when a request is ambiguous (clarification round-trips, migration 017) |
| **CRM specialist** | Lead queries and mutations — always date-bounded: a "this week" request must produce a provably bounded search, enforced at the tool/runtime boundary, not by prompt alone |
| **Knowledge specialist** | SOP/document retrieval, role/department filtered |
| **Comms** | Email drafting via `prepare_email` — dry-run drafts only; real dispatch happens exclusively through the human approval gate |
| **Briefing** | Generates the daily morning briefing from the deterministic ops snapshot (below); zero model tokens for the numbers themselves |

## Permissions

`lib/agent/permissions.ts` is the single policy engine: tool allowlist per role, resource checks inside each tool, request-approver flags persisted in run state. Prompt text never grants authority the engine doesn't.

## Sessions and clarification

- `agent_runs.session_id` (migration 016) groups consecutive runs into a conversation; the in-app builder and the external API both accept an optional `sessionId` validated against the caller.
- Ambiguous goals can be answered with a structured clarification (migration 017) the UI renders as an interactive prompt instead of a wrong guess.
- **Durable session memory** (migration 022): after each terminal run the runtime derives a compact, hard-capped context (recent goals + outcomes, referenced leads with name/category/score, most-recent-focus marker) and stores it per session (`agent_session_context`, user-scoped RLS, service-role writes only). Follow-up runs in the session load it through the same untrusted channel as ephemeral context — "now draft it for the top one" resolves without re-searching, measurably cutting steps and tokens (verified: 7 steps/18.5k tokens → 4 steps/13.5k tokens on the eval scenario). A session-context row is keyed by session + user; another user can never read or overwrite it.

## External clients and scopes

Machine clients (`agent_api_clients`) authenticate the external REST surface (`app/api/external/agent/runs`, `/api/external/briefing`). Secrets are stored hashed and shown once at provisioning. Scopes are an **allowlist enforced at provisioning time**: `agent.run` (general runs) and `briefing.generate` (briefing-only). A briefing client hitting the general run route gets `403 Client lacks the required scope` — scope isolation is covered by a regression test.

## Morning briefing

Deterministic core: numbers come from SQL via `lib/ops/snapshot` — never from a model. Since Briefing v2, one optional model call writes a single prioritization sentence after the numbers are final: it is fed only the verified facts (counts + top leads), validated (one sentence, ≤ 220 chars), and persisted as an auditable `briefing_narrative` system step on the run. Any failure — no key, timeout, malformed output — means **no narrative**, and the deterministic headline stands alone. Lead cards in the briefing carry a review-first "Draft follow-up" link that prefills the Ask X input with the lead's real recommended action; nothing auto-runs and all agent gates apply.

The briefing is a **deterministic assistant artifact**, not model output:

1. `lib/ops/snapshot.ts` computes counts (needs action / follow-ups due / at risk / total / pending approvals) and the top-5 priority leads — the exact same ranking code the dashboard uses.
2. The same math exists as SQL: `compute_daily_briefing(user_id)` (migration 020), a `security definer` function executable only by `service_role`, so a scheduled machine path can generate a per-user, role-scoped briefing without ever reading above its visibility.
3. Parity between the two is tested, and both were verified live to return identical numbers — dashboard, in-app builder and SQL cannot drift.

Delivery is **in-app only**: the agent proactively opens with the briefing (first open of the day, or the ☀ button) in a pinned ☀ Briefing session. Scheduled generation via n8n (`n8n/morning-briefing.json`) is generate-only — no push channels are wired (see [SECURITY](SECURITY.md)).

## Approval gate

Agent-proposed side effects (email drafts, recommended actions) never execute on their own. They end as drafts; a human decision on the lead page (Approve / Edit / Reject, recorded append-only in `lead_action_decisions`, migration 019) is the only path to execution — dispatched email or created task, with honest `sent (via Brevo)` / `sent (simulated)` states and an audit trail. Details: [ARCHITECTURE](ARCHITECTURE.md), [SECURITY](SECURITY.md).

## Known limits

- Durable memory is per-session only ("New chat" starts empty; there is no cross-session recall) — deliberate privacy/simplicity tradeoff.
- Trace capture includes tool inputs/outputs — treat trace access as data access.
- The briefing's top-5 caps at five leads by design; the dashboard carries the full operational view.
