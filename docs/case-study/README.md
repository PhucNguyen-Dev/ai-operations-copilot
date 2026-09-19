# Case study — simulated Vietnamese school

**Evidence status: designed scenario, not a real deployment.** This case study assumes a fictional Vietnamese English-language school with Admissions, Marketing, Academic and Operations teams. No real school, interviews, employees, parents, students, user history or measured business outcomes are represented.

## Scope and reading order

1. [DISCOVERY](DISCOVERY.md): assumed requirements, manual-process hypothesis and acceptance questions.
2. [DEPLOYMENT](DEPLOYMENT.md): planned local services plus a temporary tunnel, with synthetic data and explicit preflight/rollback.
3. [RESULTS](RESULTS.md): unmeasured outcome framework and evidence gaps; populate only after authorized observations.

The repository demonstrates two different automation styles: n8n's fixed admissions/chatbot flow and a Next.js governed agent loop. See [ARCHITECTURE](../ARCHITECTURE.md) and [AGENT_CORE](../AGENT_CORE.md) rather than treating every AI call as an agent.

## What may be claimed now

- Source and documentation exist for the capabilities in [FEATURES](../FEATURES.md).
- Historical experiments and screenshots are retained in the main project; they are not new evidence for this fictional school.
- A repeatable local demonstration and measurement plan is specified here.

## What is not claimed

No production/hosted school deployment, deployed MCP adapter, live Facebook/Zalo account, interviews, pilot participants, delivered training, adoption history, measured ROI or current live/CI verification. Agent email preparation is dry-run only. External REST capability scope is not tenant isolation. Optional Gateway routing is partial, and PromptLedger telemetry is not universal prompt ownership.

The case-study execution is **planned, not implemented**: required services are absent for the exercise, and the available timebox is at most one week. Existing application hardening and local checks are recorded separately in [LOCAL_VERIFICATION](../evidence/LOCAL_VERIFICATION.md); they do not turn this skeleton into a deployed scenario. Follow the [current roadmap](../ROADMAP.md), [security boundaries](../SECURITY.md) and [testing gates](../TESTING.md). Both MCP profiles are implemented with offline verification ([stdio adapter](../../mcp/README.md), [native n8n tools](../WORKFLOW.md#5-mcp-profile-1-native-n8n-admissions-tools)); live acceptance and captures remain pending. The former execution report (removed in the 2026-09-20 docs revision) recorded engineering results only, never customer deployment. There is no factual basis for a `REAL_DEPLOYMENTS` record or production-readiness claim.
