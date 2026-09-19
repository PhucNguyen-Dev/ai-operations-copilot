alter table public.agent_runs
  add column if not exists approval_wait_ms bigint not null default 0;
alter table public.agent_runs
  add column if not exists approval_wait_started_at timestamptz;
alter table public.agent_runs
  add column if not exists pending_approval_id uuid;
alter table public.agent_approvals
  add column if not exists execution_claimed_at timestamptz;

update public.agent_runs r
set pending_approval_id = a.id,
    approval_wait_started_at = a.requested_at
from public.agent_approvals a
where r.status = 'awaiting_approval'
  and r.pending_approval_id is null
  and a.run_id = r.id
  and a.status = 'pending'
  and (select count(*) from public.agent_approvals p where p.run_id = r.id and p.status = 'pending') = 1;

create or replace function public.claim_agent_approval(
  p_run_id uuid,
  p_approval_id uuid
)
returns public.agent_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.agent_runs;
begin
  update public.agent_approvals a
  set execution_claimed_at = now()
  where a.id = p_approval_id
    and a.execution_claimed_at is null
    and a.status in ('approved', 'rejected')
    and a.decided_by is not null
    and a.decided_by <> a.requested_by
    and exists (
      select 1 from public.agent_runs r
      where r.id = p_run_id
        and r.id = a.run_id
        and r.status = 'awaiting_approval'
        and r.pending_approval_id = a.id
        and r.approval_wait_started_at is not null
        and r.user_id = a.requested_by
    );
  if not found then
    return null;
  end if;

  update public.agent_runs r
  set status = 'running',
      approval_wait_ms = r.approval_wait_ms
        + greatest(0, extract(epoch from (now() - r.approval_wait_started_at)) * 1000)::bigint,
      approval_wait_started_at = null
  where r.id = p_run_id
    and r.status = 'awaiting_approval'
    and r.pending_approval_id = p_approval_id
    and r.approval_wait_started_at is not null
  returning * into claimed;

  if claimed is null then
    update public.agent_approvals
    set execution_claimed_at = null
    where id = p_approval_id
      and exists (
        select 1 from public.agent_runs
        where id = p_run_id and status = 'awaiting_approval'
      );
    return null;
  end if;

  return claimed;
end;
$$;

create or replace function public.agent_run_can_see_lead(
  p_run_id uuid,
  p_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agent_runs r
    join auth.users u on u.id = r.user_id
    join public.leads l on l.id = p_lead_id
    where r.id = p_run_id
      and coalesce(u.raw_app_meta_data ->> 'role', '') = r.user_role
      and (
        r.user_role in ('operations', 'admin')
        or l.assigned_counselor_id = r.user_id
      )
  )
$$;

create or replace function public.agent_requester_read(
  p_run_id uuid,
  p_operation text,
  p_args jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  r public.agent_runs;
  requester_role text;
  lead_json jsonb;
begin
  select * into r from public.agent_runs where id = p_run_id;
  if not found then
    raise exception 'REQUESTER_AUTHORIZATION_FAILED: run not found';
  end if;

  select coalesce(u.raw_app_meta_data ->> 'role', '') into requester_role
  from auth.users u
  where u.id = r.user_id;
  if requester_role is null or requester_role = '' or requester_role <> r.user_role then
    raise exception 'REQUESTER_AUTHORIZATION_FAILED: persisted principal does not match the authoritative role';
  end if;

  if p_operation = 'principal' then
    return jsonb_build_object('user_id', r.user_id, 'user_role', requester_role);
  elsif p_operation = 'lead' then
    select to_jsonb(l) into lead_json
    from public.leads l
    where l.id = (p_args ->> 'lead_id')::uuid
      and public.agent_run_can_see_lead(p_run_id, l.id);
    if not found then
      return null;
    end if;
    return lead_json;
  elsif p_operation = 'search_leads' then
    return to_jsonb(coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select l.id, l.name, l.email, l.phone, l.source, l.status, l.course_interest, l.created_at,
          (select coalesce(jsonb_agg(jsonb_build_object('score', a.score, 'category', a.category, 'intent', a.intent)), '[]'::jsonb)
           from public.lead_analyses a where a.lead_id = l.id) as lead_analyses
        from public.leads l
        where public.agent_run_can_see_lead(p_run_id, l.id)
          and (p_args ->> 'status' is null or l.status = (p_args ->> 'status')::lead_status)
          and (p_args ->> 'category' is null or exists (
            select 1 from public.lead_analyses a
            where a.lead_id = l.id and a.category = (p_args ->> 'category')::lead_category
          ))
        order by l.created_at desc
        limit coalesce((p_args ->> 'limit')::int, 10)
      ) x), '[]'::jsonb));
  elsif p_operation = 'lead_analyses' then
    if not public.agent_run_can_see_lead(p_run_id, (p_args ->> 'lead_id')::uuid) then
      return null;
    end if;
    return to_jsonb(coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select score, category, intent, summary, recommended_action, created_at
        from public.lead_analyses
        where lead_id = (p_args ->> 'lead_id')::uuid
        order by created_at desc
        limit 5
      ) x), '[]'::jsonb));
  elsif p_operation = 'lead_tasks' then
    if not public.agent_run_can_see_lead(p_run_id, (p_args ->> 'lead_id')::uuid) then
      return null;
    end if;
    return to_jsonb(coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select id, title, priority, status, due_at, created_at
        from public.tasks
        where lead_id = (p_args ->> 'lead_id')::uuid
        order by created_at desc
        limit 10
      ) x), '[]'::jsonb));
  elsif p_operation = 'lead_emails' then
    if not public.agent_run_can_see_lead(p_run_id, (p_args ->> 'lead_id')::uuid) then
      return null;
    end if;
    return to_jsonb(coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select id, to_address, subject, status, created_at
        from public.sent_emails
        where lead_id = (p_args ->> 'lead_id')::uuid
        order by created_at desc
        limit 10
      ) x), '[]'::jsonb));
  elsif p_operation = 'knowledge_match' then
    return to_jsonb((
      select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
      from public.match_knowledge_chunks(
        (p_args ->> 'query_embedding')::extensions.vector,
        coalesce((p_args ->> 'match_count')::int, 3),
        requester_role
      ) m
    ));
  elsif p_operation = 'knowledge_keyword' then
    return to_jsonb(coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select title, doc_type, department, content, allowed_roles
        from public.knowledge_docs
        where is_active
          and (title ilike '%' || (p_args ->> 'query') || '%' or content ilike '%' || (p_args ->> 'query') || '%')
          and (p_args ->> 'department' is null or department = p_args ->> 'department')
        limit 10
      ) x), '[]'::jsonb));
  else
    raise exception 'REQUESTER_AUTHORIZATION_FAILED: unsupported operation %', p_operation;
  end if;
end;
$$;

revoke execute on function public.claim_agent_approval(uuid, uuid) from public;
grant execute on function public.claim_agent_approval(uuid, uuid) to service_role;
revoke execute on function public.agent_run_can_see_lead(uuid, uuid) from public;
grant execute on function public.agent_run_can_see_lead(uuid, uuid) to service_role;
revoke execute on function public.agent_requester_read(uuid, text, jsonb) from public;
grant execute on function public.agent_requester_read(uuid, text, jsonb) to service_role;
