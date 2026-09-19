# Training — designed employee enablement

Designed materials for F-028–F-030, not a delivered program. `/governance/training`, `/governance/workshop` and the staff `/guidelines` portal are application content surfaces, not attendance, certification or adoption evidence. The [simulated school scenario](case-study/README.md) uses synthetic exercises only.

## Shared rule

AI output is assistive material; people own decisions and external communication. That is a training responsibility, not a claim that every automated path has a human approval gate. Classic n8n email has a separate transport branch; agent `prepare_email` records a dry-run draft only. Telegram messages can still be sent externally when a bot is connected.

| Audience | Objectives | Designed exercise | Review criterion |
|---|---|---|---|
| Marketing | Write a clear brief; interpret campaign summaries; verify claims and tone | Draft a fictional course campaign and mark unsupported price/benefit claims | Reviewer checks facts, simulated catalog, brand voice and no sensitive data before any publication |
| Admissions | Understand heuristic scoring and fixed category thresholds; inspect history before follow-up | Compare synthetic HOT/WARM/COLD cases; personalize a draft without sending | Counselor explains an uncertain classification and records the need for human escalation |
| Academic | Use plans/quizzes as preparation drafts, not authorities | Generate a fictional lesson and inspect every answer/explanation | Teacher corrects weak content, verifies facts and adapts difficulty without student personal data |
| Operations | Reconcile reports with source aggregates; distinguish errors from successful runs | Generate a synthetic-period report and verify two metrics | Reviewer identifies unsupported conclusions and traces figures to source data |
| Operations/Admin | Review approvals and integration access boundaries | Inspect a frozen dry-run draft and an external client's allowed capabilities | Reviewer distinguishes approval from delivery and tool scope from tenant isolation |

A simple marketing brief template: `Campaign: [fictional name]. Audience: [group]. Platform: [channel]. Tone: [style]. Objective: [action].` Do not substitute real student data into training prompts.

## Ask X / agent literacy

Learners should distinguish the fixed n8n pipeline from the agent's model-selected tool sequence. Inspect run status, authorized/denied tool calls, source excerpts and errors rather than accepting a confident final sentence. A citation is a review aid, not a guarantee; retrieved instructions cannot grant permissions.

For an approval exercise, first apply and validate migration 015 in a disposable project. Use an independent approver, review exact arguments/requester scope, then use Ask X's manual **Refresh run trace**. Same-decision retries cannot change the decision or replay claimed work; `RECONCILIATION_REQUIRED` means stop for operator review. `prepare_email` remains dry-run. Implemented controls and remaining live gates are in [AGENT_CORE](AGENT_CORE.md) and [ROADMAP](ROADMAP.md).

## Designed workshop — 90 minutes

| Time | Planned segment |
|---|---|
| 0–10 minutes | Scope, synthetic data and human responsibility |
| 10–25 minutes | Prompting basics and unsupported-claim detection |
| 25–45 minutes | Department-specific exercises |
| 45–65 minutes | Facilitator-led local automation/agent demonstration, only if preflight passes |
| 65–80 minutes | Hands-on review of a synthetic artifact and trace |
| 80–90 minutes | Questions, escalation and operating limits |

If local services or checks fail, use clearly labeled historical screenshots instead of claiming a live demonstration. No participants, interviews, attendance, learning gains or workshop delivery are asserted.

## SOP navigation and proposed assessment

- System operation and failed-run triage: [RUNBOOK](RUNBOOK.md), [WORKFLOW](WORKFLOW.md), [TELEGRAM-CHATBOT](TELEGRAM-CHATBOT.md).
- Data handling and external access: [SECURITY](SECURITY.md), [EXTERNAL_API](EXTERNAL_API.md).
- Prompt sources, output contracts and review: [AI_DESIGN](AI_DESIGN.md).
- Experiment versus adoption decision: [AI_TOOL_LAB](AI_TOOL_LAB.md), [AI_TOOL_EVALUATION](AI_TOOL_EVALUATION.md).

Proposed assessment: each learner identifies one unsupported claim, one data-handling concern and one appropriate escalation in a synthetic artifact. Record an assessment only if it is actually delivered; do not fabricate scores or completion records. Registry-driven training gates and automatic access changes are future work, not implemented enforcement inferred from static training pages.
