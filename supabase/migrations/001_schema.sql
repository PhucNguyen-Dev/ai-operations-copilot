-- =============================================================
-- AI Operations Copilot — Phase 2: schema
-- Run order in Supabase SQL Editor: 001_schema.sql → 002_rls.sql → seed.sql
-- (post_seed.sql runs LAST, after scripts/seed-users.mjs)
-- =============================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- Enums
-- -------------------------------------------------------------
create type staff_role        as enum ('admin', 'marketing', 'admissions', 'teacher', 'operations');
create type lead_status       as enum ('new', 'contacted', 'converted', 'lost');
create type lead_category     as enum ('HOT', 'WARM', 'COLD');
create type lead_intent       as enum ('HIGH', 'MEDIUM', 'LOW');
create type task_status       as enum ('pending', 'in_progress', 'done');
create type email_status      as enum ('sent', 'failed', 'dry_run');
create type run_status        as enum ('running', 'success', 'failed');
create type step_status       as enum ('success', 'failed', 'retried', 'skipped');
create type notification_type as enum ('new_lead', 'task_assigned', 'system');

-- -------------------------------------------------------------
-- profiles — one row per auth user (auto-created by trigger)
-- role here is a mirror for listing/assignment; the JWT
-- app_metadata.role is the RLS authority (AD-11).
-- -------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null,
  role       staff_role not null default 'admissions',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce((new.app_metadata ->> 'role')::staff_role, 'admissions')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- courses — seeded catalog (spec Assumption 2)
-- -------------------------------------------------------------
create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- -------------------------------------------------------------
-- leads
-- -------------------------------------------------------------
create table public.leads (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  email                 text not null,
  phone                 text,
  source                text not null default 'test',
  course_interest       text,
  budget                text,
  timeline              text,
  message               text,
  status                lead_status not null default 'new',
  submitted_by          uuid references public.profiles (id),
  assigned_counselor_id uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index leads_created_at_idx     on public.leads (created_at desc);
create index leads_status_idx         on public.leads (status);
create index leads_assigned_counselor_idx on public.leads (assigned_counselor_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------
-- lead_analyses — AI output contract (F-004), one per analysis
-- -------------------------------------------------------------
create table public.lead_analyses (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references public.leads (id) on delete cascade,
  score              integer not null check (score between 0 and 100),
  category           lead_category not null,
  intent             lead_intent not null,
  course             text,
  timeline           text,
  summary            text,
  recommended_action text,
  model              text,
  raw_response       jsonb,
  created_by         text not null default 'n8n-pipeline',
  created_at         timestamptz not null default now()
);

create index lead_analyses_lead_id_idx on public.lead_analyses (lead_id);

-- -------------------------------------------------------------
-- tasks — follow-up tasks (F-010)
-- -------------------------------------------------------------
create table public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references public.leads (id) on delete cascade,
  assigned_counselor_id uuid references public.profiles (id),
  title                 text not null,
  details               text,
  priority              text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status                task_status not null default 'pending',
  due_at                timestamptz,
  created_by            text not null default 'n8n-pipeline',
  created_at            timestamptz not null default now()
);

create index tasks_lead_id_idx    on public.tasks (lead_id);
create index tasks_assignee_idx   on public.tasks (assigned_counselor_id, status);

-- -------------------------------------------------------------
-- sent_emails — record of automated sends (F-009), incl. dry runs
-- -------------------------------------------------------------
create table public.sent_emails (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null references public.leads (id) on delete cascade,
  to_address          text not null,
  subject             text not null,
  body                text not null,
  status              email_status not null default 'sent',
  provider_message_id text,
  sent_at             timestamptz,
  created_by          text not null default 'n8n-pipeline',
  created_at          timestamptz not null default now()
);

create index sent_emails_lead_id_idx on public.sent_emails (lead_id);

-- -------------------------------------------------------------
-- notifications — in-app counselor notifications (F-011)
-- -------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  lead_id      uuid references public.leads (id) on delete cascade,
  type         notification_type not null default 'system',
  title        text not null,
  body         text,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_id, is_read);

-- -------------------------------------------------------------
-- automation_runs — one row per pipeline execution (F-012)
-- lead_id is nullable: leads that fail validation never persist
-- a lead row, but their failed run must still exist.
-- -------------------------------------------------------------
create table public.automation_runs (
  id             uuid primary key default gen_random_uuid(),
  workflow_name  text not null default 'admissions-lead-pipeline',
  trigger_source text not null default 'test-lead-ui',
  lead_id        uuid references public.leads (id) on delete set null,
  status         run_status not null default 'running',
  error_summary  text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index automation_runs_status_idx     on public.automation_runs (status);
create index automation_runs_started_at_idx on public.automation_runs (started_at desc);

-- -------------------------------------------------------------
-- automation_run_steps — one row per pipeline step (F-003…F-011)
-- -------------------------------------------------------------
create table public.automation_run_steps (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.automation_runs (id) on delete cascade,
  feature_id       text not null,
  step_name        text not null,
  status           step_status not null default 'success',
  attempt_count    integer not null default 1,
  payload_snapshot jsonb,
  error_detail     text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index automation_run_steps_run_id_idx on public.automation_run_steps (run_id);
