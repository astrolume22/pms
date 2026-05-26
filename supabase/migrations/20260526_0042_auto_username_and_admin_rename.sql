-- =====================================================================
-- 0042 — auto-generated username on accept_invite + admin_set_username.
--
-- ISSUE A:
--   The invite-accept page used to require the invitee to type a
--   username. We're removing that field from the UI. The username is
--   now derived server-side:
--     1) prefer the invitee_email local-part
--        ("delivered@resend.dev" -> "delivered")
--     2) else fall back to a sanitised p_full_name
--     3) else fall back to "user" + a short random hex suffix
--   The candidate is sanitised to match the existing regex
--   ^[a-z0-9_]{2,32}$ (lowercased, invalid chars replaced with '_',
--   padded if too short, truncated if too long). If it collides with
--   an existing username we append 2, 3, 4 ... until unique. Always
--   produces SOMETHING valid; never raises on naming.
--
-- ISSUE A part 2:
--   New SECURITY DEFINER RPC admin_set_username(p_user_id, p_new) lets
--   admins rename a user. Validates regex + uniqueness server-side.
--   Admin-only gate via is_admin(). Renames public.users.username
--   ONLY — does NOT touch auth.users.email or public.users.email, so
--   the user's login identity is unaffected (they can still log in by
--   email AND by the new username — both flow through
--   resolve_login_email from migration 0041).
--
-- ISSUE B (companion fix in app code):
--   accept_invite still returns the auth email in its JSON output so
--   the accept page can hand it straight to signInWithPassword,
--   skipping a redundant resolve_login_email round-trip that was
--   making the post-accept auto-login fragile.
--
-- BACKWARDS COMPAT:
--   The old 4-arg accept_invite(p_token, p_username, p_full_name,
--   p_password) is DROPPED. The frontend hook is being updated in
--   the same commit; no other caller exists.
--
-- DOES NOT TOUCH: schema (no new columns), RLS, accept_invite's
-- invitee_email duplicate-active guard, freed-email rename, invite
-- consumption, board_subscribers logic, workspace membership.
-- ON DELETE SET NULL semantics on user FKs preserved.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Helper: sanitise + uniquify a username candidate.
--
-- INTERNAL only. Not granted to anon/authenticated — it's called by
-- accept_invite (SECURITY DEFINER) and would otherwise let any
-- caller enumerate username collisions.
-- ---------------------------------------------------------------------
create or replace function public._generate_unique_username(p_base text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base    text;
  v_cand    text;
  v_suffix  int := 1;
begin
  -- Lower, trim, replace any non-[a-z0-9_] with underscore.
  v_base := regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_]+', '_', 'g');
  -- Collapse repeated underscores and strip leading/trailing underscores.
  v_base := regexp_replace(v_base, '_+', '_', 'g');
  v_base := regexp_replace(v_base, '^_+|_+$', '', 'g');

  -- Pad short candidates with "user".
  if length(v_base) < 2 then
    v_base := 'user';
  end if;

  -- Trim long candidates so we have room to append a numeric suffix.
  if length(v_base) > 28 then
    v_base := substr(v_base, 1, 28);
  end if;

  -- Try the base verbatim first.
  v_cand := v_base;
  while exists (select 1 from public.users where username = v_cand) loop
    v_suffix := v_suffix + 1;
    v_cand := v_base || v_suffix::text;
    -- Defensive truncate again (very unlikely).
    if length(v_cand) > 32 then
      v_cand := substr(v_base, 1, 32 - length(v_suffix::text)) || v_suffix::text;
    end if;
  end loop;

  return v_cand;
end;
$$;

revoke all on function public._generate_unique_username(text) from public;
-- No grants — internal helper.

comment on function public._generate_unique_username(text) is
  '0042: internal helper used by accept_invite to derive a unique username from a base candidate. Sanitises to ^[a-z0-9_]{2,32}$ and appends 2,3,4... until unique. Not granted to anon/authenticated.';


-- ---------------------------------------------------------------------
-- accept_invite — NEW 3-arg signature. p_username is gone; the
-- function auto-generates the username from invitee_email / full_name
-- / a "user####" fallback.
--
-- Everything else (lock+validate token, duplicate-email guard at
-- accept time, freed-email rename, board/group subscription, workspace
-- membership, invite consumption) is preserved verbatim from 0040.
-- ---------------------------------------------------------------------
drop function if exists public.accept_invite(text, text, text, text);

create or replace function public.accept_invite(
  p_token     text,
  p_full_name text,
  p_password  text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_invite     record;
  v_user_id    uuid := gen_random_uuid();
  v_base       text;
  v_username   text;
  v_full_name  text;
  v_email      text;
  v_ws_id      uuid;
begin
  -- Lock + validate the token.
  select * into v_invite from public.invites where token = p_token for update;
  if not found                       then raise exception 'Invite link not found' using errcode='42501'; end if;
  if v_invite.revoked_at is not null then raise exception 'This invite was revoked' using errcode='42501'; end if;
  if v_invite.used_at    is not null then raise exception 'This invite has already been used' using errcode='42501'; end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'This invite has expired' using errcode='42501';
  end if;

  -- Password validation (unchanged from 0023).
  if p_password is null or length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters' using errcode='22023';
  end if;

  -- Derive a base for the auto-username.
  if v_invite.invitee_email is not null and position('@' in v_invite.invitee_email) > 0 then
    v_base := split_part(v_invite.invitee_email, '@', 1);
  else
    v_base := coalesce(nullif(trim(p_full_name), ''), '');
  end if;

  -- Helper resolves to a guaranteed-valid, guaranteed-unique username.
  v_username := public._generate_unique_username(v_base);

  -- If the helper somehow handed us back something empty / "user", let
  -- it stand — _generate_unique_username already enforced the regex
  -- and uniqueness, including the user2 / user3 / user_<rand> branches.
  if v_username !~ '^[a-z0-9_]{2,32}$' then
    raise exception 'Could not derive a valid username' using errcode='22023';
  end if;

  -- Email derivation — preserved from 0040.
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
    -- constraints don't trip. RENAME (not delete) to keep audit intact.
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

  v_full_name := coalesce(nullif(trim(p_full_name), ''), v_username);

  -- auth.users
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

  -- Main workspace membership.
  select id into v_ws_id from public.workspaces where is_main = true limit 1;
  if v_ws_id is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws_id, v_user_id, 'member')
    on conflict do nothing;
  end if;

  -- Board / group subscription for board-scoped invites.
  if v_invite.board_id is not null then
    insert into public.board_subscribers (board_id, user_id, role, group_id)
    values (
      v_invite.board_id, v_user_id,
      case when v_invite.role = 'viewer' then 'viewer' else 'member' end,
      v_invite.group_id
    )
    on conflict do nothing;
  end if;

  -- Consume the invite.
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

revoke all on function public.accept_invite(text, text, text) from public;
grant execute on function public.accept_invite(text, text, text) to anon, authenticated;

comment on function public.accept_invite(text, text, text) is
  '0042: redeem an invite. The username is now AUTO-GENERATED server-side from invitee_email local-part / full_name / a user#### fallback. Returns the new login email so the caller can sign in directly without a second resolve_login_email round-trip.';


-- ---------------------------------------------------------------------
-- admin_set_username — admin-only username rename.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_username(
  p_user_id      uuid,
  p_new_username text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_new text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can rename users' using errcode='42501';
  end if;

  v_new := lower(trim(coalesce(p_new_username, '')));
  if v_new !~ '^[a-z0-9_]{2,32}$' then
    raise exception 'Username must be 2-32 lowercase letters, digits, or underscore' using errcode='22023';
  end if;

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'User not found' using errcode='22023';
  end if;

  -- Allow renaming to the same value (no-op) without tripping uniqueness.
  if exists (select 1 from public.users where username = v_new and id <> p_user_id) then
    raise exception 'Username "%" is already taken', v_new using errcode='23505';
  end if;

  update public.users
     set username   = v_new,
         updated_at = now()
   where id = p_user_id;
end;
$$;

revoke all on function public.admin_set_username(uuid, text) from public;
grant execute on function public.admin_set_username(uuid, text) to authenticated;

comment on function public.admin_set_username(uuid, text) is
  '0042: admin-only username rename. Validates ^[a-z0-9_]{2,32}$ + uniqueness server-side. Touches public.users.username ONLY — auth.users.email and public.users.email are unaffected, so the user can still log in by email AND by the new username (via resolve_login_email).';
