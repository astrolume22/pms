-- =====================================================================
-- 0051 — board_watermark(p_board_id): tiny RPC that returns the MAX
-- updated_at across all of a board's data tables, so the client can
-- POLL ONE timestamp every few seconds instead of refetching the
-- entire board state. When the timestamp moves, the client invalidates
-- the heavy queries and refetches only what's actually needed.
--
-- Why this exists:
--   The user wants cross-device sync to land within 1-5 seconds when
--   any of their tabs/devices makes a change. Polling the full board
--   queries every 3 seconds is wasteful (3 queries, ~60-100 KB per
--   refetch). Polling a single timestamp every 3 seconds is ~30 bytes
--   per poll — three orders of magnitude cheaper.
--
-- Returns: the greatest of:
--   • MAX(items.updated_at)           where items.board_id     = p_board_id
--   • MAX(groups.updated_at)          where groups.board_id    = p_board_id
--   • MAX(columns.updated_at)         where columns.board_id   = p_board_id
--   • MAX(item_column_values.updated_at)
--                                     for cells whose item is on this board
--   • MAX(board_sync_pings.pinged_at) where board_sync_pings.board_id = p_board_id
--
-- to_timestamp(0) (1970-01-01 UTC) is used as the per-table NULL
-- fallback so greatest() never receives NULL (which would short-
-- circuit and return NULL).
--
-- SECURITY DEFINER + locked search_path so the RPC works regardless
-- of the caller's RLS on each underlying table — they may still need
-- can_access_item() etc. to read the actual ROWS, but the watermark
-- doesn't expose anything beyond "something on this board changed at
-- time T". No row data leaks.
--
-- Granted to authenticated so any signed-in user can call it.
-- =====================================================================
begin;

create or replace function public.board_watermark(p_board_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce((select max(updated_at) from public.items
               where board_id = p_board_id), to_timestamp(0)),
    coalesce((select max(updated_at) from public.groups
               where board_id = p_board_id), to_timestamp(0)),
    coalesce((select max(updated_at) from public.columns
               where board_id = p_board_id), to_timestamp(0)),
    coalesce((select max(icv.updated_at)
                from public.item_column_values icv
                join public.items i on i.id = icv.item_id
               where i.board_id = p_board_id), to_timestamp(0)),
    coalesce((select max(pinged_at) from public.board_sync_pings
               where board_id = p_board_id), to_timestamp(0))
  );
$$;

revoke all on function public.board_watermark(uuid) from public;
grant execute on function public.board_watermark(uuid) to authenticated;

commit;
