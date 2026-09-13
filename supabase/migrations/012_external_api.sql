-- =============================================================
-- AI Operations Copilot — Phase 9 Milestone E: external REST surface
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- agent_api_clients: provisioned external callers (9.10). Each client
-- has its own credential pair — the secret is stored HASHED (sha256)
-- and shown once at provisioning; clients are individually revocable.
-- Capability boundary = scopes ∩ allowed_agents (agent identity) ∩
-- the agent's tool allowlist; write tools are structurally outside
-- the external agent's allowlist.
--
-- agent_runs.client_id attributes externally-started runs for audit.
-- =============================================================

create table if not exists public.agent_api_clients (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  client_id        text not null unique,
  secret_hash      text not null,
  scopes           text[] not null default '{agent.run}',
  allowed_agents   text[] not null default '{external-lead-support}',
  max_runs_per_hour integer not null default 10,
  enabled          boolean not null default true,
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now()
);

-- agent_runs attribution for externally-started runs
alter table public.agent_runs add column if not exists client_id text;

alter table public.agent_api_clients enable row level security;

-- Clients are managed by the runtime through the service-role key;
-- humans (ops/admin) get read visibility for governance audits.
-- There are deliberately no user write policies.
drop policy if exists "agent_api_clients: ops/admin read" on public.agent_api_clients;
create policy "agent_api_clients: ops/admin read"
  on public.agent_api_clients for select
  using (public.is_ops_or_admin());
