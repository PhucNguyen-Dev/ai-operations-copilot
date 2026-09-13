-- =============================================================
-- AI Operations Copilot — Phase 9 Milestone F: real lead trigger
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- external_key: the source system's stable lead id (e.g. a Facebook
-- leadgen id). The unique (source, external_key) pair is the
-- idempotency contract: webhook re-delivery can NEVER create a
-- duplicate lead or a duplicate pipeline run.
-- =============================================================

alter table public.leads add column if not exists external_key text;

create unique index if not exists leads_source_external_key_idx
  on public.leads (source, external_key)
  where external_key is not null;

create index if not exists leads_external_key_idx
  on public.leads (external_key)
  where external_key is not null;
