-- =============================================================
-- AI Operations Copilot — Phase 9 Milestone B: governed RAG storage
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- knowledge_chunks holds the embedded chunks of knowledge_docs.
-- Embeddings: Gemini text-embedding-004, 768 dimensions — the column
-- dimension is FIXED to the model; changing the embedding model means
-- re-embedding everything and altering this column.
--
-- Permission model unchanged from Milestone A: role scoping lives on
-- knowledge_docs.allowed_roles; the match function filters by it and
-- the tool re-checks (defense in depth). RLS on chunks mirrors the
-- parent doc's visibility.
-- =============================================================

-- pgvector lives in the extensions schema on Supabase
create extension if not exists vector with schema extensions;

create table if not exists public.knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references public.knowledge_docs (id) on delete cascade,
  chunk_index integer not null,
  content     text not null,
  embedding   extensions.vector(768) not null,
  created_at  timestamptz not null default now(),
  unique (doc_id, chunk_index)
);

create index if not exists knowledge_chunks_doc_idx on public.knowledge_chunks (doc_id, chunk_index);

-- Cosine-similarity ANN index (HNSW)
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.knowledge_chunks enable row level security;

-- Chunks are readable exactly when their parent doc is (staff-wide
-- read; role scoping happens in the match function + tool).
drop policy if exists "knowledge_chunks: staff read via doc" on public.knowledge_chunks;
create policy "knowledge_chunks: staff read via doc"
  on public.knowledge_chunks for select
  using (
    exists (
      select 1 from public.knowledge_docs d
      where d.id = knowledge_chunks.doc_id and d.is_active
    )
  );

-- -------------------------------------------------------------
-- Vector match function — the tool calls this via RPC with the
-- invoking user's client, so RLS applies AND the role scope is
-- enforced here ('all' or the caller's role in allowed_roles).
-- Returns cosine similarity (1 = identical, 0 = unrelated).
-- -------------------------------------------------------------
create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector,
  match_count int default 3,
  p_role text default null
)
returns table (
  doc_id     uuid,
  chunk_index int,
  content    text,
  similarity float,
  title      text,
  doc_type   text,
  department text
)
language sql stable
as $$
  select
    c.doc_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity,
    d.title,
    d.doc_type,
    d.department
  from public.knowledge_chunks c
  join public.knowledge_docs d on d.id = c.doc_id
  where d.is_active
    and (
      p_role is null
      or 'all' = any (d.allowed_roles)
      or p_role = any (d.allowed_roles)
    )
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
