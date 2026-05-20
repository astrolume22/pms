-- =====================================================================
-- PMS Phase 1 — Grant table privileges to authenticated role
-- RLS still gates access; without these grants Postgres rejects upfront.
-- =====================================================================

grant usage on schema public to authenticated, anon;

grant select, insert, update, delete on public.users to authenticated;
grant select on public.account to authenticated;
grant update on public.account to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert on public.activity_log to authenticated;
