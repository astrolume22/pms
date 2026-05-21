-- =====================================================================
-- Phase 6.5 — Invite link system (no email).
--
-- Admins / board owners generate single-use, time-limited invite tokens.
-- The link can be shared on any channel (WhatsApp, Signal, etc.). When
-- the recipient opens /invite/{token} they pick a username + password
-- and the SECURITY DEFINER `accept_invite` RPC creates the auth + users
-- + workspace-membership rows in a single transaction.
--
-- Workspace-wide invite: board_id IS NULL.
-- Board-specific invite: board_id set + accept also subscribes the new
--                        user to that board with role 'member'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- invites table
-- ---------------------------------------------------------------------
create table if not exists public.invites (
  id         uuid primary key default uuid_generate_v4(),
  token      text not null unique,
  role       text not null check (role in ('admin','manager','viewer')),
  board_id   uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid,
  revoked_at timestamptz,
  constraint invites_board_fk      foreign key (board_id)   references public.boards(id) on delete cascade,
  constraint invites_created_by_fk foreign key (created_by) references public.users(id)  on delete cascade,
  constraint invites_used_by_fk    foreign key (used_by)    references public.users(id)  on delete set null
);

create index if not exists invites_token_idx      on public.invites (token);
create index if not exists invites_board_idx      on public.invites (board_id);
create index if not exists invites_created_by_idx on public.invites (created_by);
create index if not exists invites_expires_idx    on public.invites (expires_at);

-- ---------------------------------------------------------------------
-- RLS — admin / creator can SELECT their invites. INSERT / UPDATE /
-- DELETE only happen through the SECURITY DEFINER RPCs below, so we
-- intentionally don't grant write policies (the RPCs run as postgres
-- and bypass RLS).
-- ---------------------------------------------------------------------
alter table public.invites enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='invites' loop
    execute format('drop policy if exists %I on public.invites', r.policyname);
  end loop;
end $$;

create policy invites_select on public.invites for select
  to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or (
      -- Board owners can see invites for their boards.
      board_id is not null
      and exists (select 1 from public.boards b where b.id = invites.board_id and b.owner_id = auth.uid())
    )
  );

grant select on public.invites to authenticated;

-- ---------------------------------------------------------------------
-- create_invite — admin / manager / board owner can mint a new token.
-- For board-specific invites the caller must own the board (or be an
-- admin). p_expires_in_hours bounded to 1 hour … 30 days.
-- ---------------------------------------------------------------------
create or replace function public.create_invite(
  p_role               text,
  p_board_id           uuid default null,
  p_expires_in_hours   int default 168     -- 7 days
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role        text;
  v_token       text;
  v_id          uuid;
  v_expires_at  timestamptz;
  v_hours       int;
begin
  if not public.is_active_user() then
    raise exception 'Active session required' using errcode='42501';
  end if;
  if p_role not in ('admin','manager','viewer') then
    raise exception 'Invalid role: %', p_role using errcode='22023';
  end if;

  -- Permission gate: admin, OR (manager creating non-admin invites),
  -- OR (board owner creating an invite for their own board).
  if public.is_admin() then
    v_role := p_role;
  elsif p_board_id is not null
        and exists (select 1 from public.boards where id = p_board_id and owner_id = auth.uid()) then
    -- Board owner — can only invite as manager/viewer (no new admins via owners).
    if p_role = 'admin' then
      raise exception 'Only admins can mint admin invites' using errcode='42501';
    end if;
    v_role := p_role;
  elsif public.current_user_role() = 'manager' and p_role <> 'admin' then
    v_role := p_role;
  else
    raise exception 'Only admins, managers, or the board owner can mint invites' using errcode='42501';
  end if;

  -- Clamp duration.
  v_hours := greatest(1, least(coalesce(p_expires_in_hours, 168), 24*30));
  v_expires_at := now() + make_interval(hours => v_hours);

  -- URL-safe 32-char token (hex from 16 random bytes).
  v_token := encode(extensions.gen_random_bytes(16), 'hex');

  insert into public.invites (token, role, board_id, created_by, expires_at)
  values (v_token, v_role, p_board_id, auth.uid(), v_expires_at)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'token', v_token,
    'role', v_role,
    'board_id', p_board_id,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function public.create_invite(text, uuid, int) from public;
grant execute on function public.create_invite(text, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- revoke_invite — admin or the original creator can void a pending
-- invite. Already-used invites are ignored.
-- ---------------------------------------------------------------------
create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_creator uuid;
begin
  select created_by into v_creator from public.invites where id = p_invite_id;
  if not found then raise exception 'Invite not found'; end if;
  if not (public.is_admin() or v_creator = auth.uid()) then
    raise exception 'Only the creator or an admin can revoke' using errcode='42501';
  end if;
  update public.invites
  set revoked_at = coalesce(revoked_at, now())
  where id = p_invite_id and used_at is null;
end;
$$;

revoke all on function public.revoke_invite(uuid) from public;
grant execute on function public.revoke_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_invite_by_token — PUBLIC: invitee has no account yet, so the
-- accept page calls this with anon credentials. We never expose the
-- creator's user_id or the raw row; only enough info to render the
-- accept form (role + optional board name).
-- ---------------------------------------------------------------------
create or replace function public.get_invite_by_token(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_invite record;
  v_board_name text;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    return jsonb_build_object('valid', false, 'reason', 'missing');
  end if;
  select * into v_invite from public.invites where token = p_token;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  if v_invite.revoked_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'revoked');
  end if;
  if v_invite.used_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'used');
  end if;
  if v_invite.expires_at <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;
  if v_invite.board_id is not null then
    select name into v_board_name from public.boards where id = v_invite.board_id;
  end if;
  return jsonb_build_object(
    'valid',      true,
    'role',       v_invite.role,
    'board_id',   v_invite.board_id,
    'board_name', v_board_name,
    'expires_at', v_invite.expires_at
  );
end;
$$;

revoke all on function public.get_invite_by_token(text) from public;
grant execute on function public.get_invite_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- accept_invite — PUBLIC: redeem an invite. Atomic: validates token,
-- creates auth.users + auth.identities (bcrypt password via pgcrypto),
-- inserts public.users + workspace_members + (if board-specific)
-- board_subscribers, and marks the invite consumed.
--
-- Caller is NOT authenticated (the invitee doesn't have an account
-- yet), so this runs as the anon role but with SECURITY DEFINER → the
-- postgres role does the work and bypasses RLS.
-- ---------------------------------------------------------------------
create or replace function public.accept_invite(
  p_token     text,
  p_username  text,
  p_full_name text,
  p_password  text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_invite     record;
  v_user_id    uuid := gen_random_uuid();
  v_username   text;
  v_full_name  text;
  v_email      text;
  v_ws_id      uuid;
begin
  -- 1. Lock + validate the token. Using FOR UPDATE means a race
  --    between two acceptors can't both succeed.
  select * into v_invite from public.invites where token = p_token for update;
  if not found then
    raise exception 'Invite link not found' using errcode='42501';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'This invite was revoked' using errcode='42501';
  end if;
  if v_invite.used_at is not null then
    raise exception 'This invite has already been used' using errcode='42501';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'This invite has expired' using errcode='42501';
  end if;

  -- 2. Validate the proposed credentials.
  if p_password is null or length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters' using errcode='22023';
  end if;
  v_username := lower(trim(coalesce(p_username,'')));
  if v_username = '' or v_username !~ '^[a-z0-9_]{2,32}$' then
    raise exception 'Username must be 2-32 characters of lowercase letters, digits, or underscore' using errcode='22023';
  end if;
  if exists (select 1 from public.users where username = v_username) then
    raise exception 'Username "%" is already taken', v_username using errcode='23505';
  end if;
  v_email := v_username || '@pms.internal';
  v_full_name := coalesce(nullif(trim(p_full_name),''), v_username);

  -- 3. auth.users + auth.identities (same shape as admin_create_user).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
    jsonb_build_object('username', v_username, 'full_name', v_full_name),
    now(), now(),
    '', '', '', '',
    false, false
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_user_id::text, v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', null, now(), now()
  );

  -- 4. public.users with the invited role.
  insert into public.users (id, email, username, full_name, role, status, is_super_admin)
  values (v_user_id, v_email, v_username, v_full_name, v_invite.role, 'active', false);

  -- 5. Main workspace membership.
  select id into v_ws_id from public.workspaces where is_main = true limit 1;
  if v_ws_id is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws_id, v_user_id, 'member')
    on conflict do nothing;
  end if;

  -- 6. Board-specific invite → also subscribe them to the board.
  if v_invite.board_id is not null then
    insert into public.board_subscribers (board_id, user_id, role)
    values (v_invite.board_id, v_user_id, case when v_invite.role = 'viewer' then 'viewer' else 'member' end)
    on conflict do nothing;
  end if;

  -- 7. Mark the invite consumed.
  update public.invites
  set used_at = now(), used_by = v_user_id
  where id = v_invite.id;

  return jsonb_build_object(
    'user_id', v_user_id,
    'username', v_username,
    'email', v_email,
    'board_id', v_invite.board_id
  );
end;
$$;

revoke all on function public.accept_invite(text, text, text, text) from public;
grant execute on function public.accept_invite(text, text, text, text) to anon, authenticated;
