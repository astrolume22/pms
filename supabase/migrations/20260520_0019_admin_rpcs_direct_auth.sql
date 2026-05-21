-- =====================================================================
-- Phase 6 — Switch admin_create_user / admin_reset_password from
-- pg_net + GoTrue HTTP to direct SQL manipulation of auth.users +
-- auth.identities.
--
-- Why: pg_net.http_post() to the project's own GoTrue endpoint times
-- out in hosted Supabase environments (the worker can't always reach
-- the project URL). Direct DML is faster, self-contained, and matches
-- what Supabase's own admin API does internally.
--
-- Both functions run as SECURITY DEFINER (postgres) which has full
-- access to the auth schema. The admin / super-admin guards remain.
-- =====================================================================

-- ---------------------------------------------------------------------
-- admin_create_user — directly insert into auth.users + auth.identities
-- with a bcrypt-hashed password, then populate public.users +
-- workspace_members. Idempotent for the username (errors if it exists).
-- ---------------------------------------------------------------------
create or replace function public.admin_create_user(
  p_username  text,
  p_full_name text,
  p_role      text,
  p_password  text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email      text;
  v_username   text;
  v_user_id    uuid := gen_random_uuid();
  v_ws_id      uuid;
  v_full_name  text;
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
  v_full_name := coalesce(nullif(trim(p_full_name), ''), v_username);

  -- 1. Insert auth.users — the bcrypt hash matches Supabase GoTrue's
  --    format (`gen_salt('bf')` produces $2a$ which auth accepts).
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    is_sso_user,
    is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('username', v_username, 'full_name', v_full_name),
    now(),
    now(),
    '', '', '', '',
    false,
    false
  );

  -- 2. Insert auth.identities. Modern Supabase uses user_id as the
  --    provider_id for email auth. identity_data must contain `sub`
  --    and `email`.
  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    v_user_id::text,
    v_user_id,
    jsonb_build_object(
      'sub',            v_user_id::text,
      'email',          v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    null,
    now(),
    now()
  );

  -- 3. Insert public.users row.
  insert into public.users (id, email, username, full_name, role, status, is_super_admin)
  values (v_user_id, v_email, v_username, v_full_name, p_role, 'active', false);

  -- 4. Add to the main workspace.
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

-- ---------------------------------------------------------------------
-- admin_reset_password — direct UPDATE on auth.users.encrypted_password.
-- Cancels any in-flight recovery tokens. The user keeps their existing
-- session until it refreshes (we deliberately don't invalidate
-- refresh_tokens here — `admin_set_status('deactivated')` is the path
-- for an immediate boot).
-- ---------------------------------------------------------------------
create or replace function public.admin_reset_password(p_user_id uuid, p_new_password text)
returns void
language plpgsql security definer set search_path = public as $$
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

  update auth.users
  set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      recovery_token     = '',
      recovery_sent_at   = null,
      updated_at         = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.admin_reset_password(uuid, text) from public;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
