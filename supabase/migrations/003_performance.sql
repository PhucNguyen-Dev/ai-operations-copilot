-- =============================================================
-- Phase 4 hardening: indexes that keep the app fast as data grows
-- (run in Supabase SQL Editor — safe to re-run)
-- =============================================================

-- Dashboard sorts leads by created_at desc (app/page.tsx)
create index if not exists leads_created_at_idx
  on public.leads (created_at desc);

-- Counselor round-robin counts every assigned lead
create index if not exists leads_assigned_counselor_idx
  on public.leads (assigned_counselor_id)
  where assigned_counselor_id is not null;