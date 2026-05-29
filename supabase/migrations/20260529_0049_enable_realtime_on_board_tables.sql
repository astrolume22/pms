-- =====================================================================
-- 0049 — enable Supabase Realtime on the four board tables so two
-- browser tabs (same machine OR different machines) live-sync.
--
-- Bug captured live with two-tab screenshots: changing a cell in tab A
-- does not appear in tab B even after a hard refresh. Same-machine
-- BroadcastChannel sync (commit 79e0c7c) covers same browser, but the
-- founder's actual use case is two computers (the owner + Dr. John
-- per CLAUDE.md). That needs Supabase Realtime, which only fires for
-- tables added to the supabase_realtime publication. The publication
-- was empty.
--
-- This adds the 4 tables a single open board reads/writes:
--   items                — task rows
--   item_column_values   — cell values
--   groups               — group rows
--   columns              — column definitions + labels
--
-- REPLICA IDENTITY stays at the table default (primary key only) —
-- the client just needs to know "something on this board changed" to
-- invalidate the React Query cache and refetch; we don't need full
-- old-row payloads.
--
-- RLS on the publication: Realtime respects RLS using the same
-- SELECT policies. values_select / items SELECT policy / groups
-- SELECT policy / columns SELECT policy ALL run can_access_item() or
-- equivalent board-membership checks, so a user only receives change
-- events for boards they can already see. No new data is exposed.
-- =====================================================================
begin;

-- Idempotent — re-running is harmless because ADD TABLE on an
-- already-published relation raises a duplicate-object error we catch.
do $$
declare t text;
begin
  foreach t in array array['items','item_column_values','groups','columns'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      -- already in the publication, fine
      null;
    end;
  end loop;
end$$;

commit;
