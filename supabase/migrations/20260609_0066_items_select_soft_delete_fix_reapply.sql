-- =====================================================================
-- 0066 — items_select soft-delete trap fix (RE-APPLY).
--
-- Repro (live DB, diag-items-rls.ts):
--   admin user → PATCH /rest/v1/items?id=eq.<X> Prefer:return=minimal
--                body {"deleted_at":"now"}
--     → 403 {"code":"42501","message":"new row violates row-level
--             security policy for table \"items\""}
--
-- Root cause:
--   PostgreSQL applies a table's SELECT policy USING expression AS
--   WITH CHECK on the NEW row of every UPDATE (the "USING-as-
--   WITH-CHECK" rule). The live items_select USING contains
--   `(deleted_at IS NULL)`, so the moment the soft-delete sets
--   deleted_at=now(), the new row fails the SELECT USING and the
--   UPDATE is rejected with 42501. Even an admin (whose items_update
--   USING + WITH CHECK = is_admin() both pass) hits this trap.
--
-- Why 0038 didn't help:
--   Migration 0038 already shipped this exact fix in the repo, but
--   the live database evidently never had 0038 applied. The live
--   items_select USING still matches 0031's body verbatim.
--
-- This migration:
--   • Drops items_select (if exists) and recreates it WITHOUT
--     `deleted_at IS NULL` in the USING. The app already filters
--     soft-deleted rows at the query layer
--     (`.filters: { deleted_at: 'is.null' }` in src/hooks/items.ts
--     and friends), so removing the clause from RLS does not surface
--     deleted rows in the UI.
--   • Tenant isolation is unchanged: same
--     (is_admin OR subscriber-of-board-with-matching-group) gate
--     stays in place.
--
-- DATA RULES respected:
--   • Strictly additive policy rewrite — no DROP/CASCADE of tables.
--   • No FK changes. No column changes. No board / answers / items
--     row touched.
--   • Single policy on a single table.
--   • Idempotent — DROP POLICY IF EXISTS + CREATE POLICY can re-run.
-- =====================================================================
begin;

drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (
    -- Note: `deleted_at IS NULL` is intentionally NOT in the USING
    -- (see migration 0014 for the original boards-side fix and 0038
    -- for the items-side fix this migration is re-applying). The app
    -- filters soft-deleted rows at the query layer; doing it in RLS
    -- triggers the UPDATE-can't-soft-delete trap because the new row's
    -- deleted_at becomes non-null and fails USING-as-WITH-CHECK.
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

commit;
