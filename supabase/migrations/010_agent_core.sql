-- =============================================================
-- AI Operations Copilot — Phase 9 Milestone A: Agentic Core tables
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Trust model (mirrors the n8n pipeline):
--   * The agent runtime (Next.js server) writes these tables with the
--     service-role key — RLS does not apply to that path, so run/step/
--     approval rows are tamper-proof from the user side (audit integrity).
--   * User clients get read-only SELECT policies: employees see their own
--     runs, Operations/Admin see all. There are deliberately NO user
--     insert/update policies on the agent tables.
-- =============================================================

-- -------------------------------------------------------------
-- Enums
-- -------------------------------------------------------------
do $$ begin
  create type agent_run_status as enum
    ('running', 'awaiting_approval', 'completed', 'failed', 'escalated', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agent_step_status as enum
    ('success', 'failed', 'denied', 'approval_required', 'rejected', 'skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agent_approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------
-- agent_runs — one durable row per agent execution (9.3)
-- current_state is the agent's compact working summary (safe facts,
-- never chain-of-thought). The steps table is the full reconstruction.
-- -------------------------------------------------------------
create table if not exists public.agent_runs (
  id             uuid primary key default gen_random_uuid(),
  agent_id       text not null,
  user_id        uuid not null references public.profiles (id),
  -- Invoking employee's role AT RUN START — the resumed loop always
  -- re-evaluates permissions under this principal, never under the
  -- approver's (the approver decides one action, not the whole run).
  user_role      text not null,
  goal           text not null,
  status         agent_run_status not null default 'running',
  current_state  jsonb not null default '{}'::jsonb,
  step_count     integer not null default 0,
  max_steps      integer not null,
  tokens_in      integer not null default 0,
  tokens_out     integer not null default 0,
  final_outcome  text,
  error          text,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists agent_runs_user_idx    on public.agent_runs (user_id, started_at desc);
create index if not exists agent_runs_status_idx  on public.agent_runs (status);
create index if not exists agent_runs_agent_idx   on public.agent_runs (agent_id, started_at desc);

-- -------------------------------------------------------------
-- agent_run_steps — the execution trace (9.4) AND the resume log (9.3).
-- kind: 'tool_call' (a model-selected tool attempt) | 'system'
-- (runtime-level events: model failure, guardrail stop).
-- feedback_snapshot is the exact functionResponse payload the model saw,
-- so a resumed run rebuilds its conversation faithfully from the DB.
-- -------------------------------------------------------------
create table if not exists public.agent_run_steps (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references public.agent_runs (id) on delete cascade,
  kind                text not null default 'tool_call' check (kind in ('tool_call', 'system')),
  step_index          integer not null,
  tool_name           text,
  tool_version        text,
  permission_decision text check (permission_decision in ('allowed', 'denied', 'approval_required')),
  status              agent_step_status not null,
  approval_id         uuid,
  args_snapshot       jsonb,
  result_summary      jsonb,
  feedback_snapshot   jsonb,
  error               text,
  latency_ms          integer,
  tokens_in           integer not null default 0,
  tokens_out          integer not null default 0,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz
);

create index if not exists agent_run_steps_run_idx on public.agent_run_steps (run_id, step_index);

-- -------------------------------------------------------------
-- agent_approvals — human approval protocol (9.6)
-- proposed → pending → approved/rejected → execute
-- -------------------------------------------------------------
create table if not exists public.agent_approvals (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.agent_runs (id) on delete cascade,
  step_id       uuid references public.agent_run_steps (id) on delete set null,
  tool_name     text not null,
  args_snapshot jsonb,
  status        agent_approval_status not null default 'pending',
  requested_by  uuid not null references public.profiles (id),
  decided_by    uuid references public.profiles (id),
  decision_note text,
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz
);

create index if not exists agent_approvals_status_idx on public.agent_approvals (status, requested_at desc);
create index if not exists agent_approvals_run_idx    on public.agent_approvals (run_id);

-- -------------------------------------------------------------
-- Runtime controls (kill switch + per-tool enable/disable).
-- Single-row config table; tool flags default to enabled when absent.
-- Writes go through admin routes with the service-role key.
-- -------------------------------------------------------------
create table if not exists public.agent_runtime_config (
  id          integer primary key default 1 check (id = 1),
  kill_switch boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id)
);

insert into public.agent_runtime_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.agent_tool_config (
  tool_name  text primary key,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- knowledge_docs — Milestone B grows this into full RAG (vectors,
-- chunking); Milestone A seeds governed SOP content for the
-- search_knowledge tool with role-scope filtering and citations.
-- -------------------------------------------------------------
create table if not exists public.knowledge_docs (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  doc_type      text not null check (doc_type in ('sop', 'faq', 'policy', 'course_info')),
  department    text not null,
  content       text not null,
  allowed_roles text[] not null default '{all}',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists knowledge_docs_department_idx on public.knowledge_docs (department, doc_type);

-- Seed a small governed SOP set (only when the table is still empty —
-- idempotent re-run). Admissions focus: the Milestone A reference agent.
do $$
begin
  if not exists (select 1 from public.knowledge_docs limit 1) then
    insert into public.knowledge_docs (title, doc_type, department, content, allowed_roles) values
      ('SOP: Handling new admissions inquiries', 'sop', 'admissions',
       '1. Review the lead analysis and recommended action. 2. HOT leads: create a same-day follow-up task and prepare a first-touch email (dry run by default). 3. WARM leads: follow-up task within 72 hours. 4. COLD leads: no outbound contact; log the lead for the weekly digest. 5. If budget or timeline is missing from the inquiry, ask the counselor to request it before drafting an offer. 6. Escalate to the counselor when the lead mentions competitor comparison or refund.',
       '{all}'),
      ('Policy: Email communication rules', 'policy', 'admissions',
       'All automated emails stay in dry-run mode until the governance review signs off. Real sends require explicit human approval of the exact subject and body. Emails must include the course name, must not promise discounts, and must not state admission guarantees. Do not email a lead more than once per 48 hours.',
       '{admissions, admin}'),
      ('FAQ: Course pricing 2026', 'faq', 'admissions',
       'Full-time programs: 28,000,000 VND per term. Part-time evening programs: 18,000,000 VND per term. Early-bird discount of 10% applies only to registrations confirmed 30 days before the cohort start. Payment plans: 2 installments max. Pricing questions beyond this FAQ go to the admissions manager.',
       '{all}'),
      ('Course info: IELTS Intensive', 'course_info', 'academic',
       'IELTS Intensive is an 8-week program, 15 hours per week, capped at 16 students. Entry requires a placement score of 5.0 or higher. Cohorts start the first Monday of each month. The completion certificate requires 80% attendance and a final mock score of 6.0.',
       '{all}');
  end if;
end $$;

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.agent_runs          enable row level security;
alter table public.agent_run_steps     enable row level security;
alter table public.agent_approvals     enable row level security;
alter table public.agent_runtime_config enable row level security;
alter table public.agent_tool_config   enable row level security;
alter table public.knowledge_docs      enable row level security;

-- Read visibility mirrors the automation logs: own runs for the
-- requesting employee, everything for Operations/Admin.
create or replace function public.can_view_agent_run(p_run_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if public.is_ops_or_admin() then
    return true;
  end if;
  return exists (
    select 1 from public.agent_runs
    where agent_runs.id = p_run_id
      and agent_runs.user_id = auth.uid()
  );
end;
$$;

drop policy if exists "agent_runs: read own" on public.agent_runs;
create policy "agent_runs: read own"
  on public.agent_runs for select
  using (user_id = auth.uid());

drop policy if exists "agent_runs: ops/admin read all" on public.agent_runs;
create policy "agent_runs: ops/admin read all"
  on public.agent_runs for select
  using (public.is_ops_or_admin());

drop policy if exists "agent_run_steps: read via run visibility" on public.agent_run_steps;
create policy "agent_run_steps: read via run visibility"
  on public.agent_run_steps for select
  using (public.can_view_agent_run(agent_run_steps.run_id));

drop policy if exists "agent_approvals: read via run visibility" on public.agent_approvals;
create policy "agent_approvals: read via run visibility"
  on public.agent_approvals for select
  using (public.can_view_agent_run(agent_approvals.run_id));

-- Runtime controls: read for ops/admin (health/kill-switch display);
-- all writes are service-role only.
drop policy if exists "agent_runtime_config: ops/admin read" on public.agent_runtime_config;
create policy "agent_runtime_config: ops/admin read"
  on public.agent_runtime_config for select
  using (public.is_ops_or_admin());

drop policy if exists "agent_tool_config: ops/admin read" on public.agent_tool_config;
create policy "agent_tool_config: ops/admin read"
  on public.agent_tool_config for select
  using (public.is_ops_or_admin());

-- Knowledge: all authenticated staff read; role-scope filtering happens
-- in the tool (allowed_roles), not in RLS — the table also backs the
-- guidelines UI where the full catalog is legitimate to browse.
drop policy if exists "knowledge_docs: staff read" on public.knowledge_docs;
create policy "knowledge_docs: staff read"
  on public.knowledge_docs for select
  using (auth.role() = 'authenticated');
