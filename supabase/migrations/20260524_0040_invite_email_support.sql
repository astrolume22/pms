-- =====================================================================
-- 0040 — invite email support (PART 1 — backend).
--
-- (a) Add nullable invites.invitee_email so an admin can stash the
--     invitee's real email on the invite row at mint time. Strictly
--     additive — no schema change beyond this single nullable column.
--
-- (b) create_invite() now accepts an optional p_invitee_email param
--     and stores it on the new row. Auth gate (is_admin only) and
--     three-role acceptance (admin/manager/viewer) from 0039 are
--     preserved verbatim. Never-expires from 0037 also preserved.
--
-- (c) accept_invite() now uses the invite's invitee_email (when set)
--     as the real public.users.email + auth.users.email — instead of
--     the synthetic username@pms.internal. Username + password flow
--     is unchanged; the invitee still only types those two. When
--     invitee_email is null the old synthetic-email path runs
--     verbatim.
--
-- (d) Duplicate-email handling at accept time (NOT mint time):
--       • If an ACTIVE public.users row already holds this email →
--         raise '23505 An active account already uses this email'.
--       • If the email is "freed" (no active user has it anymore,
--         either the row is gone or status != 'active') → allow.
--         To make this work despite auth.users' UNIQUE(email)
--         constraint, we RENAME any lingering auth.users row that
--         holds the email but has no active public.users counterpart,
--         to a unique placeholder `freed_<uuid>@pms.internal`. We do
--         NOT delete the auth row — auth audit stays intact.
--
-- NO RLS / schema changes beyond the new nullable column. ON DELETE
-- SET NULL semantics on user FKs preserved. answers table not touched.
-- =====================================================================

-- (a) -----------------------------------------------------------------
alter table public.invites
  add column if not exists invitee_email text;

comment on column public.invites.invitee_email is
  '0040: optional real email the invitee will use as their account email when they accept. Null = fall back to synthetic username@pms.internal (legacy behaviour).';


-- (b) -----------------------------------------------------------------
-- New 5-arg signature replaces the 4-arg one from 0039. Drop the old
-- function to avoid PostgREST's "function is not unique" ambiguity.
drop function if exists public.create_invite(text, uuid, int, uuid);

create or replace function public.create_invite(
  p_role             text,
  p_board_id         uuid default null,
  p_expires_in_hours int  default 168,
  p_group_id         uuid default null,
  p_invitee_email    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token       text;
  v_id          uuid;
  v_expires_at  timestamptz;
  v_hours       int;
  v_email       text;
begin
  -- AUTH GATE — unchanged (admin-only).
  if not public.is_admin() then
    raise exception 'Only admins can mint invite links' using errcode='42501';
  end if;

  -- ROLE VALIDATION — from 0039 (admin / manager / viewer).
  if p_role not in ('admin', 'manager', 'viewer') then
    raise exception 'Invalid invite role: % (must be admin / manager / viewer)', p_role
      using errcode = '22023';
  end if;

  -- Group scope requires a board (unchanged).
  if p_group_id is not null then
    if p_board_id is null then
      raise exception 'Group-scoped invite requires p_board_id' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.groups
      where id = p_group_id and board_id = p_board_id and deleted_at is null
    ) then
      raise exception 'Group not found on this board' using errcode='22023';
    end if;
  end if;

  -- Normalize the invitee email — trim + lowercase. Null/empty stays
  -- null. We deliberately do NOT block on duplicates at mint time;
  -- the freed-email policy is enforced inside accept_invite() so an
  -- admin can pre-mint a link for an email that's about to be freed.
  v_email := nullif(lower(trim(coalesce(p_invitee_email, ''))), '');

  -- NEVER-EXPIRES (preserved from 0037).
  if p_expires_in_hours is null or p_expires_in_hours <= 0 then
    v_expires_at := null;
  else
    v_hours := greatest(1, least(p_expires_in_hours, 24 * 30));
    v_expires_at := now() + make_interval(hours => v_hours);
  end if;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');

  insert into public.invites (token, role, board_id, group_id, created_by, expires_at, invitee_email)
  values (v_token, p_role, p_board_id, p_group_id, auth.uid(), v_expires_at, v_email)
  returning id into v_id;

  return jsonb_build_object(
    'id',            v_id,
    'token',         v_token,
    'role',          p_role,
    'board_id',      p_board_id,
    'group_id',      p_group_id,
    'expires_at',    v_expires_at,
    'invitee_email', v_email
  );
end;
$$;

revoke all on function public.create_invite(text, uuid, int, uuid, text) from public;
grant execute on function public.create_invite(text, uuid, int, uuid, text) to authenticated;


-- (c) + (d) -----------------------------------------------------------
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
  -- Lock + validate the token (unchanged).
  select * into v_invite from public.invites where token = p_token for update;
  if not found                       then raise exception 'Invite link not found' using errcode='42501'; end if;
  if v_invite.revoked_at is not null then raise exception 'This invite was revoked' using errcode='42501'; end if;
  if v_invite.used_at    is not null then raise exception 'This invite has already been used' using errcode='42501'; end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'This invite has expired' using errcode='42501';
  end if;

  -- Password + username validation (unchanged from 0023).
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

  -- 0040: derive v_email from the invite's invitee_email when set,
  -- else fall back to the legacy synthetic username@pms.internal.
  if v_invite.invitee_email is not null then
    -- Duplicate-email guard — at ACCEPT time, against ACTIVE users.
    if exists (
      select 1 from public.users
      where lower(email) = lower(v_invite.invitee_email)
        and status = 'active'
    ) then
      raise exception 'An active account already uses this email' using errcode='23505';
    end if;

    -- FREE the email from any stale rows so the new INSERT's UNIQUE
    -- constraints (public.users.email + auth.users.email) don't trip.
    -- We RENAME (not delete) so audit + FK references stay intact.
    -- Placeholders are uuid-unique by row id so they can't collide.
    --
    -- Order matters: public.users first (so the subquery used by the
    -- auth.users update — `id not in (...active...)` — still sees the
    -- old status), then auth.users.
    update public.users
       set email = 'freed_' || id::text || '@pms.internal'
     where lower(email) = lower(v_invite.invitee_email)
       and status <> 'active';

    update auth.users
       set email = 'freed_' || id::text || '@pms.internal'
     where lower(email) = lower(v_invite.invitee_email)
       and id not in (select id from public.users where status = 'active');

    v_email := lower(v_invite.invitee_email);
  else
    v_email := v_username || '@pms.internal';
  end if;

  v_full_name := coalesce(nullif(trim(p_full_name),''), v_username);

  -- auth.users (same shape as before — just sourcing v_email differently).
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

  insert into public.users (id, email, username, full_name, role, status, is_super_admin)
  values (v_user_id, v_email, v_username, v_full_name, v_invite.role, 'active', false);

  -- Main workspace membership (unchanged).
  select id into v_ws_id from public.workspaces where is_main = true limit 1;
  if v_ws_id is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws_id, v_user_id, 'member')
    on conflict do nothing;
  end if;

  -- Board / group subscription for board-scoped invites (unchanged
  -- from 0023 — viewers → board_subscribers.role='viewer').
  if v_invite.board_id is not null then
    insert into public.board_subscribers (board_id, user_id, role, group_id)
    values (
      v_invite.board_id, v_user_id,
      case when v_invite.role = 'viewer' then 'viewer' else 'member' end,
      v_invite.group_id
    )
    on conflict do nothing;
  end if;

  -- Consume the invite (unchanged).
  update public.invites
  set used_at = now(), used_by = v_user_id
  where id = v_invite.id;

  return jsonb_build_object(
    'user_id',  v_user_id,
    'username', v_username,
    'email',    v_email,
    'board_id', v_invite.board_id,
    'group_id', v_invite.group_id
  );
end;
$$;

revoke all on function public.accept_invite(text, text, text, text) from public;
grant execute on function public.accept_invite(text, text, text, text) to anon, authenticated;
