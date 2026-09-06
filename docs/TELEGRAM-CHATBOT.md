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

## Your steps

### 1. Create the bot (~3 min)
1. In Telegram, message **@BotFather** → send `/newbot`
2. Name it (e.g. "Language School Enrollment") and pick a username ending in `bot`
3. Copy the **token** (`123456:ABC-DEF...`)

### 2. Configure the project
1. Open `.env` → paste the token into `TELEGRAM_BOT_TOKEN=`
2. Stop n8n if it's running, then:
   ```bash
   npm run push:n8n       # imports the chatbot workflow
   npm run n8n:tunnel     # starts n8n with a public HTTPS URL (needed for Telegram)
   ```
   The tunnel prints a public URL — that's how Telegram reaches your machine.

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

- **Bot silent** → workflow not Active, or the Telegram credential missing/mismatched token.
- **Webhook errors in n8n** → tunnel not running (must use `npm run n8n:tunnel`, not `npm run n8n`).
- **Lead not appearing** → check the chatbot workflow execution: "Fire admissions pipeline" node output;
  remember the admissions workflow must also be Active.
- **Weird long URL in Telegram trigger** → restart with tunnel *before* activating; the trigger re-registers
  its webhook on startup.
