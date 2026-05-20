-- =====================================================================
-- Part B visual polish: widen label-bearing columns to match Monday's
-- roomier proportions on existing boards.  GREATEST keeps user-resized
-- columns intact (only widens, never shrinks).
--
-- This is a one-shot data fix; the matching default widths for NEW
-- columns live in `src/hooks/columns.ts`.
-- =====================================================================

update public.columns
set width = greatest(width, 180)
where column_type in ('status', 'priority') and archived_at is null;

update public.columns
set width = greatest(width, 200)
where column_type = 'dropdown' and archived_at is null;

update public.columns
set width = greatest(width, 160)
where column_type = 'people' and archived_at is null;

update public.columns
set width = greatest(width, 140)
where column_type = 'date' and archived_at is null;

update public.columns
set width = greatest(width, 140)
where column_type = 'numbers' and archived_at is null;

update public.columns
set width = greatest(width, 160)
where column_type = 'files' and archived_at is null;
