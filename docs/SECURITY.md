# Security boundaries and limitations

Source-based review of the current working tree for a synthetic-data local demonstration — **not security certification**. It records what the code enforces, what it deliberately does not, and what remains unverified in a live deployment.

## Trust boundaries

| Boundary | Mechanism | Limitation / notes |
|---|---|---|
| Employee session | Supabase Auth, server role gates, RLS client (`lib/auth-server.ts`) | UI visibility is not authorization; every API route re-checks the session |
| Agent tool execution | Allowlist + role/policy engine (`lib/agent/permissions.ts`), resource checks inside each tool | Prompt instructions never replace server authorization |
| Approval decisions | `lead_action_decisions` (migration 019): append-only, user-scoped RLS, one active decision per (lead, target); writes only through `app/api/leads/[id]/decisions/route.ts` | The route verifies the lead is visible to the caller before recording any decision |
| Agent approvals (runs) | Durable claim + service-role requester RPC, decision re-validated against `auth.users` role at resume | At-most-once claim entry, not exactly-once effects; interrupted executions can require reconciliation |
| Email dispatch | `lib/email/dispatch.ts`: Brevo HTTP API when `BREVO_API_KEY` + `BREVO_FROM_EMAIL` are configured, otherwise an honestly-labeled **simulated** dispatch. Recipient = the address already on the draft; no arbitrary-address sends | Credentials are server-side only; failures are typed (`failed` + `dispatch_error`) and retryable, never silently swallowed |
| Task creation from approvals | Admin client writes with the approver as `created_by`, the lead's counselor as assignee — mirrors the n8n pipeline trust model (`tasks` has no authenticated insert policy by design) | Attribution is recorded, not assumed |
| External agent REST | Hashed client secret, enabled flag, **scopes allowlist** (`agent.run`, `briefing.generate` — provisioning rejects anything else), agent allowlist, per-client run-history filter | Reads use the service client; there is **no tenant-level CRM isolation** for external callers |
| Briefing compute door | `compute_daily_briefing(user_id)` SQL function (migration 020): `security definer`, execute revoked from public/anon/authenticated, granted only to `service_role`; caller identity is a machine client with `briefing.generate` scope | The target user id comes from the provisioning config, so briefings are role-scoped exactly like in-app reads |
| Lead webhook | Shared-secret header + HMAC envelope/replay window | Trusted integrator, not native Facebook/Zalo auth |
| n8n pipeline | Signed internal intake, server credentials, no custom-role JWT minting | Launcher settings are local-dev convenience, not a hardened public config |
| Knowledge retrieval | Role/department filtering; untrusted document text is data, never instructions | Excerpts stay untrusted input |
| Rate limit | Postgres RPC with memory fallback | RPC failure currently fails open (`lib/rate-limit.ts`) — not a hard abuse ceiling |

## Notification channels: no push by design

Internal briefings and agent notifications are **in-app only**. The parent-facing Telegram bot (`@enrollauto_bot`) handles customer conversations and nothing else — no ops data is ever pushed through it, so the parent persona cannot leak internal state. Automated delivery to arbitrary channels (SMS, Instagram, TikTok DMs, YouTube) was evaluated and rejected: every free DM platform requires recipient opt-in by design, and social inboxes mix personas. If delivery outside the app is ever needed, the pattern is a **dedicated ops bot + per-recipient explicit opt-in + role-scoped per-user briefing generation** — the scaffold exists (`n8n/morning-briefing.json` is generate-only; push nodes are documented, not wired).

## Secrets

- All keys (`SUPABASE_*`, `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `BREVO_API_KEY`, external client secrets) are server-side env vars. `.env.example` documents names, never values.
- External client secrets are shown once at provisioning and stored **hashed** (`agent_api_clients.secret_hash`); a leaked secret is rotated by disabling the client and provisioning a new one.
- Never paste secret values, cookies or env dumps into chat, screenshots, issues or docs. Brevo API keys grant send access — treat them like mail credentials.
- Verify the Brevo sender address before real sends; unverified senders are rejected by the provider.

## Personal data, prompts and traces

Use synthetic leads, metrics and course data. Names, phones, chat history, goals, drafts and email addresses may become personal data in a real deployment; this repository does not establish consent/retention for real students or minors.

Run traces (`lib/runtrace.ts`) capture full tool inputs/outputs; pipeline payloads and generated emails may contain content. Do not describe logging as metadata-only. Before real-data use: define retention/deletion, redaction, access review, vendor DPA, incident ownership. No regulatory compliance or enterprise isolation is claimed.

## Stop and recover

Use the agent kill switch and tool-disable controls in [RUNBOOK](RUNBOOK.md). They affect subsequent checks, not an in-flight provider request. To contain a suspected compromise: disable the affected external client, stop the bot/tunnel, rotate credentials privately, then reconcile pending approvals and accepted-but-untriaged leads before restarting. Validation commands: [TESTING](TESTING.md).
