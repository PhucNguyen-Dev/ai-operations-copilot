-- =============================================================
-- Migration 009 — Telegram follow-up sequence (bot polish upgrade)
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run.
-- =============================================================

-- Chat identity + nudge bookkeeping on the lead row (single source of truth).
alter table public.leads add column if not exists telegram_chat_id text;
alter table public.leads add column if not exists nudges_sent int not null default 0;
alter table public.leads add column if not exists last_nudge_at timestamptz;
alter table public.leads add column if not exists telegram_stopped boolean not null default false;

-- Scheduler query path: status + created_at filter for chat-eligible leads.
create index if not exists leads_followup_idx
  on public.leads (status, created_at)
  where telegram_chat_id is not null;
