-- =====================================================================
-- Phase 6 — Admin RPCs for user management.
--
-- All write operations are SECURITY DEFINER functions running as the
-- postgres role (BYPASSRLS). The functions themselves enforce the
-- admin / super-admin / self guards so the UI cannot bypass them by
-- talking to the table directly.
--
-- Operations that need GoTrue (creating an auth.users row, resetting
-- a password) are routed through `pg_net.net.http_post` / `http_put`
-- to the Supabase auth admin endpoint. The service-role JWT lives in
-- `internal.app_secrets` (postgres-only schema, no authenticated
-- grant), seeded by `scripts/seed.ts` at install time.
-- =====================================================================

-- Make sure the secrets table exists from migration 0017.
create schema if not exists internal;
create table if not exists internal.app_secrets (
  key   text primary key,
  value text not null
);

-- Two new secrets needed for the admin RPCs. They're stored empty
-- until the seed script (or a super-admin) fills them in.
insert into internal.app_secrets (key, value)
values ('service_role_key', ''), ('supabase_url', '')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Super-admin can set the bootstrap secrets manually if the seed didn't
-- already populate them (e.g. when re-pointing at a fresh project).
-- ---------------------------------------------------------------------
create or replace function public.set_admin_secrets(p_key text, p_url text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Allow when called from a super-admin user session OR when called
  -- via the service-role JWT (no auth.uid() in that context) — the
  -- latter lets `scripts/seed.ts` bootstrap the secrets at install.
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Only super-admin can set admin secrets' using errcode='42501';
  end if;
  if p_key is null or length(trim(p_key))=0 then
    raise exception 'service_role_key cannot be empty';
  end if;
  if p_url is null or length(trim(p_url))=0 then
    raise exception 'supabase_url cannot be empty';
  end if;
  update internal.app_secrets set value = p_key where key = 'service_role_key';
  update internal.app_secrets set value = p_url where key = 'supabase_url';
end;
$$;

revoke all on function public.set_admin_secrets(text, text) from public;
grant execute on function public.set_admin_secrets(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- get_admin_secrets_status — returns whether the keys are configured.
-- Never returns the values themselves.
-- ---------------------------------------------------------------------
create or replace function public.get_admin_secrets_status()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'configured', exists(
      select 1 from internal.app_secrets
      where key='service_role_key' and length(value) > 0
    )
  );
$$;

revoke all on function public.get_admin_secrets_status() from public;
grant execute on function public.get_admin_secrets_status() to authenticated;

-- ---------------------------------------------------------------------
-- admin_list_users — returns all users (incl. deactivated) with last
-- activity timestamp pulled from activity_log. Admin-only.
-- NO emails are returned.
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  role text,
  status text,
  is_super_admin boolean,
  title text,
  timezone text,
  created_at timestamptz,
  last_active timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admin required' using errcode='42501';
  end if;
  return query
    select u.id, u.username, u.full_name, u.avatar_url, u.role, u.status,
           u.is_super_admin, u.title, u.timezone, u.created_at,
           (select max(al.created_at) from public.activity_log al where al.actor_id = u.id) as last_active
    from public.users u
    order by u.is_super_admin desc, u.role asc, u.username asc;
end;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- ---------------------------------------------------------------------
-- admin_set_role — change a user's role between admin/manager/viewer.
-- Cannot demote the super-admin. Admin (not super-admin) can promote
-- managers to admin freely.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if p_role not in ('admin','manager','viewer') then
    raise exception 'Invalid role: %', p_role using errcode='22023';
  end if;
  if exists (select 1 from public.users where id = p_user_id and is_super_admin) and p_role <> 'admin' then
    raise exception 'Cannot demote the super-admin' using errcode='42501';
  end if;
  update public.users set role = p_role where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;

revoke all on function public.admin_set_role(uuid, text) from public;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- admin_set_status — activate / deactivate a user. Cannot deactivate
-- the super-admin or yourself.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_status(p_user_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if p_status not in ('active','deactivated') then
    raise exception 'Invalid status: %', p_status using errcode='22023';
  end if;
  if exists (select 1 from public.users where id = p_user_id and is_super_admin)
     and p_status = 'deactivated' then
    raise exception 'Cannot deactivate the super-admin' using errcode='42501';
  end if;
  if p_user_id = auth.uid() and p_status = 'deactivated' then
    raise exception 'You cannot deactivate yourself' using errcode='42501';
  end if;
  update public.users set status = p_status where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;

revoke all on function public.admin_set_status(uuid, text) from public;
grant execute on function public.admin_set_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- admin_create_user — create a fresh manager/viewer account.
-- Fires net.http_post against /auth/v1/admin/users with the service
-- role key, then inserts the matching public.users row + workspace
-- membership.
-- ---------------------------------------------------------------------
create or replace function public.admin_create_user(
  p_username  text,
  p_full_name text,
  p_role      text,
  p_password  text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key      text;
  v_url      text;
  v_email    text;
  v_username text;
  v_req_id   bigint;
  v_resp     record;
  v_tries    int := 0;
  v_user_id  uuid;
  v_ws_id    uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if p_role not in ('manager','viewer') then
    raise exception 'New users can only be created as manager or viewer' using errcode='22023';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters' using errcode='22023';
  end if;

  v_username := lower(trim(coalesce(p_username,'')));
  if v_username = '' or v_username !~ '^[a-z0-9_]{2,32}$' then
    raise exception 'Username must be 2-32 characters of lowercase letters, digits, or underscore' using errcode='22023';
  end if;
  if exists (select 1 from public.users where username = v_username) then
    raise exception 'Username "%" already exists', v_username using errcode='23505';
  end if;
  v_email := v_username || '@pms.internal';

  select value into v_key from internal.app_secrets where key = 'service_role_key';
  select value into v_url from internal.app_secrets where key = 'supabase_url';
  if v_key is null or v_key = '' or v_url is null or v_url = '' then
    raise exception 'Admin secrets not configured. Super-admin must call set_admin_secrets(service_role_key, supabase_url) once.';
  end if;

  -- 1. Create the auth.users row via GoTrue admin endpoint.
  select net.http_post(
    url     := v_url || '/auth/v1/admin/users',
    body    := jsonb_build_object(
                 'email', v_email,
                 'password', p_password,
                 'email_confirm', true,
                 'user_metadata', jsonb_build_object('username', v_username, 'full_name', p_full_name)
               ),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key,
                 'apikey',        v_key
               )
  ) into v_req_id;

  loop
    select * into v_resp from net._http_response where id = v_req_id;
    if found and v_resp.status_code is not null then exit; end if;
    perform pg_sleep(0.3);
    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'auth admin createUser timed out';
    end if;
  end loop;

  if v_resp.status_code not in (200, 201) then
    raise exception 'Auth admin create failed (status %): %', v_resp.status_code, v_resp.content;
  end if;

  v_user_id := ((v_resp.content::jsonb) ->> 'id')::uuid;
  if v_user_id is null then
    raise exception 'Auth admin createUser returned no id: %', v_resp.content;
  end if;

  -- 2. Insert public.users row.
  insert into public.users (id, email, username, full_name, role, status, is_super_admin)
  values (v_user_id, v_email, v_username, coalesce(nullif(trim(p_full_name), ''), v_username),
          p_role, 'active', false);

  -- 3. Add to the main workspace (every internal user gets membership).
  select id into v_ws_id from public.workspaces where is_main = true limit 1;
  if v_ws_id is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws_id, v_user_id, 'member')
    on conflict do nothing;
  end if;

  return jsonb_build_object('id', v_user_id, 'username', v_username);
end;
$$;

revoke all on function public.admin_create_user(text, text, text, text) from public;
grant execute on function public.admin_create_user(text, text, text, text) to authenticated;
alter function public.admin_create_user(text, text, text, text) set statement_timeout = '20s';

-- ---------------------------------------------------------------------
-- admin_reset_password — set a new password for any user. Uses the
-- auth admin endpoint via pg_net.
-- ---------------------------------------------------------------------
create or replace function public.admin_reset_password(p_user_id uuid, p_new_password text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_key    text;
  v_url    text;
  v_req_id bigint;
  v_resp   record;
  v_tries  int := 0;
begin
  if not public.is_admin() then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'Password must be at least 8 characters' using errcode='22023';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'User not found';
  end if;

  select value into v_key from internal.app_secrets where key = 'service_role_key';
  select value into v_url from internal.app_secrets where key = 'supabase_url';
  if v_key is null or v_key = '' or v_url is null or v_url = '' then
    raise exception 'Admin secrets not configured';
  end if;

  select net.http_put(
    url     := v_url || '/auth/v1/admin/users/' || p_user_id::text,
    body    := jsonb_build_object('password', p_new_password),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key,
                 'apikey',        v_key
               )
  ) into v_req_id;

  loop
    select * into v_resp from net._http_response where id = v_req_id;
    if found and v_resp.status_code is not null then exit; end if;
    perform pg_sleep(0.3);
    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'auth admin reset password timed out';
    end if;
  end loop;

  if v_resp.status_code not in (200, 201, 204) then
    raise exception 'Auth admin reset password failed (status %): %', v_resp.status_code, v_resp.content;
  end if;
end;
$$;

revoke all on function public.admin_reset_password(uuid, text) from public;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
alter function public.admin_reset_password(uuid, text) set statement_timeout = '20s';
