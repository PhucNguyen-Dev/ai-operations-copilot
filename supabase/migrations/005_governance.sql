-- =============================================================
-- AI Operations Copilot — Phase 7: governance tables (F-026/F-027)
-- Run in Supabase SQL Editor. Safe to re-run (idempotent).
-- =============================================================

-- -------------------------------------------------------------
-- F-026 — AI Tool Lab: genuine hands-on experiments
-- -------------------------------------------------------------
create table if not exists public.tool_experiments (
  id             uuid primary key default gen_random_uuid(),
  experiment_date date not null default current_date,
  tool_name      text not null,
  tool_category  text not null, -- llm | image | transcription | ocr | automation | research
  business_task  text not null, -- the real department task it was tested against
  test_definition text not null,
  output_summary text not null,
  quality_notes  text,
  speed_notes    text,
  cost_notes     text,
  ease_notes     text,
  integration_notes text,
  limitations    text,
  evidence_url   text,
  created_at     timestamptz not null default now()
);

create index if not exists tool_experiments_tool_idx on public.tool_experiments (tool_name);

-- -------------------------------------------------------------
-- F-027 — AI Tool Evaluation: scored adoption decisions
-- -------------------------------------------------------------
create table if not exists public.tool_evaluations (
  id             uuid primary key default gen_random_uuid(),
  tool_name      text not null,
  use_case       text not null,
  scores         jsonb not null, -- { quality, accuracy, cost, speed, ease, integration, privacy, scalability } 1-5
  total_score    numeric not null,
  recommendation text not null check (recommendation in ('recommended', 'conditional', 'not_recommended')),
  rationale      text not null,
  strengths      text[] not null default '{}',
  weaknesses     text[] not null default '{}',
  experiment_refs uuid[] not null default '{}',
  created_at     timestamptz not null default now()
);

-- -------------------------------------------------------------
-- RLS: all authenticated staff read; admin/operations write.
-- (Governance material is internal-wide by design; changes to
-- adoption decisions are an Operations/Admin responsibility.)
-- -------------------------------------------------------------
alter table public.tool_experiments  enable row level security;
alter table public.tool_evaluations  enable row level security;

drop policy if exists "tool_experiments: staff read" on public.tool_experiments;
create policy "tool_experiments: staff read"
  on public.tool_experiments for select
  using (auth.role() = 'authenticated');

drop policy if exists "tool_experiments: ops/admin write" on public.tool_experiments;
create policy "tool_experiments: ops/admin write"
  on public.tool_experiments for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text in ('admin', 'operations')
    )
  );

drop policy if exists "tool_evaluations: staff read" on public.tool_evaluations;
create policy "tool_evaluations: staff read"
  on public.tool_evaluations for select
  using (auth.role() = 'authenticated');

drop policy if exists "tool_evaluations: ops/admin write" on public.tool_evaluations;
create policy "tool_evaluations: ops/admin write"
  on public.tool_evaluations for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text in ('admin', 'operations')
    )
  );
