import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const { PGlite } = await (async () => {
  const base = process.env.PGLITE_MODULE_PATH
  const req = createRequire(base ? join(base, 'noop.js') : import.meta.url)
  return { PGlite: (await req('@electric-sql/pglite')).PGlite }
})()
const { pgcrypto } = await (async () => {
  const base = process.env.PGLITE_MODULE_PATH
  const req = createRequire(base ? join(base, 'noop.js') : import.meta.url)
  return { pgcrypto: (await req('@electric-sql/pglite/contrib/pgcrypto')).pgcrypto }
})()
const { vector } = await (async () => {
  const base = process.env.PGLITE_MODULE_PATH
  const req = createRequire(base ? join(base, 'noop.js') : import.meta.url)
  return { vector: (await req('@electric-sql/pglite-pgvector')).vector }
})()

const db = new PGlite({ extensions: { pgcrypto, vector } })
const counts = { migrations: 0, passed: 0, failed: 0, queries: 0, execs: 0 }
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = uid(1), other = uid(2), admin = uid(3)
const run = uid(10), opsRun = uid(11), ambiguousRun = uid(12), decidedRun = uid(13)
const lead = uid(20), hiddenLead = uid(21), emptyLead = uid(22)
const approval = uid(30)
const embedding = `[${[1, ...Array(767).fill(0)].join(',')}]`
const orthogonal = `[${[0, 1, ...Array(766).fill(0)].join(',')}]`
async function exec(sql) { counts.execs++; return db.exec(sql) }
async function query(sql, args = []) { counts.queries++; return (await db.query(sql, args)).rows }
async function scalar(sql, args = []) { return (await query(sql, args))[0]?.value }
async function test(name, fn) {
  try { await fn(); counts.passed++; console.log(`PASS ${name}`) }
  catch (e) { counts.failed++; console.log(`FAIL ${name}: ${e.code || ''} ${e.message}`) }
}
async function migration(file) {
  await exec(await readFile(join(root, 'supabase', 'migrations', file), 'utf8'))
  counts.migrations++
  console.log(`MIGRATION PASS ${file}`)
}
async function rpc(op, args = {}, id = run) {
  return scalar('select public.agent_requester_read($1::uuid, $2::text, $3::jsonb) as value', [id, op, JSON.stringify(args)])
}
async function denied(sql, args = [], pattern = /permission denied/) {
  await assert.rejects(() => query(sql, args), pattern)
}
try {
  await exec(`
    create schema auth;
    create schema extensions;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public, auth, extensions to anon, authenticated, service_role;
    create table auth.users (
      id uuid primary key, email text not null,
      raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{}',
      app_metadata jsonb generated always as (raw_app_meta_data) stored
    );
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt() ->> 'sub')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select auth.jwt() ->> 'role'
    $$;
    set search_path = public, extensions;
  `)
  for (const file of ['001_schema.sql', '002_rls.sql', '010_agent_core.sql', '011_knowledge_rag.sql']) await migration(file)
  await query(`insert into auth.users(id,email,raw_app_meta_data) values
    ($1,'requester@example.invalid','{"role":"admissions"}'),
    ($2,'other@example.invalid','{"role":"admissions"}'),
    ($3,'admin@example.invalid','{"role":"admin"}')`, [user, other, admin])
  await query(`insert into public.agent_runs(id,agent_id,user_id,user_role,goal,status,max_steps) values
    ($1,'synthetic',$5,'admissions','synthetic','awaiting_approval',10),
    ($2,'synthetic',$6,'admin','synthetic','running',10),
    ($3,'synthetic',$5,'admissions','synthetic','awaiting_approval',10),
    ($4,'synthetic',$5,'admissions','synthetic','awaiting_approval',10)`, [run, opsRun, ambiguousRun, decidedRun, user, admin])
  await query(`insert into public.agent_approvals(id,run_id,tool_name,requested_by,requested_at,status,decided_by) values
    ($1,$2,'synthetic',$5,now()-interval '10 seconds','pending',null),
    ($6,$3,'synthetic',$5,now(),'pending',null),
    ($7,$3,'synthetic',$5,now(),'pending',null),
    ($8,$4,'synthetic',$5,now(),'approved',$9)`, [approval, run, ambiguousRun, decidedRun, user, uid(31), uid(32), uid(33), admin])
  await migration('015_approval_resume.sql')
  await test('legacy single pending backfilled; ambiguous and decided left untouched', async () => {
    const rows = await query('select id,pending_approval_id,approval_wait_started_at from agent_runs order by id')
    assert.equal(rows[0].pending_approval_id, approval)
    assert.ok(rows[0].approval_wait_started_at)
    assert.equal(rows[2].pending_approval_id, null)
    assert.equal(rows[3].pending_approval_id, null)
  })
  await query(`insert into leads(id,name,email,assigned_counselor_id,created_at,status) values
    ($1,'Synthetic visible','visible@example.invalid',$4,'2026-01-02','new'),
    ($2,'Synthetic hidden','hidden@example.invalid',$5,'2026-01-03','contacted'),
    ($3,'Synthetic empty','empty@example.invalid',$4,'2026-01-01','new')`, [lead, hiddenLead, emptyLead, user, other])
  await query(`insert into lead_analyses(lead_id,score,category,intent,summary,created_at)
    select $1,80+i,'HOT','HIGH','Synthetic analysis '||i, '2026-01-01'::timestamptz + i*interval '1 day' from generate_series(1,7) i`, [lead])
  await query(`insert into tasks(lead_id,title,created_at)
    select $1,'Synthetic task '||i,'2026-01-01'::timestamptz+i*interval '1 day' from generate_series(1,12) i`, [lead])
  await query(`insert into sent_emails(lead_id,to_address,subject,body,created_at)
    select $1,'synthetic@example.invalid','Synthetic email '||i,'synthetic','2026-01-01'::timestamptz+i*interval '1 day' from generate_series(1,12) i`, [lead])
  await exec('delete from knowledge_docs')
  await query(`insert into knowledge_docs(id,title,doc_type,department,content,allowed_roles,is_active) values
    ($1,'Synthetic needle public','sop','admissions','needle public','{all}',true),
    ($2,'Synthetic needle admin','policy','operations','needle admin','{admin}',true),
    ($3,'Synthetic needle inactive','faq','admissions','needle inactive','{all}',false),
    ($4,'Synthetic needle academic','course_info','academic','needle academic','{admissions}',true)`, [uid(40),uid(41),uid(42),uid(43)])
  await query(`insert into knowledge_chunks(doc_id,chunk_index,content,embedding) values
    ($1,0,'needle public',$5::extensions.vector),($2,0,'needle admin',$5::extensions.vector),
    ($3,0,'needle inactive',$5::extensions.vector),($4,0,'needle academic',$6::extensions.vector)`, [uid(40),uid(41),uid(42),uid(43),embedding,orthogonal])
  await query(`insert into agent_run_steps(run_id,step_index,status,tool_name) values ($1,1,'approval_required','synthetic')`, [run])
  await exec(`insert into agent_tool_config(tool_name) values ('synthetic');
    update agent_tool_config set enabled=false where tool_name='synthetic';
    update agent_runtime_config set kill_switch=true where id=1;
    grant select on all tables in schema public to anon, authenticated;
    grant all on all tables in schema public to service_role;
    set search_path = public;
  `)
  await test('table inserts/updates and vector dimensions/index', async () => {
    assert.equal(await scalar('select vector_dims(embedding) as value from knowledge_chunks limit 1'.replace('vector_dims','extensions.vector_dims')),768)
    assert.equal(await scalar("select count(*)::int as value from pg_indexes where indexname='knowledge_chunks_embedding_idx' and indexdef like '%hnsw%'"),1)
    assert.equal(await scalar("select enabled as value from agent_tool_config where tool_name='synthetic'"),false)
    assert.equal(await scalar('select kill_switch as value from agent_runtime_config where id=1'),true)
    assert.equal(await scalar('select count(*)::int as value from agent_run_steps'),1)
  })
  await exec('set role service_role')
  await test('service_role calls principal with persisted requester, not approver', async () => {
    assert.deepEqual(await rpc('principal'),{user_id:user,user_role:'admissions'})
  })
  await test('visible lead is JSON object; hidden/missing are SQL null', async () => {
    const value = await rpc('lead',{lead_id:lead})
    assert.equal(typeof value,'object'); assert.equal(value.id,lead); assert.equal(value.email,'visible@example.invalid')
    assert.equal(await rpc('lead',{lead_id:hiddenLead}),null)
    assert.equal(await rpc('lead',{lead_id:uid(999)}),null)
    assert.equal(await scalar('select agent_run_can_see_lead($1,$2) as value',[run,hiddenLead]),false)
    assert.equal((await rpc('lead',{lead_id:hiddenLead},opsRun)).id,hiddenLead)
  })
  await test('search array, ordering, filters, limit, nested analyses, empty result', async () => {
    const values = await rpc('search_leads')
    assert.deepEqual(values.map(x=>x.id),[lead,emptyLead])
    assert.equal(values[0].lead_analyses.length,7)
    assert.deepEqual(values[1].lead_analyses,[])
    assert.equal((await rpc('search_leads',{category:'HOT',status:'new',limit:1})).length,1)
    assert.deepEqual(await rpc('search_leads',{status:'lost'}),[])
  })
  for (const [op,length,field,value] of [['lead_analyses',5,'score',87],['lead_tasks',10,'title','Synthetic task 12'],['lead_emails',10,'subject','Synthetic email 12']]) {
    await test(`${op} array, newest first, cap, empty vs unauthorized`, async () => {
      const rows=await rpc(op,{lead_id:lead}); assert.ok(Array.isArray(rows)); assert.equal(rows.length,length); assert.equal(rows[0][field],value)
      assert.deepEqual(await rpc(op,{lead_id:emptyLead}),[])
      assert.equal(await rpc(op,{lead_id:hiddenLead}),null)
    })
  }
  await test('knowledge keyword ILIKE and department operator', async () => {
    const rows=await rpc('knowledge_keyword',{query:'NEEDLE',department:'admissions'})
    assert.deepEqual(rows.map(x=>x.title),['Synthetic needle public'])
    assert.equal((await rpc('knowledge_keyword',{query:'needle'})).length,3)
    assert.deepEqual(await rpc('knowledge_keyword',{query:'nonexistent'}),[])
  })
  await test('semantic SQL path resolves vector operator with public-only caller search_path', async () => {
    const rows=await rpc('knowledge_match',{query_embedding:embedding,match_count:10})
    assert.deepEqual(rows.map(x=>x.doc_id),[uid(40),uid(43)])
    assert.equal(rows[0].similarity,1); assert.equal(rows[1].similarity,0)
    assert.equal((await rpc('knowledge_match',{query_embedding:embedding,match_count:1})).length,1)
  })
  await test('pending approval cannot be claimed', async () => {
    assert.equal(await scalar('select (claim_agent_approval($1,$2)).id as value',[run,approval]),null)
  })
  await query('update agent_approvals set status=\'approved\',decided_by=$2,decided_at=now() where id=$1',[approval,admin])
  await test('wrong run cannot claim approval', async () => {
    assert.equal(await scalar('select (claim_agent_approval($1,$2)).id as value',[opsRun,approval]),null)
  })
  await test('approved claim once, duplicate null, exact human wait accumulation', async () => {
    await exec('begin')
    try {
      await query("update agent_runs set approval_wait_ms=250,approval_wait_started_at=now()-interval '10 seconds' where id=$1",[run])
      const value=await scalar('select to_jsonb(claim_agent_approval($1,$2)) as value',[run,approval])
      assert.equal(value.status,'running'); assert.equal(value.approval_wait_ms,10250); assert.equal(value.approval_wait_started_at,null)
      assert.equal(await scalar('select (claim_agent_approval($1,$2)).id as value',[run,approval]),null)
      assert.equal(await scalar('select approval_wait_ms::int as value from agent_runs where id=$1',[run]),10250)
      assert.ok(await scalar('select execution_claimed_at as value from agent_approvals where id=$1',[approval]))
    } finally { await exec('commit') }
  })
  const second=uid(34)
  await query("insert into agent_approvals(id,run_id,tool_name,requested_by,status,decided_by) values ($1,$2,'synthetic',$3,'rejected',$4)",[second,run,user,admin])
  await test('rejected second approval resumes and adds wait, not overwrites', async () => {
    await exec('begin')
    try {
      await query("update agent_runs set status='awaiting_approval',pending_approval_id=$2,approval_wait_started_at=now()-interval '2 seconds' where id=$1",[run,second])
      const value=await scalar('select to_jsonb(claim_agent_approval($1,$2)) as value',[run,second])
      assert.equal(value.approval_wait_ms,12250); assert.equal(value.status,'running')
    } finally { await exec('commit') }
  })
  const third=uid(35)
  await query("insert into agent_approvals(id,run_id,tool_name,requested_by,status,decided_by) values ($1,$2,'synthetic',$3,'approved',$3)",[third,run,user])
  await query("update agent_runs set status='awaiting_approval',pending_approval_id=$2,approval_wait_started_at=now() where id=$1",[run,third])
  await test('self approval cannot be claimed', async () => {
    assert.equal(await scalar('select (claim_agent_approval($1,$2)).id as value',[run,third]),null)
  })
  await exec('reset role')
  await query("update auth.users set raw_app_meta_data='{}' where id=$1",[user])
  await exec('set role service_role')
  await test('missing authoritative role fails closed', async () => {
    await assert.rejects(()=>rpc('principal'),/REQUESTER_AUTHORIZATION_FAILED/)
    assert.equal(await scalar('select agent_run_can_see_lead($1,$2) as value',[run,lead]),false)
  })
  await exec('reset role')
  await query(`update auth.users set raw_app_meta_data='{"role":"teacher"}' where id=$1`,[user])
  await exec('set role service_role')
  await test('role drift fails closed', async () => { await assert.rejects(()=>rpc('lead',{lead_id:lead}),/REQUESTER_AUTHORIZATION_FAILED/) })
  await exec('reset role')
  await query(`update auth.users set raw_app_meta_data='{"role":"admissions"}' where id=$1`,[user])
  await exec('set role service_role')
  await test('missing run and unsupported operation fail closed', async () => {
    await assert.rejects(()=>rpc('principal',{},uid(999)),/run not found/)
    await assert.rejects(()=>rpc('unsupported'),/unsupported operation/)
  })
  await exec('reset role')
  for (const role of ['anon','authenticated']) {
    await exec(`set role ${role}`)
    await query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(role==='anon'?{role:'anon'}:{role:'authenticated',sub:other,app_metadata:{role:'admissions'}})])
    for (const [name,sql,args] of [
      ['principal','select agent_requester_read($1,\'principal\')',[run]],
      ['visibility','select agent_run_can_see_lead($1,$2)',[run,lead]],
      ['claim','select claim_agent_approval($1,$2)',[run,third]]
    ]) await test(`${role} denied ${name} RPC`,()=>denied(sql,args))
    await test(`${role} RLS cannot read requester run or approvals`,async()=>{
      assert.equal(await scalar('select count(*)::int as value from agent_runs where id=$1',[run]),0)
      assert.equal(await scalar('select count(*)::int as value from agent_approvals where run_id=$1',[run]),0)
    })
    await exec('reset role')
  }
  await exec('set role authenticated')
  await query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:user,app_metadata:{role:'admissions'}})])
  await test('authenticated owner RLS can read own run/steps, not another run',async()=>{
    assert.equal(await scalar('select count(*)::int as value from agent_runs where id=$1',[run]),1)
    assert.equal(await scalar('select count(*)::int as value from agent_run_steps where run_id=$1',[run]),1)
    assert.equal(await scalar('select count(*)::int as value from agent_runs where id=$1',[opsRun]),0)
  })
  await exec('reset role')
  await test('015 rerun preserves accumulated wait and claims',async()=>{
    await exec(await readFile(join(root,'supabase','migrations','015_approval_resume.sql'),'utf8'))
    assert.equal(await scalar('select approval_wait_ms::int as value from agent_runs where id=$1',[run]),12250)
    assert.ok(await scalar('select execution_claimed_at as value from agent_approvals where id=$1',[approval]))
  })
} catch(e) {
  counts.failed++
  console.error(`FATAL ${e.code || ''} ${e.message}`)
} finally {
  console.log(JSON.stringify(counts))
  console.log('Environment fixtures: auth helpers/users with generated app_metadata alias for historic 001; Supabase roles/grants; extensions search_path during 011 creation. No migration functions mocked. Five selected migrations; 003-009/012-014 not required for these paths. In-memory single connection; no real concurrent transaction verification.')
  await db.close()
  process.exitCode=counts.failed?1:0
}
