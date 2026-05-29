-- =====================================================================
-- 0048 — let non-admin subscribed users save ANY cell, not just status.
--
-- Bug surfaced live during a board-wide diagnosis: the existing RLS
-- policies on item_column_values gated every INSERT / UPDATE / DELETE
-- on
--
--     can_access_item(item_id) AND (is_admin() OR is_status_column(column_id))
--
-- which silently rejected any non-admin user trying to save a cell
-- that is NOT a status column (Task Type, Co-Work Time, Priority,
-- dropdown, text, number, date, link, files, etc.). PostgREST
-- returned 42501 "new row violates row-level security policy", which
-- the optimistic-update UI used to hide as a silent revert. After
-- commit dfc489b the failure now surfaces as a toast — and we can fix
-- the cause cleanly here.
--
-- New gate (insert / update / delete): JUST
--
--     can_access_item(item_id)
--
-- which is the function used by values_select too, and already
-- requires the caller be (a) an active user, AND (b) either admin /
-- super_admin OR a board (or group) subscriber whose subscription
-- covers the item. The previous extra is_status_column clause was a
-- redundant restriction the table doesn't need — board access IS the
-- gate.
--
-- Single-row writes by id remain the discipline elsewhere in the app.
-- This migration ALTERs three existing policies in place and does NOT
-- touch table data, the answers table, FK rules, triggers, indexes,
-- or other tables. No CASCADE relationships are introduced or removed.
-- =====================================================================
begin;

alter policy values_insert on public.item_column_values
  with check ( can_access_item(item_id) );

alter policy values_update on public.item_column_values
  using      ( can_access_item(item_id) )
  with check ( can_access_item(item_id) );

alter policy values_delete on public.item_column_values
  using      ( can_access_item(item_id) );

commit;
