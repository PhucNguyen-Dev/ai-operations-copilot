export type ChatStep = { tool_name: string | null; status: string; args_snapshot?: unknown; result_summary?: unknown; error?: string | null }
export type ChatCard =
  | { type:'lead'; lead: Record<string, unknown> }
  | { type:'task'; task: Record<string, unknown> }
  | { type:'knowledge'; results: Record<string, unknown>[] }
  | { type:'email'; email: Record<string, unknown> }
  | { type:'approval'; approval: Record<string, unknown> }
  | { type:'narrative'; narrative: string }

const record=(v:unknown):Record<string,unknown> => v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {}
export function cardsFromSteps(steps: ChatStep[]): ChatCard[] {
  const cards: ChatCard[]=[]
  for(const step of steps){
    if(step.status !== 'success') continue
    const args=record(step.args_snapshot), result=record(step.result_summary)
    if(step.tool_name==='get_lead' && record(result.lead).id) cards.push({type:'lead',lead:{...record(result.lead),...record(result.analysis)}})
    if(step.tool_name==='search_leads' && Array.isArray(result.leads)) for(const lead of result.leads.slice(0,3)) if(record(lead).id) cards.push({type:'lead',lead:record(lead)})
    if(step.tool_name==='create_task' && result.task_id) cards.push({type:'task',task:{...args,...result}})
    if(step.tool_name==='search_knowledge' && Array.isArray(result.results)) cards.push({type:'knowledge',results:result.results.slice(0,3).map(record)})
    if(step.tool_name==='prepare_email') cards.push({type:'email',email:{...args,...result}})
    if(step.tool_name==='briefing_narrative' && typeof result.narrative==='string' && result.narrative) cards.push({type:'narrative',narrative:result.narrative})
  }
  const seen=new Set<string>()
  return cards.filter(card=>{const key=JSON.stringify(card); if(seen.has(key)) return false; seen.add(key); return true})
}
