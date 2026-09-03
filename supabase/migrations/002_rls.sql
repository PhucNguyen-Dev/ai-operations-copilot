-- =============================================================
-- AI Operations Copilot — Phase 2: Row-Level Security
-- Role source of truth: JWT app_metadata.role (set by
-- scripts/seed-users.mjs). n8n writes with the service-role key,
-- which bypasses RLS entirely — no policies needed for that path.
-- =============================================================

-- Role helpers (current_role is a reserved SQL keyword, hence jwt_role)
create or replace function public.jwt_role()
returns text
language sql stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
$$;

create or replace function public.is_admin()
returns boolean
language sql stable
as $$ select public.jwt_role() = 'admin' $$;

create or replace function public.is_ops_or_admin()
returns boolean
language sql stable
as $$ select public.jwt_role() in ('operations', 'admin') $$;

-- Lead visibility used by child tables (security definer so the
-- inner leads query is not itself re-filtered by RLS)
create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if public.is_ops_or_admin() then
    return true;
  end if;
  return exists (
    select 1 from public.leads
    where leads.id = p_lead_id
      and leads.assigned_counselor_id = auth.uid()
  );
end;
$$;

-- -------------------------------------------------------------
-- Enable RLS on every table
-- -------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.courses               enable row level security;
alter table public.leads                 enable row level security;
alter table public.lead_analyses         enable row level security;
alter table public.tasks                 enable row level security;
alter table public.sent_emails           enable row level security;
alter table public.notifications         enable row level security;
alter table public.automation_runs       enable row level security;
alter table public.automation_run_steps  enable row level security;

-- -------------------------------------------------------------
-- profiles
-- -------------------------------------------------------------
create policy "profiles: read own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles: admin reads all"
  on public.profiles for select
  using (public.is_admin());

-- -------------------------------------------------------------
-- courses — read-only catalog for all authenticated staff
-- -------------------------------------------------------------
create policy "courses: staff read"
  on public.courses for select
  using (auth.role() = 'authenticated');

-- -------------------------------------------------------------
-- leads
-- -------------------------------------------------------------
create policy "leads: counselor reads assigned"
  on public.leads for select
  using (assigned_counselor_id = auth.uid());

create policy "leads: ops/admin read all"
  on public.leads for select
  using (public.is_ops_or_admin());

create policy "leads: admissions/admin insert (test lead intake)"
  on public.leads for insert
  with check (public.jwt_role() in ('admissions', 'admin'));

create policy "leads: counselor updates assigned"
  on public.leads for update
  using (assigned_counselor_id = auth.uid());

-- -------------------------------------------------------------
-- lead_analyses — visible where the parent lead is visible
-- (writes come from n8n via service-role only)
-- -------------------------------------------------------------
create policy "analyses: read via lead visibility"
  on public.lead_analyses for select
  using (public.can_view_lead(lead_analyses.lead_id));

-- -------------------------------------------------------------
-- tasks
-- -------------------------------------------------------------
create policy "tasks: read via lead visibility"
  on public.tasks for select
  using (public.can_view_lead(tasks.lead_id));

create policy "tasks: counselor updates own assignments"
  on public.tasks for update
  using (assigned_counselor_id = auth.uid());

-- -------------------------------------------------------------
-- sent_emails — visible where the parent lead is visible
-- -------------------------------------------------------------
create policy "sent_emails: read via lead visibility"
  on public.sent_emails for select
  using (public.can_view_lead(sent_emails.lead_id));

-- -------------------------------------------------------------
-- notifications — strictly the recipient's own
-- -------------------------------------------------------------
create policy "notifications: read own"
  on public.notifications for select
  using (recipient_id = auth.uid());

create policy "notifications: mark own read"
  on public.notifications for update
  using (recipient_id = auth.uid());

-- -------------------------------------------------------------
-- automation_runs / steps — Operations Manager + Admin only
-- (spec: logs viewed by Ops/Admin; widening is a future item)
-- -------------------------------------------------------------
create policy "automation_runs: ops/admin read"
  on public.automation_runs for select
  using (public.is_ops_or_admin());

create policy "automation_run_steps: ops/admin read"
  on public.automation_run_steps for select
  using (public.is_ops_or_admin());
