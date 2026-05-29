-- =====================================================================
-- 0050 — board_sync_pings: a tiny "I just clicked Save, please refresh"
-- signal table that lights up postgres_changes for every client on the
-- board.
--
-- Why a dedicated table (instead of bumping boards.updated_at):
--   • The boards table has tight RLS (boards_update_manager requires
--     admin / can_manage_board(id)). Non-manager team members couldn't
--     issue a sync ping that way.
--   • A dedicated table can hold a permissive INSERT policy without
--     weakening data security elsewhere — it stores only a board_id +
--     timestamp + ping author, no sensitive content.
--   • INSERTs are cheap and the row is throwaway.
--
-- Cross-machine sync architecture, summarised after this migration:
--   1. Cell save / item save / etc. — postgres_changes on the existing
--      4 tables (added in 0049) delivers the row payload to every
--      subscribed client. React Query invalidates → refetch.
--   2. Manual Save button click — fires a no-op INSERT into
--      board_sync_pings. postgres_changes on THIS table also delivers
--      to every subscribed client. Same invalidate path.
--   3. Window focus — refetchOnWindowFocus on the three board queries
--      triggers a refetch the moment a user clicks into a tab.
--   4. 60-second polling — refetchInterval as a final safety net so
--      even if every Realtime layer is broken, tabs sync within a
--      minute.
--
-- Layers 1+2 give instant-when-Realtime-works behaviour; 3+4 are the
-- guaranteed always-works backstop the user asked for.
-- =====================================================================
begin;

create table if not exists public.board_sync_pings (
  id         uuid primary key default uuid_generate_v4(),
  board_id   uuid not null,
  pinged_by  uuid references auth.users(id) on delete set null,
  pinged_at  timestamptz not null default now()
);

create index if not exists board_sync_pings_board_at_idx
  on public.board_sync_pings(board_id, pinged_at desc);

alter table public.board_sync_pings enable row level security;

drop policy if exists board_sync_pings_insert on public.board_sync_pings;
create policy board_sync_pings_insert on public.board_sync_pings
  for insert to authenticated with check (true);

drop policy if exists board_sync_pings_select on public.board_sync_pings;
create policy board_sync_pings_select on public.board_sync_pings
  for select to authenticated using (true);

-- Add to the realtime publication so INSERTs fire postgres_changes
-- events on every subscribed client. Idempotent.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.board_sync_pings';
  exception when duplicate_object then null;
  end;
end$$;

commit;
