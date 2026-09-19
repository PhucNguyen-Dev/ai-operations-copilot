-- =============================================================
-- 020 — Briefing scheduled path: the narrow compute door
--
-- The scheduled briefing path runs as a DEDICATED MACHINE IDENTITY,
-- never as a human: the machine identity IS the agent_api_clients
-- credential (hashed, revocable, rate-limited) — runs are attributed
-- to the target operator (user_id), the client (client_id) and
-- user_role='system', so the audit trail honestly says "the machine
-- asked, computing with this operator's visibility". No synthetic
-- profile row exists — profiles.id must reference a real auth user.
-- Trust model:
--   * The route (app/api/external/briefing) allows ONLY the
--     'briefing.generate' scope and ONLY ops/admin target users.
--   * Data access goes through compute_daily_briefing(): one
--     security definer function returning BRIEFING-SHAPED DATA ONLY
--     (counts + top-5 priority leads + pending approvals). Base-table
--     RLS is untouched: a leaked credential can call ONE function
--     that returns a summary — it cannot query leads, agent runs,
--     tasks, or write anything.
-- Idempotent; additive; nothing existing is altered.
-- =============================================================

-- The one narrow door: briefing-shaped data only.
-- SECURITY DEFINER is required to read across RLS for an arbitrary
-- target operator; the surface is deliberately minimal (no inputs
-- except the target user, output limited to the briefing shape).
create or replace function public.compute_daily_briefing(p_target_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with visible_leads as (
    select l.id, l.name, l.email, l.status, l.course_interest, l.timeline, l.budget, l.created_at,
      (select a.score from public.lead_analyses a where a.lead_id = l.id order by a.created_at desc limit 1) as score,
      (select a.category from public.lead_analyses a where a.lead_id = l.id order by a.created_at desc limit 1) as category,
      (select a.intent from public.lead_analyses a where a.lead_id = l.id order by a.created_at desc limit 1) as intent,
      (select a.recommended_action from public.lead_analyses a where a.lead_id = l.id order by a.created_at desc limit 1) as recommended_action,
      (select count(*) from public.tasks t where t.lead_id = l.id and t.status <> 'done') as open_tasks,
      (select t.due_at from public.tasks t where t.lead_id = l.id and t.status <> 'done' and t.due_at < date_trunc('day', now()) order by t.due_at limit 1) as overdue_due_at
    from public.leads l
    where
      -- Mirror RLS visibility for the target: ops/admin see all;
      -- counselors see assigned leads (same predicate as policies).
      exists (
        select 1
        from auth.users u
        where u.id = p_target_user
          and (
            coalesce(u.raw_app_meta_data ->> 'role', '') in ('admin', 'operations')
            or l.assigned_counselor_id = p_target_user
          )
      )
  ),
  counts as (
    select
      count(*)::int as total,
      count(*) filter (where (open_tasks = 0 and category is not null) or (category is null and status = 'new'))::int as needs_action,
      count(*) filter (where exists (
        select 1 from public.tasks t
        where t.lead_id = visible_leads.id and t.status <> 'done'
          and t.due_at >= date_trunc('day', now()) and t.due_at < date_trunc('day', now()) + interval '1 day'
      ))::int as followups_due,
      count(*) filter (where overdue_due_at is not null)::int as at_risk
    from visible_leads
  ),
  top_leads as (
    select id, name, email, status, course_interest, category, score, intent, recommended_action, overdue_due_at
    from visible_leads
    where overdue_due_at is not null
       or (open_tasks = 0 and category = 'HOT')
       or open_tasks = 0
    order by
      (overdue_due_at is not null) desc,
      (open_tasks = 0 and category = 'HOT') desc,
      coalesce(score, 0) desc
    limit 5
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'needsAction', c.needs_action,
      'followUpsDue', c.followups_due,
      'atRisk', c.at_risk,
      'total', c.total,
      'pendingApprovals', (select count(*)::int from public.agent_approvals where status = 'pending')
    ),
    'priorityLeads', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'email', t.email, 'status', t.status,
        'course_interest', t.course_interest, 'category', t.category,
        'score', t.score, 'intent', t.intent,
        'recommended_action', t.recommended_action,
        'overdue_due_at', t.overdue_due_at
      ) order by (t.overdue_due_at is not null) desc, coalesce(t.score, 0) desc)
       from top_leads t),
      '[]'::jsonb
    )
  )
  from counts c;
$$;

revoke execute on function public.compute_daily_briefing(uuid) from public, anon, authenticated;
grant execute on function public.compute_daily_briefing(uuid) to service_role;
