'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cardsFromSteps, type ChatStep } from '@/lib/chat/cards'
import { RichCards } from '@/components/chat/cards'
import { StepTrace } from '@/components/chat/StepTrace'

export type ChatTrace={run:{id?:string;goal?:string;status:string;final_outcome:string|null;error?:string|null;tokens_in:number;tokens_out:number};steps:ChatStep[];approvals:Record<string,unknown>[]}
type Trace=ChatTrace
type Message={id:string;role:'user'|'assistant';text:string;runId?:string;status?:string;trace?:Trace;clarification?:boolean}
const suggestions=['Which of my leads need follow-up today?','Summarize my hottest lead and what the SOP says to do next.','What is the early-bird discount policy?']
const newId=()=>crypto.randomUUID()
export type ChatMessage = Message
export default function ChatPanel({sessionId,onSessionIdChange,readOnly=false,onInspect,canDecide=false,initialMessages}:{sessionId:string|null;onSessionIdChange?:(id:string)=>void;readOnly?:boolean;onInspect?:(trace:Trace)=>void;canDecide?:boolean;initialMessages?:Message[]}){
 const [messages,setMessages]=useState<Message[]>(initialMessages ?? []),[input,setInput]=useState(''),[busy,setBusy]=useState(false),listRef=useRef<HTMLDivElement>(null)
 useEffect(()=>{if(initialMessages) setMessages(initialMessages)},[initialMessages])
 const recentContext=useMemo(()=>messages.slice(-4).map(m=>m.role+': '+m.text).join('\n').slice(0,4000),[messages])
 useEffect(()=>{listRef.current?.scrollTo({top:listRef.current.scrollHeight,behavior:'smooth'})},[messages])
 async function send(raw:string){const goal=raw.trim();if(!goal||busy||readOnly)return;const user:Message={id:newId(),role:'user',text:goal};const pending:Message={id:newId(),role:'assistant',text:'Working…',status:'running'};setMessages(m=>[...m,user,pending]);setInput('');setBusy(true)
  try{let sid=sessionId;if(!sid){sid=newId();onSessionIdChange?.(sid)}
   const res=await fetch('/api/agent/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({goal,agentId:'admissions-followup',sessionId:sid,ephemeralContext:recentContext})});const out=await res.json().catch(()=>({}));let trace:Trace|undefined
   if(out.runId){const t=await fetch('/api/agent/runs/'+out.runId,{cache:'no-store'});if(t.ok)trace=await t.json()}
   const status=out.status??'failed';const text=status==='completed'?out.finalOutcome??'Done.':status==='awaiting_approval'?'This action is waiting for human approval.':status==='clarification_required'?out.clarification??'Which lead or action should I use?':status==='escalated'?'I escalated this to a human: '+(out.finalOutcome??'see the trace.'):out.error??'The run failed.'
   const answer:Message={id:newId(),role:'assistant',text,runId:out.runId,status,trace,clarification:status==='clarification_required'};setMessages(m=>[...m.slice(0,-1),answer]);if(trace)onInspect?.(trace)
  }catch{setMessages(m=>[...m.slice(0,-1),{id:newId(),role:'assistant',text:'Could not reach the agent runtime. Try again shortly.',status:'failed'}])}finally{setBusy(false)}}
 async function loadRun(runId:string){const r=await fetch('/api/agent/runs/'+runId,{cache:'no-store'});if(!r.ok)return;const trace=await r.json();setMessages(m=>m.map(x=>x.runId===runId?{...x,trace,status:trace.run.status,text:trace.run.final_outcome??x.text}:x));onInspect?.(trace)}
 return <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm" data-testid="chat">
  <div ref={listRef} className="min-h-[18rem] flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
   {!messages.length&&!readOnly&&<div className="py-8 text-center"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-xl text-blue-600">✦</div><h2 className="font-semibold text-[var(--ink)]">What can I help move forward?</h2><p className="mt-1 text-sm text-[var(--ink-3)]">Ask about leads, tasks, policies or follow-ups.</p><div className="mt-5 flex flex-wrap justify-center gap-2">{suggestions.map(s=><button key={s} onClick={()=>send(s)} className="rounded-full border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink-2)] hover:border-blue-300 hover:bg-blue-50" disabled={busy}>{s}</button>)}</div></div>}
   {readOnly&&<p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Read-only history. Fork this session to continue with a new chat.</p>}
   {messages.map(m=>m.role==='user'?<div key={m.id} className="flex justify-end"><p className="max-w-[82%] rounded-2xl rounded-br-md bg-slate-900 px-4 py-3 text-sm text-white">{m.text}</p></div>:<div key={m.id} className="max-w-[92%] space-y-2"><div className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500"/><div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm text-slate-800"><p>{m.text}</p>{m.status==='running'&&<span className="mt-2 block text-xs text-slate-400">Working…</span>}</div></div>{m.trace&&<><RichCards cards={cardsFromSteps(m.trace.steps)}/><StepTrace steps={m.trace.steps} tokens={(m.trace.run.tokens_in??0)+(m.trace.run.tokens_out??0)} admin={canDecide}/></>}{m.status==='awaiting_approval'&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Approval required. <a className="font-semibold underline" href="/agent/approvals">Open approvals</a></p>}{m.status==='running'&&m.runId&&<button onClick={()=>loadRun(m.runId!)} className="text-xs text-blue-600 hover:underline">Refresh run trace</button>}</div>)}
  </div>
  {!readOnly&&<form className="flex gap-2 border-t border-[var(--border)] p-3" onSubmit={e=>{e.preventDefault();send(input)}}><input value={input} onChange={e=>setInput(e.target.value)} disabled={busy} aria-label="Ask the agent" placeholder="Ask about your leads, tasks or SOPs…" className="field flex-1"/><button className="btn btn-primary" disabled={busy||!input.trim()}>{busy?'Working…':'Ask'}</button></form>}
 </section>
}
