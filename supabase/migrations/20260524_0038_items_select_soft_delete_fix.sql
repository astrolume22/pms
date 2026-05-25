-- =====================================================================
-- 0038 — items_select soft-delete trap fix.
--
-- Bug: setting items.deleted_at via UPDATE failed with SQLSTATE 42501
--   "new row violates row-level security policy for table items"
-- even though the caller is admin (items_update USING + WITH CHECK
-- are both `is_admin()` which returns true).
--
-- Root cause — the classic Postgres soft-delete trap:
--   When a table has a SELECT policy with a USING expression that
--   references a column being modified, Postgres applies that USING
--   as an IMPLICIT WITH CHECK on the new row during UPDATE — so the
--   user must still be able to "see" what they updated. The
--   items_select policy was
--     USING ((deleted_at IS NULL) AND is_active_user() AND (...))
--   Setting deleted_at = now() flips deleted_at to non-null, the new
--   row fails the USING, and the UPDATE is rejected as an RLS
--   violation.
--
-- Migration 0031 fixed this exact trap on boards_select_accessible
-- (note: "see the 0014 fix") but forgot to apply the same change
-- to items_select. Audit (scripts/diag-soft-delete-audit.ts) shows
-- items_select is the ONLY remaining offender across all 5 soft-
-- delete tables (boards, files, groups, items, updates).
--
-- Fix: drop the `deleted_at IS NULL` clause from items_select's
-- USING. The app already filters soft-deleted items at the query
-- layer via `.is('deleted_at', null)` in useBoardItems / useGroups
-- / etc, so removing the RLS clause does not surface deleted items
-- in the UI. Tenant isolation is unchanged — the same
-- (admin OR subscriber-of-board-with-matching-group) gate stays in
-- place; only the soft-delete-visibility clause moves from the
-- policy to the query layer (where it already lives).
-- =====================================================================

drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (
    -- Note: `deleted_at IS NULL` is intentionally NOT in the USING
    -- (see migration 0014 for the original boards-side fix and 0031
    -- for the boards_select_accessible parallel — 0031 omitted items
    -- by oversight). The app filters soft-deleted rows at the query
    -- layer; doing it in RLS triggers the UPDATE-can't-soft-delete
    -- trap because the new row's deleted_at becomes non-null.
    public.is_active_user()
    and (
      public.is_admin()
      or exists (
        select 1 from public.board_subscribers bs
        where bs.board_id = items.board_id
          and bs.user_id  = auth.uid()
          and (bs.group_id is null or bs.group_id = items.group_id)
      )
    )
  );
