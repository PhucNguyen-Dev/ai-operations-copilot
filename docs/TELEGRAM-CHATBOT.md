# Telegram parent chatbot — local runbook

A simulated school lead-capture demonstration implemented in n8n, not the Next.js agent runtime. Current live bot operation is **unverified**; retained screenshots/videos describe historical demonstrations. The target is local n8n plus a temporary tunnel, not a production school service.

## Behavior and data

`n8n/telegram-parent-chatbot.json:35` prepares per-chat workflow static data, short conversation history, language/activity state and a simulated course/pricing knowledge base. The workflow either answers/collects information or submits to the classic signed admissions pipeline. It does not perform agent-tool delegation or governed vector retrieval.

- `/start`, `/help` and `/stop` take the quick-command path without an AI turn.
- Enrollment leads carry Telegram source information. The workflow synthesizes an email such as `<phone>.tg@lead.local` to meet the classic pipeline contract; that address is not a verified recipient and must not be used for live mail.
- Follow-ups use CRM `telegram_stopped`, `nudges_sent` and `last_nudge_at` fields from migration 009. The intended sequence is a first nudge around 24 hours and a final one around five days, with active-chat skipping and opt-out handling.
- Counter updates and message delivery are not atomic; overlapping runs can duplicate touches. Workflow static chat state is not a multi-instance conversation service.
- Telegram replies/nudges are real external sends when a bot is connected. `GMAIL_DRY_RUN` controls email only, not Telegram.

Treat tuition, campuses, hours and course names as synthetic scenario facts. No real parent's history, consent record or school policy is asserted. [WORKFLOW](WORKFLOW.md) owns the flow diagrams.

## Two local modes

| Command | Intended use |
|---|---|
| `npm run n8n` | Local editor/classic admissions at `http://localhost:5678`; no public Telegram ingress unless separately configured |
| `npm run bot` | Launcher-managed tunnel, n8n, webhook registration and watchdog checks |
| `npm run kill-stack` | Broad emergency cleanup; inspect targets first because unrelated local processes may be affected |

`npm run bot` uses the launcher in `scripts/start-bot.mjs:1`. Its default tunnel approach is cloudflared, with localtunnel support. Startup checks and watchdog messages report attempts/current observations; they do not establish durable availability, guaranteed delivery or successful current verification by this docs task.

Use the local editor URL, not the random public tunnel URL. A tunnel may expose the whole origin service; review access controls before starting it. Local insecure-cookie/environment-access settings are not a hardened public configuration. See [SECURITY](SECURITY.md).

## Setup checklist — operator actions, not executed here

1. Prepare the disposable project, ordered migrations and synthetic data using [RUNBOOK](RUNBOOK.md). Keep n8n email dry-run enabled and use only an authorized test Telegram chat.
2. Create a test bot through Telegram's BotFather. Store the bot token privately as `TELEGRAM_BOT_TOKEN`; set a private `TELEGRAM_WEBHOOK_SECRET`. Never publish token fragments or credential screenshots.
3. Stop the intended n8n instance, then run `npm run push:n8n`. This validates/imports/publishes workflows and changes trigger state; inspect the command before execution.
4. Configure an n8n Telegram API credential named `Telegram bot`, privately using the test bot token. Check each Telegram node's credential binding and the workflow's activation state.
5. Start `npm run bot` instead of another competing n8n process. Verify the reported webhook registration and local workflow state without displaying credential values. Keep the terminal open for the exercise.
6. After testing, stop the stack/tunnel and review leftover fixtures, opted-in leads and scheduled follow-ups so a later restart does not contact unintended chats.

## Synthetic acceptance exercise

| Input / action | Observation to record, not an asserted result |
|---|---|
| `/start` then `/help` | Quick-command replies; no provider turn for those commands |
| Ask about a fictional course | Answer uses the approved simulated knowledge; unknown details defer rather than invent |
| Express enrollment interest with synthetic details | Information collection, signed pipeline submission, CRM/task/notification and dry-run email reconciled |
| `/stop` | Opt-out state and exclusion from subsequent follow-up candidate selection |
| Re-enable deliberately in the test chat | Intended consent/state transition without resetting lifetime nudge history |
| Stop tunnel or simulate provider failure in the disposable setup | Record errors, retry behavior and actual delivery outcome without assuming messages are lost or queued indefinitely |

Do not include real phone numbers or minors' data. Record only redacted evidence and measured observations in [case-study/RESULTS](case-study/RESULTS.md) after an authorized run.

## Troubleshooting by layer

1. **No n8n execution:** inspect local process, tunnel reachability and Telegram webhook status. Do not assume the AI failed if no update reached the workflow.
2. **Webhook secret rejection:** check the private secret configuration and registration agree; allow the launcher to register against the current URL. Do not paste secrets into diagnosis output.
3. **Telegram 429:** avoid restart loops; respect returned retry timing and inspect launcher backoff.
4. **Lead missing:** inspect the `Fire admissions pipeline` result and classic workflow activation, then reconcile DB records; a chat confirmation alone is not database evidence.
5. **Port conflict:** identify and stop only the intended n8n process. Broad cleanup is a last resort, not the default response to any error.
6. **Tunnel interruption:** examine webhook pending/error information and actual delivered updates after recovery. Delivery retries are bounded and environment-dependent; neither loss nor eventual delivery is guaranteed here.

Launcher/dependency changes are retained; local unit/type evidence is separate from live bot acceptance. Services for the case-study exercise are absent and its walkthrough remains planned, not implemented. [TESTING](TESTING.md) describes live gates; no launcher or package changes are made by documentation finalization.
