-- =============================================================
-- 021 — Email dispatch: close the approval loop honestly
--
-- An approved email draft leaves dry_run and is DISPATCHED:
--   * 'sent'            — real Brevo send, provider_message_id set
--   * 'sent_simulated'  — no Brevo configured: recorded, audited,
--                          labeled simulated; nothing left the building
--   * 'failed'          — provider error; retryable via the UI
-- Bookkeeping: who dispatched, when, with what outcome.
-- Idempotency: the dispatch claim is a conditional update on
-- status='dry_run' (second click claims nothing) — same guard as
-- approval decisions.
-- Idempotent; additive; nothing existing is altered.
-- =============================================================

do $$
begin
  alter type email_status add value if not exists 'sent_simulated';
exception
  when duplicate_object then null;
end $$;

alter table public.sent_emails
  add column if not exists dispatched_at timestamptz,
  add column if not exists dispatched_by uuid references public.profiles (id),
  add column if not exists dispatch_error text;

-- Dispatch bookkeeping lives on the same row; partial index keeps
-- "find anything still awaiting dispatch" fast for ops views.
create index if not exists sent_emails_pending_dispatch_idx
  on public.sent_emails (created_at desc)
  where status = 'dry_run';
