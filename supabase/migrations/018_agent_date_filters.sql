-- Enforce relative-period reporting at the requester-read boundary.
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
        and (p_args ->> 'created_after' is null or l.created_at >= (p_args ->> 'created_after')::timestamptz)
          and (p_args ->> 'created_before' is null or l.created_at < (p_args ->> 'created_before')::timestamptz)
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

revoke execute on function public.agent_requester_read(uuid, text, jsonb) from public;
grant execute on function public.agent_requester_read(uuid, text, jsonb) to service_role;
