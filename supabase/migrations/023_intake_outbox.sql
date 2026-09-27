-- =============================================================
-- 023 — Durable lead intake: the webhook commit point survives
-- anything that happens after it
--
-- Problem this closes: the lead webhook inserts the lead, then runs
-- counselor assignment and agent triage inline. A crash between the
-- insert and those steps loses the downstream work forever — the lead
-- row exists but nobody was ever assigned or triaged, and no
-- re-delivery can repair it (idempotency acks duplicates).
--
-- Fix: after the lead commit, enqueue one outbox row. The webhook
-- response no longer depends on any downstream step succeeding.
-- A processing loop (ops worker or cron) claims rows atomically,
-- runs assignment + triage, and marks them done; failures retry with
-- backoff (capped) and dead-letter for visibility instead of
-- vanishing.
--
-- Trust model (mirrors 015/021): written via service role from
-- trusted intake code only; processing claims are single-statement
-- conditional updates (same guard as approval claims).
-- Idempotent; additive; nothing existing is altered or dropped.
-- =============================================================

create table if not exists public.lead_intake_outbox (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  -- Unique per lead: re-delivery is an idempotency ack upstream, and a
  -- crash between lead insert and enqueue is repaired by the
  -- idempotent re-enqueue on the next delivery.
  kind text not null default 'triage' check (kind in ('triage')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'dead_letter')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Re-enqueue is an upsert: a re-delivery after a mid-crash re-inserts
-- the same lead row and gets the SAME outbox row back (no dupes).
create unique index if not exists lead_intake_outbox_lead_kind_key
  on public.lead_intake_outbox (lead_id, kind);

-- Claim queue: oldest eligible pending rows first.
create index if not exists lead_intake_outbox_claim_idx
  on public.lead_intake_outbox (available_at)
  where status = 'pending';

comment on table public.lead_intake_outbox is
  'Durable downstream work for accepted lead intakes (counselor assignment + agent triage). Enqueued at webhook commit; processed with bounded retries; failures dead-letter visibly. Service-role writes only.';

-- Outbox is trusted infrastructure: no RLS policies on purpose.
-- Only the service role (webhook intake + processing loop) touches it.
alter table public.lead_intake_outbox enable row level security;

-- -------------------------------------------------------------
-- claim_lead_intake_job: atomic claim of one due job.
-- Single-statement conditional update — concurrent workers serialize
-- on the status='pending' guard, so a job is never claimed twice.
-- Returns the claimed job row, or null when the queue is empty.
-- -------------------------------------------------------------
create or replace function public.claim_lead_intake_job(
  p_batch int default 1
)
returns setof public.lead_intake_outbox
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select id
    from public.lead_intake_outbox
    where status = 'pending'
      and available_at <= now()
    order by available_at
    limit greatest(1, p_batch)
    for update skip locked
  )
  update public.lead_intake_outbox o
  set status = 'processing',
      attempts = o.attempts + 1,
      updated_at = now()
  from claimed
  where o.id = claimed.id
  returning o;
$$;

-- -------------------------------------------------------------
-- release_lead_intake_job: terminal outcome of one processing attempt.
--   done          → job complete
--   retryable err → reschedule with exponential backoff until the
--                   attempt cap, then dead-letter (visible, never lost)
--   permanent err → dead-letter immediately
-- -------------------------------------------------------------
create or replace function public.release_lead_intake_job(
  p_job_id uuid,
  p_ok boolean,
  p_error text default null,
  p_retryable boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ok then
    update public.lead_intake_outbox
    set status = 'done',
        processed_at = now(),
        updated_at = now()
    where id = p_job_id;
    return;
  end if;

  if not p_retryable then
    update public.lead_intake_outbox
    set status = 'dead_letter',
        last_error = left(p_error, 2000),
        updated_at = now()
    where id = p_job_id;
    return;
  end if;

  update public.lead_intake_outbox
  set status = case
        when attempts >= max_attempts then 'dead_letter'
        else 'pending'
      end,
      last_error = left(p_error, 2000),
      -- Exponential backoff: 5s, 20s, 45s, 80s, ... (15s * attempts²).
      available_at = now() + (15 * attempts * attempts) * interval '1 second',
      updated_at = now()
  where id = p_job_id
    and status = 'processing';
end;
$$;

revoke execute on function public.claim_lead_intake_job(int) from public;
grant execute on function public.claim_lead_intake_job(int) to service_role;
revoke execute on function public.release_lead_intake_job(uuid, boolean, text, boolean) from public;
grant execute on function public.release_lead_intake_job(uuid, boolean, text, boolean) to service_role;

-- =============================================================
-- Approval execution audit (no schema change).
--
-- The approval chain was re-audited against the Tier-1 "at-most-once"
-- concern and CONFIRMED CORRECT as shipped in 015:
--   * decisions are a conditional update on status='pending' — double
--     decisions are impossible (second caller gets zero rows);
--   * execution is claimed by claim_agent_approval — a single-statement
--     conditional update; concurrent resumes serialize, the loser gets
--     null and surfaces RECONCILIATION_REQUIRED;
--   * a claimed-but-interrupted execution is deliberately NOT replayed
--     (resumeAgentRun refuses: the side effect may have happened) —
--     that is the correct integrity trade for non-idempotent sends,
--     and the failure is visible in the run trace + approval row.
-- Do not "fix" the rollback path: it restores execution_claimed_at and
-- leaves the pause start untouched, which keeps pause accounting and
-- the run-timeout guard correct.
-- =============================================================
