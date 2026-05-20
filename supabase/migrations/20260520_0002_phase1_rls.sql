-- =====================================================================
-- PMS Phase 1 — RLS helpers + policies
-- All policies are SELECT/INSERT/UPDATE/DELETE scoped.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper functions (security definer, stable)
-- ---------------------------------------------------------------------
create or replace function public.current_user_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'admin' or is_super_admin from public.users where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_super_admin from public.users where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select status = 'active' from public.users where id = auth.uid()),
    false
  );
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_super_admin() from public;
revoke all on function public.is_active_user() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;

-- ---------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------
alter table public.account enable row level security;
alter table public.users enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.activity_log enable row level security;

-- ---------------------------------------------------------------------
-- Reset existing policies (idempotent re-run)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('account','users','workspaces','workspace_members','activity_log')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
-- Authenticated active users can see all active users.
-- Admins can see everyone (including deactivated) so they can manage them.
create policy users_select_active on public.users for select
  to authenticated
  using (
    public.is_admin()
    or (public.is_active_user() and status = 'active')
  );

-- Users can update their own row (profile fields).
create policy users_update_own on public.users for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admins can update anyone (role changes, deactivation, etc.).
create policy users_update_admin on public.users for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Only admins can insert (creating new accounts happens via admin panel + Auth Admin API).
create policy users_insert_admin on public.users for insert
  to authenticated
  with check (public.is_admin());

-- Only super_admin can delete, and never themselves.
create policy users_delete_super_admin on public.users for delete
  to authenticated
  using (public.is_super_admin() and id <> auth.uid());

-- ---------------------------------------------------------------------
-- account
-- ---------------------------------------------------------------------
create policy account_select_all on public.account for select
  to authenticated
  using (public.is_active_user());

create policy account_update_super_admin on public.account for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------
create policy workspaces_select_active on public.workspaces for select
  to authenticated
  using (public.is_active_user());

create policy workspaces_insert_admin on public.workspaces for insert
  to authenticated
  with check (public.is_admin());

create policy workspaces_update_admin on public.workspaces for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy workspaces_delete_admin on public.workspaces for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------
create policy ws_members_select_active on public.workspace_members for select
  to authenticated
  using (public.is_active_user());

create policy ws_members_insert_admin on public.workspace_members for insert
  to authenticated
  with check (public.is_admin());

create policy ws_members_update_admin on public.workspace_members for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy ws_members_delete_admin on public.workspace_members for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- activity_log
-- ---------------------------------------------------------------------
create policy activity_log_select_admin_or_own on public.activity_log for select
  to authenticated
  using (public.is_admin() or actor_id = auth.uid());

create policy activity_log_insert_self on public.activity_log for insert
  to authenticated
  with check (actor_id = auth.uid() and public.is_active_user());
