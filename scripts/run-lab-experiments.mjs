// Phase 7 — AI Tool Lab: real experiments against the Gemini API.
// Writes raw results to docs/governance-data/experiments.json (committed as evidence).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

let key = null
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.*?)\s*$/)
  if (m) key = m[1]
}
if (!key) { console.error('no key'); process.exit(1) }

const call = async (model, body, timeoutMs = 30000) => {
  const t0 = Date.now()
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const latency = Date.now() - t0
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, status: r.status, error: (j.error?.message || '').slice(0, 160), latency }
    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
    return { ok: true, text, latency, modelVersion: (j.modelVersion || model).replace('models/', '') }
  } catch (e) {
    return { ok: false, status: 0, error: String(e).slice(0, 120), latency: Date.now() - t0 }
  }
}

const genConfig = { temperature: 0.4, ...(true ? { responseMimeType: 'application/json' } : {}) }

// The REAL F-004 lead-analysis prompt from the n8n pipeline
const leadSystem = [
  'You are the lead-qualification analyst for a mid-sized education and training company.',
  'You qualify incoming student leads for admissions counselors.',
  'Respond with ONLY a single JSON object with exactly these keys:',
  '{ "score": <integer 0-100, likelihood of conversion>, "category": "HOT"|"WARM"|"COLD", "intent": "HIGH"|"MEDIUM"|"LOW", "course": <string or null>, "timeline": <string or null>, "summary": <one-sentence summary of the lead>, "recommended_action": <concrete next action for the counselor> }',
].join('\n')
const leadLeads = [
  { name: 'Amira Hassan', email: 'a@e.com', phone: '+201001234567', source: 'facebook_ads', extra: 'course: IELTS, budget: 800-1000 USD, timeline: 1 month. Message: I need IELTS 7.5 for my master application, exam is in 6 weeks.' },
  { name: 'Ivan Petrov', email: 'i@e.com', phone: null, source: 'facebook_ads', extra: 'no course/budget/timeline given. Message: How much is English course?' },
  { name: 'Carlos Mendez', email: 'c@e.com', phone: '+52155', source: 'website', extra: 'course: Business English, budget: 500 USD, timeline: 3 months. Message: Interested in business English for meetings. Not in a rush.' },
]
const leadUser = (l) => `New lead received from ${l.source}:\n- name: ${l.name}\n- email: ${l.email}\n- phone: ${l.phone || 'not provided'}\n${l.extra}`

const validateLead = (p) =>
  p && Number.isInteger(p.score) && p.score >= 0 && p.score <= 100 &&
  ['HOT', 'WARM', 'COLD'].includes(p.category) && ['HIGH', 'MEDIUM', 'LOW'].includes(p.intent) &&
  typeof p.summary === 'string' && typeof p.recommended_action === 'string'

// Expected qualitative answers for scoring correctness
const expect = [{ cat: 'HOT', hi: true }, { cat: 'COLD', hi: false }, { cat: 'WARM', hi: false }]

const results = { generatedAt: new Date().toISOString(), experiments: {} }

// ---- Experiment A: flash vs flash-lite on F-004 lead analysis (JSON mode), 5 runs each
for (const model of ['gemini-3.5-flash', 'gemini-3.5-flash-lite']) {
  const runs = []
  for (let i = 0; i < 5; i++) {
    const lead = leadLeads[i % 3]
    const r = await call(model, {
      systemInstruction: { parts: [{ text: leadSystem }] },
      contents: [{ role: 'user', parts: [{ text: leadUser(lead) }] }],
      generationConfig: genConfig,
    })
    const rec = { latencyMs: r.latency }
    if (r.ok) {
      try {
        const parsed = JSON.parse(r.text)
        rec.parsed = true
        rec.validSchema = validateLead(parsed)
        rec.score = parsed.score ?? null
        rec.category = parsed.category ?? null
        rec.expected = expect[i % 3].cat
        rec.categoryCorrect = parsed.category === expect[i % 3].cat
        rec.summaryLen = (parsed.summary || '').length
      } catch { rec.parsed = false; rec.validSchema = false }
    } else {
      rec.parsed = false; rec.error = `HTTP ${r.status}: ${r.error}`
    }
    runs.push(rec)
  }
  const okRuns = runs.filter(r => r.parsed)
  results.experiments[model] = {
    experiment: 'F-004 lead analysis (JSON mode), 5 runs, 3 rotating real leads',
    runs,
    avgLatencyMs: Math.round(runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length),
    parseSuccess: `${okRuns.length}/5`,
    schemaValid: `${runs.filter(r => r.validSchema).length}/5`,
    categoryCorrect: `${runs.filter(r => r.categoryCorrect).length}/5`,
    sampleOutput: okRuns[0]?.parsed ? 'see runs' : null,
  }
}

// ---- Experiment B: retired model negative result
const retired = await call('gemini-2.0-flash', {
  contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: ok' }] }],
})
results.experiments['gemini-2.0-flash (retired)'] = {
  experiment: 'negative control: model retired by Google',
  ok: retired.ok, status: retired.status, error: retired.error, latencyMs: retired.latency,
}

// ---- Experiment C: JSON mode vs plain prompt (quiz task), 3 runs each
const quizSystemJson = 'Generate 3 IELTS vocabulary quiz questions (B1-B2 level) about "work and careers". Respond ONLY with JSON: {"questions": [{"q": "...", "options": ["a","b","c","d"], "answer": "a", "explanation": "..."}]}'
const quizSystemPlain = 'Generate 3 IELTS vocabulary quiz questions (B1-B2 level) about "work and careers". Format your entire reply as JSON with keys: questions (array of {q, options[4], answer, explanation}). Do not include any text outside the JSON.'
for (const [label, sys, mime] of [['json-mode', quizSystemJson, 'application/json'], ['plain-prompt', quizSystemPlain, 'text/plain']]) {
  const runs = []
  for (let i = 0; i < 3; i++) {
    const r = await call('gemini-3.5-flash-lite', {
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ text: 'Generate the quiz now.' }] }],
      generationConfig: { temperature: 0.4, ...(mime === 'application/json' ? { responseMimeType: 'application/json' } : {}) },
    })
    const rec = { latencyMs: r.latency }
    if (r.ok) {
      const cleaned = r.text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
      try {
        const p = JSON.parse(cleaned)
        rec.parsed = true
        rec.questionsOk = Array.isArray(p.questions) && p.questions.length === 3
      } catch { rec.parsed = false }
    } else { rec.parsed = false; rec.error = `HTTP ${r.status}` }
    runs.push(rec)
  }
  results.experiments[`quiz: ${label}`] = {
    parseSuccess: `${runs.filter(r => r.parsed).length}/3`,
    questionsOk: `${runs.filter(r => r.questionsOk).length}/3`,
    avgLatencyMs: Math.round(runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length),
    runs,
  }
}

mkdirSync('docs/governance-data', { recursive: true })
writeFileSync('docs/governance-data/experiments.json', JSON.stringify(results, null, 2))
for (const [k, v] of Object.entries(results.experiments)) {
  console.log(k.padEnd(34), '| parse:', v.parseSuccess || v.error || '-', '| schema:', v.schemaValid || '-', '| cat-correct:', v.categoryCorrect || '-', '| avg ms:', v.avgLatencyMs ?? v.latencyMs)
}
