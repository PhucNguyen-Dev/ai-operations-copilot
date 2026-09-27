-- =============================================================
-- 024 — Run cancellation: the operator can stop the machine
--
-- Problem this closes: nothing anywhere set the 'cancelled' status
-- that agent_run_status has carried since 010. A streaming run could
-- spend tokens and mutate CRM state with no way to halt it, and a run
-- suspended on an approval could sit there forever ("waiting") with no
-- way to withdraw it.
--
-- Fix: a per-run cancel REQUEST, plus an atomic RPC that records it.
-- The runtime notices the flag at its next barrier and ends the run as
-- 'cancelled'; a suspended run has no loop to notice anything, so the
-- RPC ends it in the same transaction that records the request.
--
-- Two deliberate properties:
--   * The canonical run status already exists in the enum ('cancelled'
--     since 010) — no enum migration, and no new value for the UI to
--     learn.
--   * A cancelled run's pending approval is closed as 'rejected' with
--     the reason in decision_note: the existing decision path already
--     refuses to act on a non-pending approval, so closing it this way
--     is what makes "cancel then approve" structurally impossible.
--     (claim_agent_approval in 015 additionally requires the run to
--     still be 'awaiting_approval', so the guarantee does not depend on
--     this function alone.)
--
-- Trust model (mirrors 015/023): written via the service role from
-- trusted route code only — the API route authorizes the actor (owning
-- employee or Operations/Admin) against RLS first, then calls this.
-- Idempotent; additive; nothing existing is altered or dropped.
-- =============================================================

alter table public.agent_runs
  add column if not exists cancel_requested_at timestamptz;
alter table public.agent_runs
  add column if not exists cancelled_by uuid references public.profiles (id);

comment on column public.agent_runs.cancel_requested_at is
  'When an operator asked for this run to stop. The runtime reads it before every model turn and tool call; a suspended run is ended by request_agent_run_cancel instead.';
comment on column public.agent_runs.cancelled_by is
  'The profile that requested the stop (audit). Distinct from user_id, who owns the run.';

-- -------------------------------------------------------------
-- request_agent_run_cancel: record a stop request atomically.
--
-- Returns jsonb so one call answers every case the route needs:
--   { claimed: true,  status: 'running'|'cancelled', ... }  → the request was recorded
--   { claimed: false, status: 'completed'|..., ... }        → already terminal (idempotent)
--   { claimed: false, found: false }                        → no such run
--
-- Deliberately NOT terminal for a 'running' run: an in-flight loop is
-- driven by another process, which must be the one to write the
-- terminal state and its trace step. Setting status here would race the
-- loop and could leave a half-written trace.
-- -------------------------------------------------------------
create or replace function public.request_agent_run_cancel(
  p_run_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.agent_runs;
  closed_approval uuid;
begin
  -- Claim the request: only a non-terminal run that has not already
  -- been asked to stop. Concurrent cancellations serialize here.
  update public.agent_runs
  set cancel_requested_at = now(),
      cancelled_by = p_actor,
      updated_at = now()
  where id = p_run_id
    and status in ('running', 'awaiting_approval')
    and cancel_requested_at is null
  returning * into r;

  if r is null then
    select * into r from public.agent_runs where id = p_run_id;
    if r is null then
      return jsonb_build_object('claimed', false, 'found', false);
    end if;
    return jsonb_build_object(
      'claimed', false,
      'found', true,
      'status', r.status,
      'cancelRequested', r.cancel_requested_at is not null
    );
  end if;

  -- A suspended run has no loop to notice the flag: end it here.
  -- Mirror 015's approval-wait accounting (with coalesce — the pause
  -- start is nullable and greatest() returns null for a null argument,
  -- which would violate the column's not-null constraint).
  if r.status = 'awaiting_approval' then
    update public.agent_runs
    set status = 'cancelled',
        completed_at = now(),
        error = 'CANCELLED: stopped by an operator while awaiting approval',
        approval_wait_ms = r.approval_wait_ms
          + coalesce(greatest(0, extract(epoch from (now() - r.approval_wait_started_at)) * 1000)::bigint, 0),
        approval_wait_started_at = null,
        updated_at = now()
    where id = r.id
      and status = 'awaiting_approval'
    returning * into r;

    -- The proposal is withdrawn, not pending (it must never execute)
    -- and not approved. decision_note says what actually happened so a
    -- reviewer reading the approval inbox is not misled.
    update public.agent_approvals a
    set status = 'rejected',
        decided_by = p_actor,
        decision_note = 'Run cancelled by an operator — this action was never executed.',
        decided_at = now()
    where a.run_id = r.id
      and a.status = 'pending'
    returning a.id into closed_approval;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'found', true,
    'status', r.status,
    'cancelRequested', true,
    'cancelledBy', p_actor,
    'closedApprovalId', closed_approval
  );
end;
$$;

revoke execute on function public.request_agent_run_cancel(uuid, uuid) from public;
grant execute on function public.request_agent_run_cancel(uuid, uuid) to service_role;

-- =============================================================
-- Known limit (documented, not hidden).
--
-- If the process driving a 'running' run has already died, nothing
-- will ever read the flag, so the row stays 'running' with
-- cancel_requested_at set. That is not a new failure mode — an
-- orphaned run was already stuck at 'running' before this migration —
-- but it is worth knowing when reading the run list: a requested
-- cancellation on a run with no live process is an operator
-- reconciliation item, not a completed stop. See RUNBOOK §5.
-- =============================================================
