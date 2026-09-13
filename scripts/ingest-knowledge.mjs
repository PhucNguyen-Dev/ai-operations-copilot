#!/usr/bin/env node
// =============================================================
// Phase 9 Milestone B — knowledge ingestion: knowledge_docs → chunks
// → Gemini embeddings → knowledge_chunks. Re-runnable: re-ingesting a
// doc replaces its chunks (delete + insert), so content edits propagate.
//
// Usage: npm run ingest:knowledge
// Requires .env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// GEMINI_API_KEY. Fails loudly — an un-embedded knowledge base must
// never be silently half-built.
// =============================================================

import { readFileSync } from 'node:fs'
import { chunkText, toPgVectorLiteral } from './knowledge-chunk.mjs'

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-004'
const SIMILARITY_SANITY_MIN = -1 // sanity floor; no filtering at ingest time

function loadEnv() {
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim()
    }
  } catch {
    /* .env optional when vars come from the environment */
  }
}

async function embed(text, apiKey) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text: text.slice(0, 8000) }] } }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`embedding HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  const values = json?.embedding?.values
  if (!Array.isArray(values) || values.length === 0) throw new Error('malformed embedding response')
  return values
}

async function main() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = process.env.GEMINI_API_KEY
  if (!url || !key || !apiKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GEMINI_API_KEY in .env')
    process.exit(1)
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const base = `${url.replace(/\/+$/, '')}/rest/v1`

  const docs = await fetch(`${base}/knowledge_docs?select=id,title,is_active&is_active=eq.true`, { headers })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`knowledge_docs HTTP ${r.status}`))))
  if (!docs.length) {
    console.log('No active knowledge_docs rows — nothing to ingest.')
    return
  }

  let totalChunks = 0
  for (const doc of docs) {
    const full = await fetch(`${base}/knowledge_docs?select=id,title,content&id=eq.${doc.id}`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`doc HTTP ${r.status}`))))
    const content = full?.[0]?.content
    if (!content) {
      console.warn(`- ${doc.title}: no content, skipped`)
      continue
    }
    const chunks = chunkText(content)
    const rows = []
    for (let i = 0; i < chunks.length; i++) {
      const values = await embed(chunks[i], apiKey)
      if (Math.max(...values) < SIMILARITY_SANITY_MIN) throw new Error('embedding out of range — aborting')
      // pgvector accepts its text literal through PostgREST
      rows.push({ doc_id: doc.id, chunk_index: i, content: chunks[i], embedding: toPgVectorLiteral(values) })
    }
    // Idempotent re-ingest: replace this doc's chunks atomically enough
    // for an ops script (delete then insert).
    await fetch(`${base}/knowledge_chunks?doc_id=eq.${doc.id}`, { method: 'DELETE', headers })
    const insert = await fetch(`${base}/knowledge_chunks`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    })
    if (!insert.ok) throw new Error(`chunk insert for "${doc.title}" HTTP ${insert.status}: ${await insert.text()}`)
    totalChunks += rows.length
    console.log(`- ${doc.title}: ${rows.length} chunk(s) embedded (model: ${EMBEDDING_MODEL})`)
  }
  console.log(`Ingestion complete — ${totalChunks} chunks across ${docs.length} doc(s).`)
}

main().catch((e) => {
  console.error('Ingestion FAILED:', e.message)
  process.exit(1)
})
