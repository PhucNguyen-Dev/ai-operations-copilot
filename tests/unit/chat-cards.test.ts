import { describe, expect, it } from 'vitest'
import { cardsFromSteps } from '@/lib/chat/cards'

describe('chat cards', () => {
  it('maps lead, task, knowledge and email trace data', () => {
    const cards = cardsFromSteps([
      { tool_name: 'get_lead', status: 'success', args_snapshot: {}, result_summary: { lead: { id: 'l1', name: 'Mai' }, analysis: { category: 'HOT' } } },
      { tool_name: 'create_task', status: 'success', args_snapshot: { title: 'Call Mai', priority: 'high' }, result_summary: { task_id: 't1', due_at: 'tomorrow' } },
      { tool_name: 'search_knowledge', status: 'success', args_snapshot: {}, result_summary: { results: [{ title: 'SOP', excerpt: 'Do this' }] } },
      { tool_name: 'prepare_email', status: 'success', args_snapshot: { subject: 'Welcome', body: 'Hello' }, result_summary: { email_id: 'e1', status: 'dry_run' } },
    ])
    expect(cards.map(card => card.type)).toEqual(['lead', 'task', 'knowledge', 'email'])
    expect(cards[1]).toMatchObject({ type: 'task', task: { title: 'Call Mai', task_id: 't1' } })
  })

  it('ignores failed steps and malformed results', () => {
    expect(cardsFromSteps([
      { tool_name: 'get_lead', status: 'failed', result_summary: { lead: { id: 'x' } } },
      { tool_name: 'search_leads', status: 'success', result_summary: { leads: [null, { name: 'missing id' }] } },
    ])).toEqual([])
  })
})
