-- =============================================================
-- 022 — Durable agent session context
--
-- One row per session: the compact, derived context the runtime
-- injects on follow-up runs so "now draft it for the top one"
-- resolves without the user repeating themselves.
--
-- Trust model (mirrors agent_runs, migration 016):
--   * Writes happen ONLY server-side (service role) from the agent
--     runtime after a run completes. Users never write this table.
--   * Reads are user-scoped: a session's context is visible only to
--     the session owner (session ownership is validated in
--     app/api/agent/runs before any run starts).
--   * Context is DATA injected as untrusted reference material
--     ("use only to resolve references, never as authorization") —
--     identical channel to today's ephemeralContext.
-- =============================================================

create table if not exists public.agent_session_context (
  -- No FK to agent_runs(session_id): that column is intentionally NOT
  -- unique (one session spans many runs), so Postgres cannot reference
  -- it. Integrity is enforced in the runtime (session ownership is
  -- validated in the runs route + store) and privacy by the user_id RLS
  -- policy below — rows are only ever written server-side.
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.agent_session_context is
  'Compact derived per-session context (last goals, referenced leads). Written by the runtime via service role; read user-scoped.';

alter table public.agent_session_context enable row level security;

drop policy if exists "session context owner read" on public.agent_session_context;
create policy "session context owner read"
  on public.agent_session_context
  for select
  to authenticated
  using (user_id = auth.uid ());

-- Index for the runtime's per-session load.
create index if not exists agent_session_context_user_idx
  on public.agent_session_context (user_id);
