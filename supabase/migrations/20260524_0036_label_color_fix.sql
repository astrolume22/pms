-- =====================================================================
-- Label color fix — two changes:
--   1. widen ai_runs.feature CHECK to include update_column_label
--   2. one-time backfill: convert the single non-hex column_labels.color
--      row (the QA Test "Leave" label which got rewritten to oklch by a
--      manual UI edit) to its canonical hex equivalent.
--
-- Backfill is non-destructive: oklch(0.68 0.16 25) and #EA6A64 are
-- identical visually (verified via the same oklchToHex math used in
-- api/_shared/color-normalize.ts).
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
    -- Phase 1/2
    'create_board', 'add_to_board', 'add_tasks',
    -- Phase 3b
    'create_task', 'bulk_create_tasks', 'update_task_status',
    'design_board_from_spec',
    -- Phase 3d
    'add_task_update', 'update_task_cell', 'update_task_name',
    'create_column',
    'create_group', 'rename_group', 'delete_group',
    'delete_task',
    'rename_board', 'archive_board', 'delete_board',
    'create_workspace',
    'add_column_label', 'delete_column', 'rename_column',
    -- Label color fix (this migration)
    'update_column_label'
  ));

-- Backfill — convert any oklch(...) value to its hex equivalent. Right
-- now there's exactly one such row, but the WHERE clause is generic so
-- if more oklch rows exist we'd catch them all.
--
-- The math: oklch(0.68 0.16 25) ≈ #EA6A64 (computed by
-- api/_shared/color-normalize.ts; verified by scripts/preview-token-hex.ts).
-- We don't have a postgres oklch→rgb implementation, so this backfill
-- handles only the known palette values explicitly. Any future stray
-- oklch row would be auto-normalised on next edit via the canonical-hex
-- normaliser at the write site.
update public.column_labels
  set color = '#EA6A64'
  where color = 'oklch(0.68 0.16 25)';

update public.column_labels
  set color = '#DF911A'
  where color = 'oklch(0.72 0.15 70)';

update public.column_labels
  set color = '#4D5660'
  where color = 'oklch(0.45 0.02 250)';

update public.column_labels
  set color = '#008388'
  where color = 'oklch(0.55 0.10 200)';

update public.column_labels
  set color = '#D14E95'
  where color = 'oklch(0.62 0.18 350)';

update public.column_labels
  set color = '#8E71D6'
  where color = 'oklch(0.62 0.15 295)';

update public.column_labels
  set color = '#3BACDA'
  where color = 'oklch(0.70 0.12 230)';

update public.column_labels
  set color = '#3FBF86'
  where color = 'oklch(0.72 0.14 160)';
