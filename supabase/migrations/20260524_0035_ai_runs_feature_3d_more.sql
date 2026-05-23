-- =====================================================================
-- Phase 3d follow-up #2: widen ai_runs.feature CHECK for the 3 new
-- column-management MCP tools.
--
-- 0033 added the 3b tool names. 0034 added the first batch of 3d
-- tools. 0035 (this) adds add_column_label / delete_column /
-- rename_column. Each MCP write logs to ai_runs with feature = tool
-- name; the audit trail stays in one table.
-- =====================================================================

do $$
declare cname text;
begin
  select c.conname into cname
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
    -- legacy
    'chat', 'suggest', 'create_tasks',
    -- Phase 1/2 engine kinds
    'create_board', 'add_to_board', 'add_tasks',
    -- Phase 3b MCP write tools
    'create_task', 'bulk_create_tasks', 'update_task_status',
    'design_board_from_spec',
    -- Phase 3d MCP write tools (0034)
    'add_task_update', 'update_task_cell', 'update_task_name',
    'create_column',
    'create_group', 'rename_group', 'delete_group',
    'delete_task',
    'rename_board', 'archive_board', 'delete_board',
    'create_workspace',
    -- Phase 3d follow-up #2 (this migration)
    'add_column_label', 'delete_column', 'rename_column'
  ));
