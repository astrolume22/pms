-- =====================================================================
-- Phase 2: retire the legacy pg_net-based Gemini path.
--
-- The new "Build with AI" engine (api/ai-build.ts on Vercel Functions)
-- has replaced gemini_invoke + the per-DB encrypted-key UI. Migration
-- 0017 created four RPCs we no longer call from anywhere:
--   gemini_invoke(text, text, text, text)
--   set_gemini_key(text)
--   clear_gemini_key()
--   get_gemini_status()
-- Confirmed via grep across src/ before this migration ran.
--
-- We INTENTIONALLY keep `public.account.gemini_api_key_encrypted` (the
-- column) and `internal.app_secrets` (where the passphrase lived) —
-- column drops can lose data, and these are tiny + harmless. The
-- column becomes effectively dead but stays nullable.
--
-- We ALSO add an admin-read RLS policy on ai_runs so the new admin
-- "Recent AI runs" view in /admin can read every user's runs. The
-- existing `ai_runs_select_own` policy stays so non-admins still see
-- only their own runs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Drop the legacy Gemini RPCs.
-- ---------------------------------------------------------------------
drop function if exists public.gemini_invoke(text, text, text, text);
drop function if exists public.set_gemini_key(text);
drop function if exists public.clear_gemini_key();
drop function if exists public.get_gemini_status();

-- ---------------------------------------------------------------------
-- ai_runs: admin can SELECT every run for the /admin recent-runs view.
-- The existing ai_runs_select_own policy stays in place for managers.
-- ---------------------------------------------------------------------
drop policy if exists ai_runs_select_admin on public.ai_runs;
create policy ai_runs_select_admin on public.ai_runs for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- ai_runs.feature: widen the check constraint to cover the new engine's
-- kinds. Original constraint (migration 0016) only allowed
-- ('create_board','create_tasks','chat','suggest'), but api/ai-build.ts
-- writes feature = kind where kind ∈ {create_board,add_to_board,add_tasks}.
-- Two of those (add_to_board, add_tasks) were silently failing the
-- best-effort insert. Keep the legacy values so historic rows stay valid.
-- ---------------------------------------------------------------------
do $$
declare cname text;
begin
  select c.conname
    into cname
  from pg_constraint c
  where c.conrelid = 'public.ai_runs'::regclass
    and c.contype  = 'c'
    and pg_get_constraintdef(c.oid) ilike '%feature%';
  if cname is not null then
    execute format('alter table public.ai_runs drop constraint %I', cname);
  end if;
end $$;

alter table public.ai_runs
  add constraint ai_runs_feature_check
  check (feature in (
    'create_board', 'create_tasks', 'add_to_board', 'add_tasks',
    'chat', 'suggest'
  ));
