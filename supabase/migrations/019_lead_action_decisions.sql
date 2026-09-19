-- =============================================================
-- 019 — Lead action decisions (human approval gate on AI output)
--
-- Records an operator's decision on an AI recommendation or an AI
-- generated email draft for one lead. One row per decision event —
-- the approval history is append-only (audit trail); the UI reads
-- the latest row per (lead, target).
--
-- Trust model (mirrors the rest of the platform):
--   * Writes go through the authenticated API route with session
--     auth + explicit role checks (decisions are a human action).
--   * RLS: read via existing lead visibility (can_view_lead);
--     insert for the assigned counselor, operations, admin.
--   * No update/delete policies — history is append-only.
-- =============================================================

create table if not exists public.lead_action_decisions (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,
  -- What the decision applies to: the AI's recommended next action,
  -- or an AI-generated email draft.
  target        text not null check (target in ('recommended_action', 'email_draft')),
  decision      text not null check (decision in ('approved', 'rejected', 'edited')),
  -- Optional operator note; also carries the edited text when
  -- decision = 'edited' (the email draft body itself is updated on
  -- sent_emails by the API route, not duplicated here).
  decision_note text,
  -- Set when target = 'email_draft': the exact draft the decision
  -- applies to, so multiple drafts per lead stay independently gated.
  email_id     uuid references public.sent_emails (id) on delete cascade,
  decided_by    uuid not null references public.profiles (id),
  created_at    timestamptz not null default now()
);

create index if not exists lead_action_decisions_lead_idx
  on public.lead_action_decisions (lead_id, target, created_at desc);

alter table public.lead_action_decisions enable row level security;

-- Read: same visibility as the lead itself (counselor: assigned; ops/admin: all).
create policy "lead_action_decisions: read via lead visibility"
  on public.lead_action_decisions for select
  using (public.can_view_lead(lead_action_decisions.lead_id));

-- Insert: assigned counselor or ops/admin — the humans accountable for
-- the decision. service_role also allowed for system use.
create policy "lead_action_decisions: accountable roles insert"
  on public.lead_action_decisions for insert
  with check (
    public.is_ops_or_admin()
    or exists (
      select 1 from public.leads l
      where l.id = lead_action_decisions.lead_id
        and l.assigned_counselor_id = auth.uid()
    )
  );
