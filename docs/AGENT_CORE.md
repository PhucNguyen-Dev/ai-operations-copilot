# Agent core

How the Ask X agent works: runtime, tools, permissions, sessions and the briefing path.

## Runtime

`lib/agent/runtime.ts` executes every run inside hard bounds — max steps, wall-clock time and token budget — with a kill switch and per-tool disable checks honored before each tool call. The clock is **injected**, so tests and the date-bounds guard share one time source. Every step is traced via `lib/runtrace.ts` (tool name, input/output summaries, duration) — this trace is what the chat UI renders as step summaries and what the rich answer cards are derived from. No live step polling: the run flow is request → bounded execution → persisted trace → rendered.

**Prompt ownership (Bundle C).** Agent system prompts are registry-owned: the committed `prompts/<agent-id>.json` files are the single source (the in-code constants mirror them), and at run start the runtime resolves the live version from PromptLedger when configured — failing **closed** on registry failure (an agent never runs on a silently stale prompt) and serving the committed fallback when unconfigured. The resolved identity (`prompt_source`, `prompt_version`) is persisted on the run row and flows into the PromptLedger run traces, so "which prompt version produced this run" is answerable end-to-end.

**Streaming (Bundle B).** `POST /api/agent/runs/stream` streams the same governed run as SSE runtime events (`run_started`, `turn_delta`, `tool_executed`, `awaiting_approval`, `run_completed`/`run_failed`) plus a closing `final` event carrying the identical JSON body of the non-streaming route. Governance is byte-identical: same auth, role gate, rate limit, session checks, permission engine and persistence; the events are advisory progress only, and the durable trace stays the single source of truth. Model turns stream through `streamGenerateContent` (text deltas only; function-call turns emit none) with a non-streamed retry on transient failure so discarded-response deltas are never re-emitted. The client's reliability ladder is stream → poll the durable run (never re-POST a possibly-running goal) → one fallback POST to the JSON route. The loop still bypasses the AI Gateway (JSON-mode only) — the contract to close that is spec'd in [GATEWAY_AGENT_TURN_SPEC](GATEWAY_AGENT_TURN_SPEC.md).

**Cancellation (migration 024).** A run can be stopped — by the employee who started it, or by Operations/Admin — and the stop is enforced by the platform at **every boundary that could still cause a side effect**: before each model turn, before each tool execution, and before an approval resume. Cancellation is a durable flag on the run (`cancel_requested_at`, `cancelled_by`), never a client-side gesture: the request is written by `request_agent_run_cancel`, which is the same function the runtime then reads — so a stop still lands if the request arrives on a different server instance than the loop, and a crashed process leaves evidence rather than a silent no-op. A **suspended** run has no loop to notice a flag, so the same call ends it and **withdraws its pending approval** (as `rejected`, with the reason in `decision_note`) in one transaction. That withdrawal plus `claim_agent_approval`'s requirement that a run still be `awaiting_approval` is what makes "cancel, then approve" structurally impossible — `resumeAgentRun` also refuses a cancelled run outright rather than trusting UI state. The in-flight model call is aborted through an `AbortSignal` for immediate effect, but **the abort is a latency optimisation, not the mechanism**: correctness rides on the flag. Two honest notes: a turn already executing a tool is not interruptible mid-call (it stays bounded by the tool timeout), and the terminal system step is recorded as `skipped`, not `failed` — nothing failed, the platform refused to continue, and the reason is in the step's `error` text.

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
- Streaming covers **turn-level** text and step events; token-level deltas of the final message are a follow-up (the perceived-latency win is already delivered).
- Agent prompts resolve from PromptLedger/committed fallbacks, but promoting a new live version is still a manual registry step (no UI pipeline for agent prompts yet).
- Cancellation is cooperative at the tool boundary: a tool already executing runs to completion (bounded by its own timeout). Stopping mid-`prepare_email` is not possible, which is the honest trade for not interrupting a side effect halfway.
- A stop request on a run whose driving process is already dead stays at `running` with `cancel_requested_at` set — an operator reconciliation item, not a completed stop. The kill switch and the per-tool enable flags remain SQL-only (no admin UI yet).
