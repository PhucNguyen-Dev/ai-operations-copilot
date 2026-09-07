-- =============================================================
-- Migration 006 — hot-path index review (project revision Part A2)
-- Safe to re-run. Reviewed 2026-09 against the four hottest queries.
-- =============================================================
--
-- HOW TO VERIFY on the live project (Supabase SQL Editor):
--   explain (analyze, buffers)
--     select id, name, email, status, created_at
--     from leads order by created_at desc limit 50;              -- dashboard
--   explain (analyze)
--     select id, status, started_at, lead_id from automation_runs
--     order by started_at desc limit 20;                         -- runs list / admin
--   explain (analyze)
--     select id, feature_id, step_name, status from automation_run_steps
--     where run_id = '<uuid>' order by started_at asc;           -- run detail
--   explain (analyze)
--     select id, tool_id, department, status, created_at
--     from ai_generations order by created_at desc limit 50;     -- admin
--
-- Findings: `leads (created_at desc)` already covered by 003.
-- The three indexes below close the remaining sort/lookup paths used by
-- the dashboard, runs pages, and admin console. Additive, idempotent.

-- Runs list, run detail breadcrumb, admin console all sort on started_at
create index if not exists automation_runs_started_at_idx
  on public.automation_runs (started_at desc);

-- Lead detail page: latest run for a lead (eq lead_id, order started_at)
create index if not exists automation_runs_lead_started_idx
  on public.automation_runs (lead_id, started_at desc);

-- Run detail page: steps for one run (eq run_id, order started_at)
create index if not exists automation_run_steps_run_idx
  on public.automation_run_steps (run_id, started_at);

-- Admin console: recent AI generations (order created_at desc)
create index if not exists ai_generations_created_at_idx
  on public.ai_generations (created_at desc);
