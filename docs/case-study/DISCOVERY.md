# Discovery — assumed requirements

**Simulation only.** The following requirements are authored assumptions for a fictional Vietnamese English-language school, not conclusions from interviews, observation or customer records. No organization name or invented testimonial is used.

## Assumed operating context

The school offers language/exam-preparation courses and receives inquiries in Vietnamese and English. A counselor follows up on interest; Marketing drafts campaigns; teachers prepare materials; Operations reviews service health. The assumed manual process is inbox review → qualification → assignment → draft response → follow-up tracking. Its actual volume, response times, conversion and staffing costs are unknown.

## Assumed requirements and proposed acceptance

| Assumed need | Proposed response | Evidence required before acceptance |
|---|---|---|
| Consistent inquiry handling | Signed intake, validation and fixed n8n qualification workflow | Synthetic valid/invalid cases and reconciliation of CRM, dry-run mail, task and notification |
| Vietnamese/English FAQ and intake | Telegram chatbot with simulated course facts | Approved fictional catalog, language examples, unknown-policy handling and opt-out behavior |
| Counselors see appropriate leads | Session/RLS dashboards and scoped agent tools | Final role/resource test matrix, including approval resume |
| Flexible follow-up assistance | Ask X agent with registered tools and policy checks | Trace of authorized/denied actions and human review of the outcome |
| Draft content/materials faster | Five department AI tools | Reviewer checks correctness and effort on comparable synthetic tasks; time savings not assumed |
| Human control of sensitive actions | Dry-run email, explicit approval demonstration and kill switch | Primary approval/claim fixes validated; no transport inferred from approval |
| Explain system behavior | Separate workflow and agent traces | Reconciliation showing what happened, not model reasoning or unsupported completion claims |
| Responsible use | Designed training and SOPs | Delivery and assessment evidence only if later performed |

## Assumptions to validate before any real pilot

- Which fields are necessary, who may view them, and whether parent/student consent and retention requirements permit collection.
- Which catalog, price and policy source is authoritative, who updates it, and when the bot must defer to a counselor.
- Whether automated Telegram nudges are appropriate and how opt-out state survives failures/concurrent runs.
- Which requests require independent approval; how requester identity and resource scope are restored after suspension.
- Whether an integration is authorized for broad CRM reads. External client capabilities do not provide separate school/tenant datasets.
- Actual inquiry/task volumes, manual timing, error rates and evaluation rubrics. None have been measured for this scenario.

## Scope decision

Planned execution is limited to at most one week; required services are currently absent for the exercise. Use synthetic leads and a local app/n8n instance only after the [locked gates](../ROADMAP.md) pass; a temporary tunnel is optional for an authorized test bot. No scenario deployment is implemented. Both MCP profiles exist with offline verification, but live acceptance and captures remain pending; their presence does not establish school deployment. Do not connect real student systems, ad accounts, email recipients or production school data.

The design chooses deterministic n8n intake for repeatable steps and a separately governed agent for flexible staff goals. This is a design rationale, not evidence that an organization selected or adopted it. Source capabilities and limitations are linked from [the case-study overview](README.md); planned execution is in [DEPLOYMENT](DEPLOYMENT.md).
