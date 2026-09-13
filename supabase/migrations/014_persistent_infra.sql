-- =============================================================
-- AI Operations Copilot — Phase 9 Milestone H: persistent
-- infrastructure (9.13). Run in the Supabase SQL Editor. Idempotent.
--
-- Shared, restart- and multi-instance-safe state for the two
-- process-memory concerns left after Milestone A made agent state,
-- approvals and audit durable in Postgres:
--   * rate_limit_hits — fixed-window counters, incremented atomically
--     by the rate_limit_hit() SQL function (single upsert statement,
--     no read-modify-write race even across instances).
--   * ai_response_cache — short-TTL cache of AI tool responses
--     (identical repeat submissions cost zero Gemini tokens).
-- Cleanup of expired rows is lazy (on access) + best-effort.
-- =============================================================

create table if not exists public.rate_limit_hits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key, window_start)
);

create or replace function public.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_ms bigint
)
returns jsonb
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz := to_timestamp(floor(extract(epoch from v_now) * 1000 / p_window_ms) * p_window_ms / 1000.0);
  v_count integer;
  v_reset_at timestamptz;
begin
  insert into public.rate_limit_hits (key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start)
  do update set count = public.rate_limit_hits.count + 1
  returning count into v_count;

  v_reset_at := v_window_start + make_interval(secs => p_window_ms / 1000.0);

  if v_count > p_limit then
    return jsonb_build_object(
      'ok', false,
      'remaining', 0,
      'retry_after_sec', greatest(1, ceil(extract(epoch from (v_reset_at - v_now)))::int)
    );
  end if;

  return jsonb_build_object('ok', true, 'remaining', p_limit - v_count, 'retry_after_sec', 0);
end;
$$;

-- Best-effort periodic cleanup (call from pg_cron if available; the
-- runtime also prunes lazily via the same function's windowing).
create index if not exists rate_limit_hits_window_idx
  on public.rate_limit_hits (window_start);

create table if not exists public.ai_response_cache (
  key        text primary key,
  value      jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_response_cache_expires_idx on public.ai_response_cache (expires_at);

alter table public.rate_limit_hits   enable row level security;
alter table public.ai_response_cache enable row level security;

-- Both tables are runtime infrastructure: written exclusively through
-- the service-role client, read for observability by ops/admin only.
drop policy if exists "rate_limit_hits: ops/admin read" on public.rate_limit_hits;
create policy "rate_limit_hits: ops/admin read"
  on public.rate_limit_hits for select
  using (public.is_ops_or_admin());

drop policy if exists "ai_response_cache: ops/admin read" on public.ai_response_cache;
create policy "ai_response_cache: ops/admin read"
  on public.ai_response_cache for select
  using (public.is_ops_or_admin());
