'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cardsFromSteps, type ChatStep } from '@/lib/chat/cards'
import { RichCards } from '@/components/chat/cards'
import { StepTrace } from '@/components/chat/StepTrace'
import { startStreamedRun } from '@/lib/agent/run-stream-client'
import type { RuntimeEvent } from '@/lib/agent/runtime'

export type ChatTrace={run:{id?:string;goal?:string;status:string;final_outcome:string|null;error?:string|null;tokens_in:number;tokens_out:number;cancel_requested_at?:string|null;cancelled_by?:string|null};steps:ChatStep[];approvals:Record<string,unknown>[]}
// Migration 024 — one phrasing for a stopped run, used everywhere it can
// be rendered (stream event, resolved output, stop acknowledgement).
// Deliberately says what DID happen: the trace holds the steps that ran.
const CANCELLED_TEXT='Stopped. Steps that already ran are in the trace — nothing further will execute.'
type Trace=ChatTrace
type Message={id:string;role:'user'|'assistant';text:string;runId?:string;status?:string;trace?:Trace;clarification?:boolean;liveTools?:string[];streaming?:boolean}
const suggestions=['Which of my leads need follow-up today?','Summarize my hottest lead and what the SOP says to do next.','What is the early-bird discount policy?']
const newId=()=>crypto.randomUUID()
export type ChatMessage = Message
export default function ChatPanel({sessionId,onSessionIdChange,readOnly=false,onInspect,canDecide=false,initialMessages,initialInput=''}:{sessionId:string|null;onSessionIdChange?:(id:string)=>void;readOnly?:boolean;onInspect?:(trace:Trace)=>void;canDecide?:boolean;initialMessages?:Message[];initialInput?:string}){
 const [messages,setMessages]=useState<Message[]>(initialMessages ?? []),[input,setInput]=useState(initialInput),[busy,setBusy]=useState(false),[activeRunId,setActiveRunId]=useState<string|null>(null),[stopping,setStopping]=useState(false),listRef=useRef<HTMLDivElement>(null)
 useEffect(()=>{if(initialMessages) setMessages(initialMessages)},[initialMessages])
 const recentContext=useMemo(()=>messages.slice(-4).map(m=>m.role+': '+m.text).join('\n').slice(0,4000),[messages])
 useEffect(()=>{listRef.current?.scrollTo({top:listRef.current.scrollHeight,behavior:'smooth'})},[messages])
 // Patch by run id: the stop control works from the run the server named,
 // not from a local message id (the two are the same message in practice,
 // but the run id is what the endpoint needs and returns).
 const patchByRun=(runId:string,patch:Partial<Message>)=>setMessages(m=>m.map(x=>x.runId===runId?{...x,...patch}:x))
 async function send(raw:string){const goal=raw.trim();if(!goal||busy||readOnly)return;const user:Message={id:newId(),role:'user',text:goal};const pending:Message={id:newId(),role:'assistant',text:'Working…',status:'running',streaming:true};setMessages(m=>[...m,user,pending]);setInput('');setBusy(true)
  const patchPending=(patch:Partial<Message>)=>setMessages(m=>m.map(x=>x.id===pending.id?{...x,...patch}:x))
  try{let sid=sessionId;if(!sid){sid=newId();onSessionIdChange?.(sid)}
   // Bundle B: progressive run. The server streams turn deltas and tool
   // steps as they happen; the resolved output is the same AgentRunOutput
   // the JSON route returns (fallback + disconnect-resume are built in).
   const onEvent=(ev:RuntimeEvent)=>{
    if(ev.type==='run_started'){setActiveRunId(ev.runId);patchPending({runId:ev.runId})}
    else if(ev.type==='turn_delta')patchPending({text:ev.text||'Working…'})
    else if(ev.type==='tool_executed')setMessages(m=>m.map(x=>x.id===pending.id?{...x,liveTools:[...(x.liveTools??[]),ev.tool]}:x))
    else if(ev.type==='awaiting_approval'){patchPending({status:'awaiting_approval',text:'This action is waiting for human approval.'})}
    else if(ev.type==='run_completed')patchPending({text:ev.outcome,status:'completed'})
    else if(ev.type==='run_failed')patchPending({text:ev.error,status:'failed'})
    else if(ev.type==='run_cancelled')patchPending({status:'cancelled',text:CANCELLED_TEXT,liveTools:[]})
   }
   const {output:out}=await startStreamedRun({goal,agentId:'admissions-followup',sessionId:sid,ephemeralContext:recentContext},onEvent)
   let trace:Trace|undefined
   if(out.runId){const t=await fetch('/api/agent/runs/'+out.runId,{cache:'no-store'});if(t.ok)trace=await t.json()}
   const status=out.status??'failed';const text=status==='completed'?out.finalOutcome??'Done.':status==='awaiting_approval'?'This action is waiting for human approval.':status==='clarification_required'?out.clarification??'Which lead or action should I use?':status==='escalated'?'I escalated this to a human: '+(out.finalOutcome??'see the trace.'):status==='cancelled'?CANCELLED_TEXT:out.error??'The run failed.'
   const answer:Message={id:newId(),role:'assistant',text,runId:out.runId,status,trace,clarification:status==='clarification_required'};setMessages(m=>[...m.slice(0,-1),answer]);if(trace)onInspect?.(trace)
  }catch{setMessages(m=>[...m.slice(0,-1),{id:newId(),role:'assistant',text:'Could not reach the agent runtime. Try again shortly.',status:'failed'}])}finally{setBusy(false);setActiveRunId(null)}}
 // Migration 024 — stop a run. The endpoint records the request and, for a
 // run suspended on an approval, ends it immediately (and withdraws the
 // approval). For a running run the loop stops at its next barrier and
 // says so through the stream this component is already consuming, so the
 // acknowledgement below never claims more than the trace proves.
 async function stopRun(runId:string){setStopping(true)
  try{
   const r=await fetch('/api/agent/runs/'+runId+'/cancel',{method:'POST'})
   const body=await r.json().catch(()=>({})) as {error?:string;run?:{status?:string}}
   if(!r.ok){patchByRun(runId,{status:'failed',text:body.error??'Could not stop the run.'});return}
   const status=body.run?.status
   if(status==='cancelled')patchByRun(runId,{status:'cancelled',text:CANCELLED_TEXT})
   else if(status&&status!=='running')patchByRun(runId,{status,text:'The run had already finished ('+status+') before the stop took effect.'})
   else patchByRun(runId,{text:'Stopping… the run will be recorded as cancelled.'})
  }catch{patchByRun(runId,{status:'failed',text:'Could not reach the agent runtime. Try again shortly.'})}
  finally{setStopping(false)}}
 async function loadRun(runId:string){const r=await fetch('/api/agent/runs/'+runId,{cache:'no-store'});if(!r.ok)return;const trace=await r.json();setMessages(m=>m.map(x=>x.runId===runId?{...x,trace,status:trace.run.status,text:trace.run.final_outcome??x.text}:x));onInspect?.(trace)}
 return <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm" data-testid="chat">
  <div ref={listRef} className="min-h-[18rem] flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
   {!messages.length&&!readOnly&&<div className="py-8 text-center"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-xl text-blue-600">✦</div><h2 className="font-semibold text-[var(--ink)]">What can I help move forward?</h2><p className="mt-1 text-sm text-[var(--ink-3)]">Ask about leads, tasks, policies or follow-ups.</p><div className="mt-5 flex flex-wrap justify-center gap-2">{suggestions.map(s=><button key={s} onClick={()=>send(s)} className="rounded-full border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink-2)] hover:border-blue-300 hover:bg-blue-50" disabled={busy}>{s}</button>)}</div></div>}
   {readOnly&&<p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Read-only history. Fork this session to continue with a new chat.</p>}
   {messages.map(m=>m.role==='user'?<div key={m.id} className="flex justify-end"><p className="max-w-[82%] rounded-2xl rounded-br-md bg-slate-900 px-4 py-3 text-sm text-white">{m.text}</p></div>:<div key={m.id} className="max-w-[92%] space-y-2"><div className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500"/><div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm text-slate-800"><p>{m.text}{m.streaming&&m.text!=='Working…'&&<span className="ml-0.5 animate-pulse">▍</span>}</p>{m.status==='running'&&!!m.liveTools?.length&&<div className="mt-2 flex flex-wrap gap-1">{m.liveTools.map((t,i)=><span key={i} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{t} ✓</span>)}</div>}{m.status==='running'&&!m.liveTools?.length&&m.text==='Working…'&&<span className="mt-2 block text-xs text-slate-400">Working…</span>}</div></div>{m.trace&&<><RichCards cards={cardsFromSteps(m.trace.steps)}/><StepTrace steps={m.trace.steps} tokens={(m.trace.run.tokens_in??0)+(m.trace.run.tokens_out??0)} admin={canDecide}/></>}{m.status==='awaiting_approval'&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Approval required. <a className="font-semibold underline" href="/agent/approvals">Open approvals</a>{m.runId&&!readOnly&&<> · <button type="button" onClick={()=>stopRun(m.runId!)} disabled={stopping} className="font-semibold underline">Stop this run</button></>}</p>}{m.status==='running'&&m.runId&&<button onClick={()=>loadRun(m.runId!)} className="text-xs text-blue-600 hover:underline">Refresh run trace</button>}</div>)}
  </div>
  {!readOnly&&<form className="flex gap-2 border-t border-[var(--border)] p-3" onSubmit={e=>{e.preventDefault();send(input)}}><input value={input} onChange={e=>setInput(e.target.value)} disabled={busy} aria-label="Ask the agent" placeholder="Ask about your leads, tasks or SOPs…" className="field flex-1"/>{busy&&activeRunId&&<button type="button" onClick={()=>stopRun(activeRunId)} disabled={stopping} className="btn">{stopping?'Stopping…':'Stop'}</button>}<button className="btn btn-primary" disabled={busy||!input.trim()}>{busy?'Working…':'Ask'}</button></form>}
 </section>
}
