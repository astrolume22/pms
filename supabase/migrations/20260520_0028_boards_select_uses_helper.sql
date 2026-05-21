-- =====================================================================
-- boards_select_accessible used the inlined Phase-2 logic (workspace
-- member + main board fallback). Migration 0022 rewrote
-- can_access_board to the strict two-role model but the policy was
-- still using the old inline expression — meaning managers could STILL
-- see any main-board their workspace included.
--
-- Restore the helper call so the new can_access_board is the source
-- of truth.
-- =====================================================================

drop policy if exists boards_select_accessible on public.boards;
create policy boards_select_accessible on public.boards for select
  to authenticated
  using (deleted_at is null and public.can_access_board(id));
