-- =============================================================
-- 008 — least-privilege database role for the n8n pipeline (R-08)
-- =============================================================
-- Problem: n8n writes with the service-role key, which bypasses RLS
-- entirely - every workflow node carries full DB power (R-08).
--
-- The proper fix on Supabase: a dedicated Postgres role `n8n_pipeline`
-- with explicit grants ONLY on the tables the pipeline writes, plus
-- RLS policies scoped to that role. n8n authenticates through PostgREST
-- by sending a JWT whose `role` claim is `n8n_pipeline`, signed with the
-- project's JWT secret (scripts/start-n8n.mjs mints it from
-- SUPABASE_JWT_SECRET in .env). PostgREST trusts any JWT signed with
-- that secret and acts as the role in the claim.
--
-- Run in the Supabase SQL Editor. Idempotent. After running:
--   1. Copy the project's JWT secret (Settings -> API -> JWT Settings)
--      into .env as SUPABASE_JWT_SECRET
--   2. Restart n8n (npm run n8n)
-- =============================================================

-- 1. Role (no login - it is a claim-role, not a human account)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'n8n_pipeline') then
    create role n8n_pipeline nologin;
  end if;
end $$;

-- 2. Schema usage
grant usage on schema public to n8n_pipeline;

-- 3. Table grants: exactly what the admissions pipeline writes (and must
--    read back), nothing else. No delete anywhere.
grant select, insert, update on public.leads, public.lead_analyses, public.tasks,
  public.sent_emails, public.notifications, public.automation_runs,
  public.automation_run_steps to n8n_pipeline;

-- 4. Sequences/defaults: tables use gen_random_uuid() defaults, so no
--    sequence grants are needed.

-- 5. RLS policies for the pipeline role (RLS applies - this role has no
--    BYPASSRLS). Service-like trust, but scoped: it may only insert/update
--    pipeline-owned rows, never delete, never touch other tables.
drop policy if exists "pipeline: leads write"         on public.leads;
drop policy if exists "pipeline: analyses write"      on public.lead_analyses;
drop policy if exists "pipeline: tasks write"         on public.tasks;
drop policy if exists "pipeline: sent_emails write"   on public.sent_emails;
drop policy if exists "pipeline: notifications write" on public.notifications;
drop policy if exists "pipeline: runs write"          on public.automation_runs;
drop policy if exists "pipeline: steps write"         on public.automation_run_steps;

create policy "pipeline: leads write"
  on public.leads for all to n8n_pipeline
  using (true) with check (true);
create policy "pipeline: analyses write"
  on public.lead_analyses for all to n8n_pipeline
  using (true) with check (true);
create policy "pipeline: tasks write"
  on public.tasks for all to n8n_pipeline
  using (true) with check (true);
create policy "pipeline: sent_emails write"
  on public.sent_emails for all to n8n_pipeline
  using (true) with check (true);
create policy "pipeline: notifications write"
  on public.notifications for all to n8n_pipeline
  using (true) with check (true);
create policy "pipeline: runs write"
  on public.automation_runs for all to n8n_pipeline
  using (true) with check (true);
create policy "pipeline: steps write"
  on public.automation_run_steps for all to n8n_pipeline
  using (true) with check (true);
