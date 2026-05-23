-- =====================================================================
-- Phase 3b: widen ai_runs.feature to accept MCP tool names.
--
-- Migration 0032 widened the check constraint to include
-- (create_board, create_tasks, add_to_board, add_tasks, chat, suggest).
-- 3b adds the MCP write tools — every MCP write logs to ai_runs with
-- feature = the tool name, so the auditable surface stays in one place.
--
-- We re-issue the constraint with the union of old + new values so
-- historic rows stay valid.
-- =====================================================================

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
    -- legacy values (kept so historic rows stay valid)
    'chat', 'suggest', 'create_tasks',
    -- Phase 1/2 engine kinds
    'create_board', 'add_to_board', 'add_tasks',
    -- Phase 3b MCP write tools — names match api/mcp.ts TOOLS keys
    'create_task', 'bulk_create_tasks', 'update_task_status',
    'design_board_from_spec'
  ));
