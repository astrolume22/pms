-- =====================================================================
-- PMS Phase 2 — Grants for new tables
-- RLS still gates everything; these grants just let Postgres consider
-- the row at all.
-- =====================================================================

grant select, insert, update, delete on public.boards            to authenticated;
grant select, insert, update, delete on public.board_subscribers to authenticated;
grant select, insert, delete         on public.board_favorites   to authenticated;
grant select, insert, update, delete on public.board_last_viewed to authenticated;
grant select, insert, update, delete on public.groups            to authenticated;
grant select, insert, update, delete on public.columns           to authenticated;
grant select, insert, update, delete on public.column_labels     to authenticated;
