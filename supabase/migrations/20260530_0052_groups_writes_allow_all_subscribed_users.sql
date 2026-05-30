-- =====================================================================
-- 0052 — let non-admin subscribed users create / rename / remove groups.
--
-- Bug surfaced live during a board-wide diagnosis: the groups write
-- policies gated every INSERT / UPDATE / DELETE on
--
--     can_edit_board(board_id)
--
-- which is admin-only (see can_edit_board → is_admin()). Every non-admin
-- subscribed user (the 14 managers on the Tessera board) trying to add
-- a new group, rename a group, or remove a group was silently rejected
-- with PostgREST 42501 "new row violates row-level security policy".
-- The "Add new group" handler surfaced it as a toast; create-group
-- appeared to "do nothing".
--
-- New gate (insert / update / delete): JUST
--
--     can_access_board(board_id)
--
-- which is the same function groups_select already uses, and already
-- requires the caller be (a) an active user, AND (b) either admin /
-- super_admin OR a subscriber of the board. This is the exact same
-- loosening migration 0048 applied to item_column_values (cell writes):
-- board access IS the gate; the admin-only restriction was the bug.
--
-- This migration ALTERs three existing policies in place and does NOT
-- touch table data, the answers table, FK rules, triggers, indexes,
-- groups_select, or any other table or policy. No CASCADE relationships
-- are introduced or removed. Single-row writes by id remain the
-- discipline elsewhere in the app.
-- =====================================================================
begin;

alter policy groups_insert on public.groups
  with check ( can_access_board(board_id) );

alter policy groups_update on public.groups
  using      ( can_access_board(board_id) )
  with check ( can_access_board(board_id) );

alter policy groups_delete on public.groups
  using      ( can_access_board(board_id) );

commit;
