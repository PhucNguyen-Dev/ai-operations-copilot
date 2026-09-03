-- =============================================================
-- AI Operations Copilot — Phase 2: seed data
-- Run AFTER 001_schema.sql and 002_rls.sql, BEFORE seed-users.
-- The SQL Editor runs as `postgres` (bypasses RLS) — expected.
-- Counselor/submitter assignments happen in post_seed.sql,
-- once the demo users exist.
-- =============================================================

-- -------------------------------------------------------------
-- Courses (spec Assumption 2)
-- -------------------------------------------------------------
insert into public.courses (code, name, description) values
  ('IELTS',         'IELTS Preparation',        'Intensive IELTS exam preparation course'),
  ('TOEFL',         'TOEFL Preparation',        'TOEFL iBT exam preparation course'),
  ('BUSINESS_ENG',  'Business English',         'Business English for professionals');

-- -------------------------------------------------------------
-- Fake leads — fixed UUIDs so child rows can reference them.
-- Mix: 3 HOT, 2 WARM, 2 COLD, 1 edge (minimal fields).
-- -------------------------------------------------------------
insert into public.leads (id, name, email, phone, source, course_interest, budget, timeline, message, status, created_at) values
  ('11111111-1111-1111-1111-111111111101', 'Amira Hassan',  'amira.hassan@example.com',  '+201001234567', 'facebook_ads', 'IELTS',         '800-1000 USD', '1 month',  'I need IELTS 7.5 for my master application, exam is in 6 weeks. Can you help?', 'new', now() - interval '2 hours'),
  ('11111111-1111-1111-1111-111111111102', 'Daniel Okoye',  'daniel.okoye@example.com',  '+2348012345678', 'google_ads',   'TOEFL',         '700 USD',      '2 weeks',  'Submitting TOEFL scores to a scholarship next month. Need urgent preparation.', 'new', now() - interval '5 hours'),
  ('11111111-1111-1111-1111-111111111103', 'Mei Lin',       'mei.lin@example.com',       '+8613800138000', 'referral',     'IELTS',         'Flexible',     '1 month',  'My colleague recommended your center. I want to improve from 6.0 to 7.0.', 'contacted', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111104', 'Carlos Mendez', 'carlos.mendez@example.com', '+521551234567',  'website',      'Business English', '500 USD',  '3 months', 'Interested in business English for meetings. Not in a rush.', 'new', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111105', 'Sara Ali',      'sara.ali@example.com',      '+971501234567',  'partner',      'TOEFL',         '600-800 USD',  '2 months', 'Exploring options for a fall intake. Comparing a few schools.', 'new', now() - interval '3 days'),
  ('11111111-1111-1111-1111-111111111106', 'Ivan Petrov',   'ivan.petrov@example.com',   null,            'facebook_ads', null,            null,           null,       'How much is English course?', 'lost', now() - interval '7 days'),
  ('11111111-1111-1111-1111-111111111107', 'Grace Kimani',  'grace.kimani@example.com', '+254712345678',  'website',      'Business English', 'Not sure',  '6 months', 'Just looking around for next year maybe.', 'new', now() - interval '10 days'),
  ('11111111-1111-1111-1111-111111111108', 'Edge Case',     'edge.case@example.com',     '12345',          'test',         'IELTS',         null,           null,       'Lead with malformed phone and no budget/timeline — used to test validation edges.', 'new', now() - interval '30 minutes');

-- -------------------------------------------------------------
-- AI analyses matching each lead (as n8n would persist them)
-- -------------------------------------------------------------
insert into public.lead_analyses (lead_id, score, category, intent, course, timeline, summary, recommended_action, model, created_by) values
  ('11111111-1111-1111-1111-111111111101', 92, 'HOT',  'HIGH',   'IELTS',         '1 month',  'Urgent, well-funded IELTS candidate with a hard deadline (exam in 6 weeks) and a clear target score of 7.5.', 'Contact within 30 minutes; offer intensive track.', 'gpt-4o-mini', 'n8n-pipeline'),
  ('11111111-1111-1111-1111-111111111102', 85, 'HOT',  'HIGH',   'TOEFL',         '2 weeks',  'Scholarship deadline next month; urgent TOEFL preparation request with stated budget.', 'Contact within 30 minutes; share intensive schedule.', 'gpt-4o-mini', 'n8n-pipeline'),
  ('11111111-1111-1111-1111-111111111103', 74, 'HOT',  'MEDIUM', 'IELTS',         '1 month',  'Referred lead with a concrete score goal (6.0 to 7.0) and flexible budget. Strong conversion signal.', 'Contact today; mention the referral.', 'gpt-4o-mini', 'n8n-pipeline'),
  ('11111111-1111-1111-1111-111111111104', 55, 'WARM', 'MEDIUM', 'Business English', '3 months', 'Genuine interest in Business English with a modest budget and no urgency.', 'Follow up within 48 hours with course options.', 'gpt-4o-mini', 'n8n-pipeline'),
  ('11111111-1111-1111-1111-111111111105', 48, 'WARM', 'MEDIUM', 'TOEFL',         '2 months', 'Exploratory lead comparing multiple schools for a fall intake.', 'Follow up within 48 hours; send comparison material.', 'gpt-4o-mini', 'n8n-pipeline'),
  ('11111111-1111-1111-1111-111111111106', 15, 'COLD', 'LOW',    null,            null,       'Anonymous inquiry with no contact phone, no course, no budget. Low signal.', 'Send generic info; do not prioritize.', 'gpt-4o-mini', 'n8n-pipeline'),
  ('11111111-1111-1111-1111-111111111107', 22, 'COLD', 'LOW',    'Business English', '6 months', 'Early-stage exploration for next year; no budget commitment.', 'Add to nurture list; revisit in 3 months.', 'gpt-4o-mini', 'n8n-pipeline');

-- No analysis for the edge-case lead (111...108): it represents a
-- submission that would fail validation in the real pipeline.

-- -------------------------------------------------------------
-- Follow-up tasks for HOT/WARM leads (F-010)
-- -------------------------------------------------------------
insert into public.tasks (lead_id, title, details, priority, status, due_at) values
  ('11111111-1111-1111-1111-111111111101', 'Call Amira Hassan (HOT)', 'Contact within 30 minutes — exam in 6 weeks, offer intensive IELTS track.', 'high', 'pending', now() + interval '4 hours'),
  ('11111111-1111-1111-1111-111111111102', 'Call Daniel Okoye (HOT)', 'Scholarship deadline — share intensive TOEFL schedule today.', 'high', 'pending', now() + interval '4 hours'),
  ('11111111-1111-1111-1111-111111111103', 'Call Mei Lin (HOT)',      'Mention colleague referral; discuss 6.0 → 7.0 plan.', 'high', 'in_progress', now() + interval '1 day'),
  ('11111111-1111-1111-1111-111111111104', 'Email Carlos Mendez (WARM)', 'Send Business English course options and pricing.', 'medium', 'pending', now() + interval '2 days'),
  ('11111111-1111-1111-1111-111111111105', 'Email Sara Ali (WARM)',   'Send comparison material vs. other schools.', 'medium', 'pending', now() + interval '2 days');

-- -------------------------------------------------------------
-- Sent emails — first-touch records (F-009), one dry run
-- -------------------------------------------------------------
insert into public.sent_emails (lead_id, to_address, subject, body, status, provider_message_id, sent_at) values
  ('11111111-1111-1111-1111-111111111101', 'amira.hassan@example.com', 'Your IELTS 7.5 plan — let''s start this week', 'Hi Amira, thanks for reaching out! Reaching 7.5 in six weeks is ambitious but very doable with our intensive track...', 'sent', 'gmail-msg-001', now() - interval '2 hours'),
  ('11111111-1111-1111-1111-111111111102', 'daniel.okoye@example.com', 'Urgent TOEFL prep for your scholarship deadline', 'Hi Daniel, we received your request. Our intensive TOEFL program is designed exactly for tight deadlines...', 'sent', 'gmail-msg-002', now() - interval '5 hours'),
  ('11111111-1111-1111-1111-111111111103', 'mei.lin@example.com',      'Welcome! Your referral discount for IELTS 6.0 → 7.0', 'Hi Mei, your colleague spoke highly of you — here is your personalized improvement plan...', 'dry_run', null, now() - interval '1 day');

-- -------------------------------------------------------------
-- Automation runs — 1 success (Amira) + 1 failed (edge case)
-- -------------------------------------------------------------
insert into public.automation_runs (id, workflow_name, trigger_source, lead_id, status, started_at, finished_at) values
  ('22222222-2222-2222-2222-222222222201', 'admissions-lead-pipeline', 'test-lead-ui', '11111111-1111-1111-1111-111111111101', 'success', now() - interval '2 hours', now() - interval '2 hours' + interval '25 seconds');

insert into public.automation_run_steps (run_id, feature_id, step_name, status, attempt_count, payload_snapshot, started_at, finished_at) values
  ('22222222-2222-2222-2222-222222222201', 'F-003', 'Lead validation',      'success', 1, '{"required_fields": true, "email_format": "valid"}', now() - interval '2 hours', now() - interval '2 hours' + interval '1 second'),
  ('22222222-2222-2222-2222-222222222201', 'F-004', 'AI lead analysis',     'success', 1, '{"score": 92, "category": "HOT"}', now() - interval '2 hours' + interval '1 second', now() - interval '2 hours' + interval '12 seconds'),
  ('22222222-2222-2222-2222-222222222201', 'F-007', 'CRM storage',          'success', 1, '{"leads": 1, "lead_analyses": 1}', now() - interval '2 hours' + interval '12 seconds', now() - interval '2 hours' + interval '14 seconds'),
  ('22222222-2222-2222-2222-222222222201', 'F-008', 'AI response draft',    'success', 1, '{"subject_chars": 48}', now() - interval '2 hours' + interval '14 seconds', now() - interval '2 hours' + interval '20 seconds'),
  ('22222222-2222-2222-2222-222222222201', 'F-009', 'Email send',           'success', 1, '{"provider_message_id": "gmail-msg-001"}', now() - interval '2 hours' + interval '20 seconds', now() - interval '2 hours' + interval '22 seconds'),
  ('22222222-2222-2222-2222-222222222201', 'F-010', 'Follow-up task',       'success', 1, '{"priority": "high"}', now() - interval '2 hours' + interval '22 seconds', now() - interval '2 hours' + interval '23 seconds'),
  ('22222222-2222-2222-2222-222222222201', 'F-011', 'Counselor notify',     'success', 1, '{"in_app": true, "email_copy": true}', now() - interval '2 hours' + interval '23 seconds', now() - interval '2 hours' + interval '25 seconds');

-- Failed run: the edge-case lead died at validation (F-003)
insert into public.automation_runs (id, workflow_name, trigger_source, lead_id, status, error_summary, started_at, finished_at) values
  ('22222222-2222-2222-2222-222222222202', 'admissions-lead-pipeline', 'test-lead-ui', null, 'failed', 'Permanent failure at F-003: phone format invalid', now() - interval '30 minutes', now() - interval '30 minutes' + interval '2 seconds');

insert into public.automation_run_steps (run_id, feature_id, step_name, status, attempt_count, payload_snapshot, error_detail, started_at, finished_at) values
  ('22222222-2222-2222-2222-222222222202', 'F-003', 'Lead validation', 'failed', 1, '{"phone": "12345"}', 'Phone format invalid — permanent, no retry', now() - interval '30 minutes', now() - interval '30 minutes' + interval '2 seconds');
