-- =============================================================
-- AI Operations Copilot — post-seed assignments
-- Run AFTER scripts/seed-users.mjs (needs the demo profiles to
-- exist). Assigns counselor/submitter references that seed.sql
-- could not know in advance, and creates counselor notifications.
-- Run once; safe to re-run (guards against duplicates).
-- =============================================================

-- All seeded leads were submitted by the admin (Test Lead intake)
update public.leads
set submitted_by = (select id from public.profiles where email = 'admin@demo.dev')
where submitted_by is null;

-- Counselor is assigned every HOT/WARM lead; COLD/edge stay unassigned
update public.leads
set assigned_counselor_id = (select id from public.profiles where email = 'counselor@demo.dev')
where id in (
  '11111111-1111-1111-1111-111111111101',
  '11111111-1111-1111-1111-111111111102',
  '11111111-1111-1111-1111-111111111103',
  '11111111-1111-1111-1111-111111111104',
  '11111111-1111-1111-1111-111111111105'
);

update public.tasks
set assigned_counselor_id = (select id from public.profiles where email = 'counselor@demo.dev')
where assigned_counselor_id is null;

-- In-app notifications for the counselor (guard: insert once)
insert into public.notifications (recipient_id, lead_id, type, title, body)
select
  (select id from public.profiles where email = 'counselor@demo.dev'),
  l.id,
  'new_lead',
  'New ' || a.category || ' lead: ' || l.name,
  'Score ' || a.score || ' — ' || a.recommended_action
from public.leads l
join public.lead_analyses a on a.lead_id = l.id
where a.category in ('HOT', 'WARM')
  and not exists (
    select 1 from public.notifications n
    where n.lead_id = l.id and n.type = 'new_lead'
  );
