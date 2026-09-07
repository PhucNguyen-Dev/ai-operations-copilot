# Telegram Parent Chatbot — Runbook

Closes the last JD gap: *"AI chatbot for answering parent inquiries"* + a live
lead channel (the JD's "Facebook Leads" workflow, demonstrated on Telegram —
the same pattern swaps to Messenger/Zalo when a business account exists).

## How it works

```
Parent messages the Telegram bot
  → Telegram Trigger (n8n)
  → Prepare turn        [Code] — per-chat memory + school knowledge base
  → AI chat turn        [Gemini] — FAQ answer OR collect enrollment info
                                   (name, phone, course — one question at a time)
  → Resolve turn        [Code] — schema check + conversation state
  → Enrollment intent?  [IF]
       ├─ reply        → Telegram message (knowledge-base answer / next question)
       └─ submit       → Fire admissions pipeline (existing webhook!)
                         → classification → CRM → email (dry-run) → task → notification
                         → Telegram: warm confirmation to the parent
```

The bot uses the SAME webhook, validation, AI analysis, and logging as the
Test Lead form — the chatbot is just a new front door. Leads arrive with
`source: 'telegram'`. (Email is synthesized as `<phone>.tg@lead.local` because
the pipeline requires a valid email — flagged in the lead's message field.)

## Running the stack (two layers)

| Command | What it starts | Use when |
|---|---|---|
| `npm run n8n` | n8n only — editor at http://localhost:5678 | You want to inspect/edit workflows or test the admissions pipeline locally. The **Telegram trigger stays offline** (it needs a public HTTPS URL) — that is expected, not an error. |
| `npm run bot` | Fresh tunnel + n8n + Telegram webhook, all verified | You want the chatbot live. One terminal, keep it open. |
| `npm run kill-stack` | Emergency stop of everything (n8n ports + stray tunnels) | Anything feels "out of hand"; run this, then start fresh. |

`npm run bot` performs, in order: kills stale port-5678 processes → claims the
**fixed** tunnel URL `https://aileads-dev.loca.lt` and verifies it actually
serves (auto-falls back to a random `.loca.lt` URL if the relay is stale) →
starts n8n with that URL as `WEBHOOK_URL` → waits for n8n health → verifies
the Telegram webhook (with 429 retry) → prints `✓ Bot stack ready`. If any
layer fails it prints exactly which one and stops both children.

The startup banner is always the source of truth for the current public URL.
That URL is for Telegram's servers only — for the editor, always use
`http://localhost:5678` (the free relay chokes on the editor's asset burst in
a browser). Override the subdomain with `TUNNEL_SUBDOMAIN=<name>` if needed.

## Your steps

### 1. Create the bot (~3 min)
1. In Telegram, message **@BotFather** → send `/newbot`
2. Name it (e.g. "Language School Enrollment") and pick a username ending in `bot`
3. Copy the **token** (`123456:ABC-DEF...`)

### 2. Configure the project
1. Open `.env` → paste the token into `TELEGRAM_BOT_TOKEN=`
2. Then:
   ```bash
   npm run push:n8n       # imports the chatbot workflow (first time / after edits)
   npm run bot            # tunnel + n8n + Telegram webhook in one command
   ```

### 3. One-time n8n UI step (~2 min)
1. Open http://localhost:5678 → **Credentials** → **Add credential** → **Telegram API**
2. Paste the **same bot token** → name it exactly **`Telegram bot`** → Save
3. Open the **Parent Inquiry Chatbot (Telegram)** workflow — the 3 Telegram nodes
   should pick the credential up automatically (if not, select it in each) → **Activate**

### 4. Test it
Message your bot on Telegram:

| Message | Expected |
|---|---|
| "How much is IELTS?" | KB answer (from 6,000,000 VND, placement test) — no lead created |
| "I want to register my daughter for IELTS" | Bot asks for name / phone |
| "...her name is Lan, phone 0901 234 567" | Bot confirms → **lead appears in the dashboard** (source: telegram) with AI score/category, task + counselor notification created |

Watch the runs: each enrollment-intent chat produces a full `admissions-lead-pipeline` run.

## Troubleshooting

For the full post-mortem of the 2026-09-07 outage (silent bot, 502 tunnels,
429 rate limits, webhook secret race), see
[TELEGRAM-INCIDENT-2026-09-07.md](./TELEGRAM-INCIDENT-2026-09-07.md).

- **Bot silent, no execution row in n8n** → message never reached n8n. Usually
  the tunnel is down or you're in plain `npm run n8n` mode (Telegram offline by
  design). Run `npm run kill-stack`, then `npm run bot`.
- **`403 Provided secret is not valid`** → webhook was registered without the
  secret. `npm run bot`'s watchdog re-registers with the correct secret; a
  restart also fixes it (n8n registers itself on activation).
- **Webhook errors in n8n** → run `npm run kill-stack`, then `npm run bot`.
- **Everything feels broken / port in use** → `npm run kill-stack` stops every
  n8n and stray tunnel process; then start again with `npm run bot`.
- **`The service is receiving too many requests from you`** → Telegram 429
  rate limit from many restarts; the launcher retries with backoff — wait a
  minute between restarts.
- **Lead not appearing** → check the chatbot workflow execution: "Fire admissions pipeline" node output;
  remember the admissions workflow must also be Active.
- **`⚠ Tunnel is down — healing`** → normal watchdog behavior; it opens a new
  tunnel and re-registers automatically. Messages sent during the dead window
  are lost (Telegram does not queue).
