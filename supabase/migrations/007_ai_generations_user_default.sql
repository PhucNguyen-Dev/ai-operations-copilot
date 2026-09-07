-- =============================================================
-- 007 — fix ai_generations logging: user_id default
-- =============================================================
-- logGeneration originally inserted without user_id; the column is
-- `not null` with no default and RLS requires auth.uid() = user_id,
-- so every generation row was silently rejected (the error was
-- swallowed into server logs by the best-effort logging design).
--
-- The app now passes user_id explicitly (lib/gemini.ts), and this
-- default is the safety net for any other caller. Run in the Supabase
-- SQL Editor — idempotent.
-- =============================================================

alter table public.ai_generations
  alter column user_id set default auth.uid();
