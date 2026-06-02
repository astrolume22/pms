-- =====================================================================
-- 0056 — accept_invite writes ACL grants instead of board_subscribers.group_id
-- =====================================================================
-- Phase 3 follow-up to 0055. The earlier function (last touched by 0042)
-- stored an invite's group scope on board_subscribers.group_id. Migration
-- 0055 made group_user_visibility the single source of truth for
-- visibility and nulled out the existing per-group rows, so this RPC
-- has to translate too:
--
--   • board_subscribers still records membership, but with group_id = NULL.
--   • If the invite carried a non-null group_id, the same flow now also
--     inserts ONE group_user_visibility row for the new user × that
--     group. granted_by = the inviter (v_invite.created_by) so the
--     audit trail is meaningful.
--   • Board-wide invites (group_id IS NULL) grant ZERO ACL rows by
--     default — Decision 2 (least-privilege). The admin grants groups
--     explicitly via the new admin Group access matrix.
--
-- Everything outside the membership block is byte-identical to the
-- prior body (preserved verbatim from a live pg_get_functiondef dump).
-- =====================================================================

create or replace function public.accept_invite(p_token text, p_full_name text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  v_username := public._generate_unique_username(v_base);

  if v_username !~ '^[a-z0-9_]{2,32}$' then
    raise exception 'Could not derive a valid username' using errcode='22023';
  end if;

  -- Email derivation — preserved from 0040.
  if v_invite.invitee_email is not null then
    if exists (
      select 1 from public.users
      where lower(email) = lower(v_invite.invitee_email)
        and status = 'active'
    ) then
      raise exception 'An active account already uses this email' using errcode='23505';
    end if;

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

  -- Board membership for board-scoped invites.
  -- Membership is now decoupled from per-group visibility:
  --   * board_subscribers gets group_id = NULL (membership signal only)
  --   * if the invite was group-scoped, ALSO grant the single group via
  --     group_user_visibility (the new ACL since migration 0055).
  if v_invite.board_id is not null then
    insert into public.board_subscribers (board_id, user_id, role, group_id)
    values (
      v_invite.board_id, v_user_id,
      case when v_invite.role = 'viewer' then 'viewer' else 'member' end,
      null   -- ← was v_invite.group_id; now ACL-driven below
    )
    on conflict do nothing;

    if v_invite.group_id is not null then
      insert into public.group_user_visibility (user_id, group_id, granted_by)
      values (v_user_id, v_invite.group_id, v_invite.created_by)
      on conflict (user_id, group_id) do nothing;
    end if;
    -- Board-wide invites (group_id IS NULL) intentionally grant ZERO
    -- ACL rows. The admin must explicitly grant via the new Group
    -- access matrix in /admin (Decision 2: least-privilege).
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
$function$;
