-- =====================================================================
-- 0039 — create_invite: allow admin / manager / viewer roles.
--
-- Migration 0023 narrowed create_invite to manager-only ("Invites can
-- only assign the manager role"), and it hardcoded 'manager' in the
-- INSERT + the returned jsonb. Migration 0037 (never-expires) kept
-- both quirks. The UI now offers an Admin/Manager/Viewer selector —
-- relax create_invite to honour the caller-supplied role.
--
-- AUTH GATE UNCHANGED: still `is_admin()` only. Managers and viewers
-- still cannot mint invites. We're only widening WHICH role the
-- created invite carries, not WHO can create one.
--
-- accept_invite already handles all three: it subscribes
-- board-scoped invitees as board_subscribers.role = 'viewer' when
-- v_invite.role = 'viewer', else 'member'. Untouched here.
--
-- Preserves migration 0037's null-expires-at semantics verbatim.
--
-- Strictly additive: no schema change, no RLS policy change, no
-- column changes. Only the create_invite function body is updated.
-- =====================================================================

create or replace function public.create_invite(
  p_role             text,
  p_board_id         uuid default null,
  p_expires_in_hours int  default 168,
  p_group_id         uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token       text;
  v_id          uuid;
  v_expires_at  timestamptz;
  v_hours       int;
begin
  -- AUTH GATE — unchanged. Admin-only mint. Managers + viewers fall
  -- through to the 42501 RLS-style error so the UI doesn't surface
  -- the option to them.
  if not public.is_admin() then
    raise exception 'Only admins can mint invite links' using errcode='42501';
  end if;

  -- ROLE VALIDATION — widened from the manager-only gate that 0023
  -- introduced. Anything outside the three legal roles is a 22023
  -- so callers get a clean PostgREST error.
  if p_role not in ('admin', 'manager', 'viewer') then
    raise exception 'Invalid invite role: % (must be admin / manager / viewer)', p_role
      using errcode = '22023';
  end if;

  -- Group scope requires a board (unchanged from 0023).
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

  -- NEVER-EXPIRES (preserved from 0037). null / 0 / negative ⇒ NULL
  -- expires_at; positive ⇒ clamp to 1h..30d.
  if p_expires_in_hours is null or p_expires_in_hours <= 0 then
    v_expires_at := null;
  else
    v_hours := greatest(1, least(p_expires_in_hours, 24 * 30));
    v_expires_at := now() + make_interval(hours => v_hours);
  end if;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');

  -- Use p_role here (was hardcoded 'manager' before 0039). The
  -- invites.role CHECK constraint (set in 0020) already enforces the
  -- three-value enum at the DB level as a defence-in-depth.
  insert into public.invites (token, role, board_id, group_id, created_by, expires_at)
  values (v_token, p_role, p_board_id, p_group_id, auth.uid(), v_expires_at)
  returning id into v_id;

  return jsonb_build_object(
    'id',         v_id,
    'token',      v_token,
    'role',       p_role,                 -- was 'manager' literal
    'board_id',   p_board_id,
    'group_id',   p_group_id,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function public.create_invite(text, uuid, int, uuid) from public;
grant execute on function public.create_invite(text, uuid, int, uuid) to authenticated;
