-- =============================================================
-- 004 — ai_generations: one row per interactive AI tool generation
-- (Phase 6, F-020–F-024). Written by lib/gemini.ts via the caller's
-- session (RLS applies); read by ops/admin for the /admin overview.
-- Run in the Supabase SQL Editor — safe to re-run (IF NOT EXISTS).
-- =============================================================

create table if not exists public.ai_generations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  tool_id       text not null,              -- 'F-020' … 'F-024'
  department    text not null,              -- marketing | academic | operations
  input_summary jsonb,                      -- sanitized tool inputs (no long free text)
  model         text not null,
  status        text not null default 'success' check (status in ('success', 'failed')),
  error_code    text,
  duration_ms   integer,
  created_at    timestamptz not null default now()
);

create index if not exists ai_generations_user_idx   on public.ai_generations (user_id, created_at desc);
create index if not exists ai_generations_tool_idx   on public.ai_generations (tool_id, created_at desc);
create index if not exists ai_generations_dept_idx   on public.ai_generations (department, created_at desc);

-- =============================================================
-- RLS — the table follows the same model as the rest of the app:
-- users see their own generations; ops/admin see all; inserts are
-- performed by the authenticated tool routes as the calling user.
-- =============================================================
alter table public.ai_generations enable row level security;

create policy "ai_generations: read own"
  on public.ai_generations for select
  using (auth.uid() = user_id);

create policy "ai_generations: ops/admin read all"
  on public.ai_generations for select
  using (public.jwt_role() in ('operations', 'admin'));

create policy "ai_generations: staff insert own"
  on public.ai_generations for insert
  with check (auth.uid() = user_id and public.jwt_role() in ('marketing', 'teacher', 'operations', 'admin'));
