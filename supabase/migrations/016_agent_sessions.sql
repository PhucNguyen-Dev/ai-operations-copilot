-- Agent sessions are derived from durable runs; historical runs remain sessionless.
alter table public.agent_runs add column if not exists session_id uuid;
create index if not exists agent_runs_user_session_idx on public.agent_runs (user_id, session_id, started_at desc);
create index if not exists agent_runs_session_activity_idx on public.agent_runs (session_id, started_at desc);
