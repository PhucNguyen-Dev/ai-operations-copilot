# PHASE 9 — AGENTIC CORE UPGRADE

## Goal

Upgrade **AI Operations Copilot** from a fixed workflow-automation platform into a **real-world, governed agentic enterprise product-layer engine**.

The target execution model is:

**Business Goal → Observe State → Choose Authorized Tool → Execute → Observe Result → Update State → Re-plan → Verify → Complete / Escalate**

The agent must be able to dynamically decide what to do next instead of merely filling predetermined LLM steps inside a fixed A→B→C workflow.

The platform must remain enterprise-governed:

> **The LLM decides what should happen next. The platform decides whether that action is allowed.**

Do not weaken deterministic business rules, Supabase RLS, RBAC, validation, auditability, approval controls, or failure handling just to make the system "more agentic."

---

## Non-Goals

Do NOT:

- wholesale-rewrite the existing application
- replace Supabase/PostgreSQL
- remove or weaken existing RBAC/RLS
- rewrite the five existing department AI tools unnecessarily
- turn the system into an uncontrolled multi-agent swarm
- give agents unrestricted employee/database access
- store or expose chain-of-thought
- introduce distributed infrastructure merely for architectural theater
- require Docker/Redis/Kubernetes if a lightweight Supabase-backed implementation is sufficient
- make Facebook/Zalo integration a prerequisite for proving the agentic core
- replace every n8n workflow with an agent

The existing AI Operations Copilot remains the business application and reference implementation for the new Agentic Core.

---

# 9.1 — Central Tool Registry

## Objective

Create one authoritative registry describing every capability an agent can invoke.

Existing CRM, notification, email, task, reporting, RAG, and department capabilities should be exposed through registered tools rather than arbitrary agent-side code.

## Tool metadata

Each tool should define, at minimum:

- `name`
- `version`
- `description`
- `inputSchema`
- `outputSchema`
- `permissions`
- `riskLevel`
- `approvalRequired`
- `timeoutMs`
- `retryPolicy`
- `enabled`
- `idempotencyPolicy`

Recommended risk levels:

- `read`
- `write`
- `external_side_effect`
- `destructive`

Examples:

- `get_lead`
- `search_leads`
- `create_task`
- `notify_counselor`
- `send_email`
- `wait_and_recheck`
- `escalate_to_human`
- `generate_digest`
- `search_knowledge`

## Requirements

- Central registration instead of scattered tool definitions.
- Runtime validates tool arguments against the registered schema.
- Runtime validates tool output before returning it to the agent.
- Tool version is recorded in execution traces.
- Disabled tools cannot execute.
- Tool permissions are evaluated before execution.
- High-risk tools cannot bypass approval requirements.

## Acceptance Criteria

- Every agent-accessible capability is represented by a registry entry.
- Every entry has input/output schema and permission/risk metadata.
- Invalid tool arguments fail safely.
- Tool execution is auditable.
- Unit tests cover registry validation and tool execution boundaries.

---

# 9.2 — Agent Runtime / Orchestrator

## Objective

Implement a genuine agent loop.

Do not simply replace a fixed n8n chain with:

`LLM → Tool A → LLM → Tool B → ...`

The runtime must allow the model to choose among authorized tools based on current state and results.

## Required loop

1. Receive business goal.
2. Load agent state.
3. Observe relevant operational state.
4. Present authorized tools/capabilities to the model.
5. Model selects the next action/tool.
6. Platform validates permission, policy, schema, limits, and approval requirements.
7. Execute tool if permitted.
8. Record structured result.
9. Update persistent state.
10. Re-evaluate/re-plan.
11. Continue until:
   - goal is completed
   - verification fails and recovery is possible
   - a human is required
   - a safety/budget/step limit is reached
   - execution fails irrecoverably.

## Important boundary

The agent chooses **intent and next action**.

The platform controls:

- authentication
- authorization
- tool allowlist
- schemas
- policy
- approvals
- rate/step/time/cost limits
- retries
- side-effect safety
- audit
- kill switch

## Acceptance Criteria

At least one business scenario must demonstrate:

- multiple possible tools
- dynamic tool selection
- at least 3 sequential actions
- state changes between actions
- re-planning based on tool output
- verification before completion
- escalation when necessary

---

# 9.3 — Persistent Agent Run State

## Objective

Introduce persistent state for agent execution.

Do not confuse this with cache or rate-limiter storage.

Each agent run needs durable state representing the execution itself.

## Minimum state

An `agent_runs` / equivalent structure should track:

- `runId`
- `agentId`
- `goal`
- `status`
- `currentState`
- `stepCount`
- `startedAt`
- `updatedAt`
- `completedAt`
- `finalOutcome`
- `error`
- `humanApprovalStatus`

Related records should represent:

- planned/attempted steps
- tool calls
- tool results
- approvals
- failures
- state transitions
- final verification

## Requirements

- Resume-safe where practical.
- No important agent state exists only in process memory.
- State survives a process restart.
- State is scoped to the correct user/agent/resource permissions.
- Sensitive data is not unnecessarily duplicated.

## Acceptance Criteria

A run can be inspected after completion and reconstructed from persistent state without relying on server memory.

---

# 9.4 — Agent Execution Trace / Observability

## Objective

Provide a structured trace of agent behavior without storing chain-of-thought.

Trace the execution facts, not hidden reasoning.

## Record

For each meaningful step:

- goal
- run ID
- selected tool
- tool version
- actor/agent identity
- permission decision
- approval decision
- validated arguments or safe argument summary
- tool result summary
- state transition
- next action
- retry/recovery event
- verification result
- latency
- token/cost metadata where available
- error classification
- final outcome

Never store or expose private chain-of-thought.

## UI

Create an agent run viewer showing:

`Goal → Step → Tool → Result → State → Next Action → Approval → Outcome`

This should be understandable by an engineer, reviewer, or hiring manager.

## Acceptance Criteria

A reviewer can answer:

- What goal was attempted?
- Which tools were selected?
- Why was execution allowed or blocked?
- Which actions required approval?
- What failed?
- How did the agent recover?
- Why did the run finish or escalate?

without access to hidden model reasoning.

---

# 9.5 — Permission-Aware Agent and Tool Execution

## Objective

Extend existing employee RBAC/RLS into agent-level capability control.

An agent must NOT automatically inherit unrestricted access merely because the employee invoking it has access.

## Model

Evaluate:

**User Identity + Agent Identity + Tool + Resource + Action + Policy**

before execution.

Tool definitions should include allowed roles/scopes/capabilities.

Examples:

- admissions agent can read/update admissions leads
- marketing agent can access campaign/content tools
- teacher agent can access lesson/quiz tools
- reporting agent can read authorized aggregate data
- external agent can only access explicitly exposed capabilities

## Requirements

- Server-side authorization.
- Tool-level permission checks.
- Resource-level restrictions where necessary.
- Existing Supabase RLS remains authoritative for database access.
- Never trust client-side role information.
- Never allow the model to self-grant permissions.

## Acceptance Criteria

Tests prove that:

- authorized tool calls succeed
- unauthorized calls are rejected
- unauthorized resources are rejected
- agent cannot bypass RLS
- external callers receive only explicitly scoped capabilities.

---

# 9.6 — Guardrail, Policy, Approval and Kill-Switch Layer

## Objective

Make agent autonomy bounded and governable.

## Guardrails

Implement:

- maximum steps per run
- execution timeout
- token/cost budget
- tool allowlist
- per-agent rate limits
- input validation
- output validation
- retry limits
- idempotency for side-effecting tools
- destructive-action protection
- prompt-injection defenses for retrieved/untrusted content
- kill switch / disable agent capability
- safe failure and escalation

## Approval protocol

Sensitive actions should support:

`proposed → pending approval → approved/rejected → execute`

Examples:

- real external email
- destructive changes
- refunds/financial actions
- high-impact external communication

Dry-run mode should remain the default where appropriate.

## Acceptance Criteria

- Agent cannot exceed configured step/time/cost limits.
- High-risk tools cannot execute without required approval.
- Kill switch blocks new execution.
- Invalid or unsafe tool calls are rejected.
- Prompt-injected retrieved content cannot redefine system permissions or tool policy.
- All approval decisions are auditable.

---

# 9.7 — Enterprise Knowledge / RAG Layer

## Objective

Add a governed enterprise knowledge layer so agents can reason over internal operational knowledge rather than only structured CRM state.

## Knowledge sources

Start with synthetic/internal material such as:

- SOPs
- AI usage guidelines
- course information
- pricing/FAQ data
- admissions policies
- operational procedures
- employee training material
- department documentation

## Architecture

Implement:

**Documents → ingestion/chunking → embeddings → vector storage → metadata → retrieval tool → permission filtering → cited context**

The RAG system should be exposed to agents as a registered tool, e.g.:

`search_knowledge(query, scope, filters)`

## Requirements

- metadata for department/document/type/access scope
- permission-aware retrieval
- source references/citations
- retrieval result validation
- protection against prompt injection in documents
- clear separation between trusted instructions and retrieved content
- no claim of factual certainty when evidence is missing

## Acceptance Criteria

A real agent task can:

1. identify that knowledge is needed
2. call the RAG tool
3. retrieve relevant authorized documents
4. use the retrieved evidence
5. cite the source in its user-facing result.

---

# 9.8 — Agent Behavior Evaluation

## Objective

Evaluate the agent as a system, not just whether the LLM produced a plausible sentence.

## Evaluation dimensions

Create scenario-based evaluation covering:

- correct tool selection
- correct tool arguments
- task completion
- unnecessary tool calls
- invalid tool calls
- permission violations
- approval behavior
- stopping behavior
- recovery from tool failure
- escalation behavior
- RAG retrieval quality
- citation correctness
- hallucinated actions
- policy compliance
- latency
- token/cost efficiency

## Test scenarios

Include normal and adversarial cases:

- straightforward lead
- ambiguous lead
- missing information
- failed tool
- duplicate/contradictory state
- unauthorized request
- high-risk action requiring approval
- prompt injection inside retrieved content
- agent should stop rather than continue
- agent should escalate to human

## Acceptance Criteria

- Evaluation cases are versioned.
- Results are machine-readable.
- Regression tests can run in CI or on a scheduled basis.
- Important behavior regressions are detectable.
- Scores are based on observable outcomes, not subjective chain-of-thought inspection.

---

# 9.9 — Employee "Ask X" Agent Interface

## Objective

Expose the Agent Runtime through a role-scoped internal conversational interface.

Examples:

- "Show me my hottest leads from this week."
- "Which leads need follow-up today?"
- "Summarize my department's automation failures."
- "Find the SOP for handling this type of inquiry."
- "Create follow-up tasks for these leads."

## Initial read-oriented tools

Implement or expose:

- `get_my_leads`
- `get_lead`
- `get_my_tasks`
- `get_automation_runs`
- `generate_digest`
- `search_knowledge`

Add write tools only after the permission and approval layer is proven.

## Requirements

- role-scoped
- authenticated
- auditable
- tool calls visible in run trace
- no direct database access from the chat UI
- clear indication when human approval is required

## Acceptance Criteria

An employee can ask a natural-language operational question and receive an answer generated through the same governed agent runtime and registered tools.

---

# 9.10 — External API / MCP Product Surface

## Objective

Turn the Agentic Core into an actual reusable product-layer capability rather than an agent trapped inside one UI.

Expose a generic authenticated front door for approved external applications/agents.

Possible interfaces:

- REST API
- MCP server
- both if implementation cost is reasonable

## Architecture

**External App/Agent → Auth → Capability Scope → Agent Runtime → Tool Registry**

## Requirements

- authenticated callers
- explicit scopes/capabilities
- service identity
- rate limits
- request validation
- audit trail
- tool allowlist
- tenant/resource boundaries where applicable
- no unrestricted database exposure
- no password-sharing with external agents

Future architecture may support delegated scoped authorization / OAuth-style acting-on-behalf-of tokens.

Do not implement full delegated identity unless required for the current product milestone.

## Acceptance Criteria

At least one external client can invoke an approved agent capability through a documented authenticated interface and receive a traceable result.

---

# 9.11 — Real Lead Trigger

## Objective

Move the lead pipeline closer to real production conditions by supporting a real external lead source.

Candidates:

- Facebook Lead Ads
- Zalo
- another realistic webhook source

## Requirements

- webhook authentication/signature validation
- payload normalization
- source metadata
- idempotency
- duplicate handling strategy
- existing lead validation
- existing agent workflow
- failure logging

This is an integration-realism milestone, not the core proof of agentic architecture.

## Acceptance Criteria

A real external lead event can enter the system and eventually be processed by the governed agent runtime without bypassing validation, authorization, logging, or safety controls.

---

# 9.12 — Multi-Agent Handoff

## Objective

Demonstrate controlled agent-to-agent delegation only after the single-agent runtime is reliable.

Example:

**Receptionist / Admissions Agent → Reporting Agent**

The first agent should invoke a second specialized agent through a registered, scoped capability.

## Requirements

- explicit agent registry
- scoped permissions
- clear handoff contract
- input/output schema
- run correlation
- traceable parent/child runs
- bounded delegation
- no uncontrolled recursive delegation

## Acceptance Criteria

At least one real business scenario demonstrates:

`Agent A → scoped handoff → Agent B → result → Agent A → final outcome`

The complete chain is visible in execution traces.

---

# 9.13 — Persistent Infrastructure Hardening

## Objective

Remove infrastructure assumptions that break when the application has more than one runtime instance.

This is secondary to the core agentic architecture.

## Move persistent/shared concerns out of process memory

Examples:

- AI response cache
- rate limiter state
- shared locks if required

Use lightweight Supabase/PostgreSQL persistence where sufficient.

Use Redis only if there is a concrete requirement that PostgreSQL cannot reasonably satisfy.

## Acceptance Criteria

The system does not rely on one process's memory for correctness of:

- rate limiting
- critical cache behavior
- agent execution state
- approvals
- audit state

Agent state and approvals must remain durable regardless of process restart.

---

# IMPLEMENTATION ORDER

Implement in this order unless repository constraints justify a small dependency adjustment:

1. Tool Registry
2. Persistent Agent Run State
3. Agent Execution Trace
4. Permission-Aware Tool Execution
5. Guardrail / Policy / Approval / Kill Switch
6. Agent Runtime / Orchestrator
7. Enterprise RAG / Knowledge Tool
8. Agent Evaluation
9. Employee "Ask X" Agent Interface
10. External API / MCP Surface
11. Real External Lead Trigger
12. Multi-Agent Handoff
13. Persistent Infrastructure Hardening

Do not start with multi-agent orchestration.

Do not start with Facebook/Zalo integration.

Do not start with infrastructure complexity.

The first proof must be one excellent, bounded, tool-using agent.

## Milestone slicing (working plan, agreed 2026-09-13)

The 13 items above are built as milestones, not strictly sequentially — items 1–6 are interlocking and cannot be acceptance-tested in isolation:

- **A** = items 9.1–9.6 built together around the Admissions Follow-Up reference scenario (registry + run state + trace + permissions + guardrails/approval/kill switch + runtime loop + first tools + REST front door).
- **B** = 9.7 RAG upgrade behind the existing `search_knowledge` contract.
- **C** = 9.8 evaluation — scripted-fake-model unit evals in CI; real-Gemini scenarios run on a schedule, not per-PR (cost + flakiness).
- **D** = 9.9 chat UI. **E** = 9.10 REST first, MCP as a thin adapter later. **F** = 9.11 real trigger. **G** = 9.12 handoff. **H** = 9.13 hardening.

Runtime decisions already made: runtime lives inside the Next.js app (`lib/agent/*`); agent-table writes use the service-role client (user-tamper-proof audit trail, n8n trust model) while reads are RLS-scoped user queries; resumed runs re-evaluate permissions under the original requester's persisted `user_role`, never the approver's; hand-rolled pure validators per repo convention (no Zod). Status and runbook: `ROADMAP.md` → Phase 9 section.

---

# REFERENCE AGENTIC BUSINESS SCENARIO

Build at least one meaningful end-to-end scenario such as:

## Admissions Follow-Up Agent

Goal:

> Review a lead and take the appropriate next operational action.

Possible behavior:

1. Load lead.
2. Inspect lead analysis/history.
3. Decide whether more information is required.
4. Search authorized SOP/knowledge if policy context is needed.
5. Choose among:
   - update lead
   - create follow-up task
   - notify counselor
   - prepare/send email
   - wait and re-check
   - escalate to human
6. Execute only authorized actions.
7. Observe results.
8. Re-plan if state changed.
9. Verify the intended outcome.
10. Finish or escalate.

The exact tool sequence must NOT be hard-coded.

The model may choose different valid paths based on the observed state.

Deterministic constraints remain outside the model.

---

# ARCHITECTURAL TARGET

```text
                    External Apps / External Agents
                                |
                         REST API / MCP
                                |
                     Authentication + Scopes
                                |
                         Agent Runtime
                                |
                  +-------------+-------------+
                  |                           |
          Persistent Agent State        Execution Trace
                  |                           |
                  +-------------+-------------+
                                |
                         Tool Registry
                                |
          +---------------------+---------------------+
          |                     |                     |
       CRM Tools          RAG / Knowledge       Department Tools
          |                     |                     |
          +---------------------+---------------------+
                                |
                   Permission / Policy Engine
                                |
                      Guardrail Engine
                                |
                       Human Approval
                                |
                     Supabase / External APIs
                                |
                         AI Gateway
                                |
                         LLM Provider(s)
                                |
                  PromptLedger / AI Behavior
                         Control Plane
```

The Agentic Core should be designed as a reusable platform capability.

**AI Operations Copilot is the first business application/reference implementation of that core.**

---

# EXISTING SYSTEM PRESERVATION

The Phase 9 implementation must preserve and reuse:

- Next.js application
- TypeScript
- Supabase/PostgreSQL
- Supabase Auth
- existing RBAC
- existing RLS
- n8n workflows where deterministic orchestration remains appropriate
- Gemini integration
- Gmail integration
- automation logs
- error handling
- retry/backoff
- AI response validation
- existing five department AI tools
- governance portal
- AI Tool Lab
- AI Tool Evaluation
- employee AI training
- internal AI workshop
- SOP/guidelines content
- existing Vitest tests
- existing Playwright/E2E coverage
- current dashboards and role-scoped UI

Refactor only where necessary to connect them to the new Agentic Core.

---

# DESIGN PRINCIPLES

## 1. Agentic does not mean uncontrolled

Autonomy must be bounded by policy.

## 2. LLM decides; platform enforces

The model may propose actions.

Only the platform can authorize and execute them.

## 3. Deterministic controls stay deterministic

Do not move security, permission, validation, approval, or hard business invariants into prompts.

## 4. Tools are first-class platform capabilities

Do not bury important business actions inside agent prompts.

## 5. State is durable

An agent run is a persistent business process, not an ephemeral chat completion.

## 6. Observability is part of the product

A reviewer should be able to understand what happened without seeing chain-of-thought.

## 7. Knowledge is governed

RAG is not simply "put documents in a vector DB."

Retrieval must respect permissions, provenance, and prompt-injection boundaries.

## 8. Evaluate behavior, not prose

The key question is whether the agent selected and executed the correct actions safely.

## 9. One strong agent beats fake multi-agent complexity

Prove the runtime with one meaningful business agent before delegation.

## 10. Product layer before infrastructure theater

A useful external API/MCP surface and governed execution model are more valuable than unnecessary distributed infrastructure.

---

# DEFINITION OF DONE

Phase 9 is considered complete only when the following are demonstrably true:

1. A real agent loop exists.
2. The agent dynamically selects tools.
3. Tools are centrally registered.
4. Tool input/output schemas are validated.
5. Tools contain permission and risk metadata.
6. Agent runs have persistent state.
7. Agent execution produces structured traces.
8. Tool execution is permission-aware.
9. High-risk actions can require human approval.
10. A kill switch exists.
11. Step/time/token-cost/retry limits exist.
12. RAG is available as a governed tool.
13. RAG retrieval respects authorization and provides source citations.
14. Agent behavior has scenario-based evaluation.
15. Agent failures can recover or escalate safely.
16. Employees can interact with the agent through a role-scoped interface.
17. At least one authenticated external API/MCP capability exists.
18. At least one genuine multi-step business objective is solved dynamically.
19. Existing RBAC/RLS remain intact.
20. Existing department tools remain usable.
21. Existing application behavior and E2E coverage remain intact.
22. No chain-of-thought is stored or exposed.

---

# PORTFOLIO POSITIONING

After Phase 9, position the system as:

> **A governed enterprise AI execution platform where business agents can reason over operational state, dynamically use authorized tools, retrieve enterprise knowledge, execute multi-step tasks, request human approval for sensitive actions, recover from failures, evaluate behavior, and expose capabilities through internal and external interfaces.**

The AI Operations Copilot should be described as the first concrete business implementation of this platform.

Avoid claiming:

- fully autonomous enterprise intelligence
- unrestricted autonomous agents
- production-scale distributed infrastructure
- general-purpose AGI
- autonomous decision-making without governance

The strongest portfolio story is:

> **Enterprise AI automation foundation + governed agentic execution layer.**

This demonstrates the transition from:

**workflow automation → tool-using agents → governed agent runtime → reusable enterprise AI execution platform.**
