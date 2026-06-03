-- =====================================================================
-- 0059 — Admin shift control RPCs (Phase 4.7)
-- =====================================================================
-- Adds two missing admin-only RPCs so the founder can configure each
-- manager's shift parameters and weekday schedule from a control panel
-- in /admin. Existing lock/unlock/rearm RPCs from 0057 are unchanged.
--
-- Additive only — no destructive table changes. One small relaxation:
-- shift_events.session_id is dropped from NOT NULL so config-change
-- audit events (which aren't tied to a single session) can be recorded
-- with session_id=NULL. Lifecycle events (start/break/lock/etc) still
-- always carry session_id from the RPCs that emit them.
-- =====================================================================

-- ---------- 1. Allow audit events without a session ------------------
alter table public.shift_events alter column session_id drop not null;

-- ---------- 2. shift_admin_set_config --------------------------------
-- Overwrites a manager's shift_configs row. All parameters are passed
-- by the caller as the full new state (the frontend prepopulates from
-- the current row, lets the admin edit, then sends everything back).
-- Records updated_by + updated_at and writes a shift_events
-- 'admin_override' with the old/new diff in meta.
--
-- Validation:
--   • is_admin() — server-side RLS-grade gate.
--   • mode IN ('easy','medium','hard').
--   • All int params must be > 0 (sanity).
--   • target user must exist + be active (we refuse to configure
--     deactivated rows so the audit trail stays meaningful).
--
-- Upsert: if the row is absent (e.g. target user was promoted from
-- viewer→manager after 0057's seed ran), it inserts with the admin's
-- payload + records the "create" path in the audit meta.
create or replace function public.shift_admin_set_config(
  p_target_user_id                uuid,
  p_mode                          text,
  p_shift_break_seconds           int,
  p_bio_break_max_per_day         int,
  p_bio_break_warn_count          int,
  p_bio_break_warn_total_seconds  int,
  p_bio_break_max_seconds_each    int,
  p_primary_group_id              uuid
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.shift_configs;
  v_existed boolean;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  if p_mode not in ('easy','medium','hard') then
    raise exception 'mode must be easy/medium/hard' using errcode='22023';
  end if;
  if p_shift_break_seconds          <= 0 then raise exception 'shift_break_seconds must be > 0' using errcode='22023'; end if;
  if p_bio_break_max_per_day        <= 0 then raise exception 'bio_break_max_per_day must be > 0' using errcode='22023'; end if;
  if p_bio_break_warn_count         <  0 then raise exception 'bio_break_warn_count must be >= 0' using errcode='22023'; end if;
  if p_bio_break_warn_total_seconds <  0 then raise exception 'bio_break_warn_total_seconds must be >= 0' using errcode='22023'; end if;
  if p_bio_break_max_seconds_each   <= 0 then raise exception 'bio_break_max_seconds_each must be > 0' using errcode='22023'; end if;

  -- Verify the target user exists and is active.
  if not exists (
    select 1 from public.users where id = p_target_user_id and status='active'
  ) then
    raise exception 'target user not found or inactive' using errcode='42501';
  end if;

  select * into v_old from public.shift_configs where user_id = p_target_user_id;
  v_existed := found;

  insert into public.shift_configs (
    user_id, mode,
    shift_break_seconds, bio_break_max_per_day, bio_break_warn_count,
    bio_break_warn_total_seconds, bio_break_max_seconds_each,
    primary_group_id, updated_at, updated_by
  ) values (
    p_target_user_id, p_mode,
    p_shift_break_seconds, p_bio_break_max_per_day, p_bio_break_warn_count,
    p_bio_break_warn_total_seconds, p_bio_break_max_seconds_each,
    p_primary_group_id, now(), v_uid
  )
  on conflict (user_id) do update set
    mode                          = excluded.mode,
    shift_break_seconds           = excluded.shift_break_seconds,
    bio_break_max_per_day         = excluded.bio_break_max_per_day,
    bio_break_warn_count          = excluded.bio_break_warn_count,
    bio_break_warn_total_seconds  = excluded.bio_break_warn_total_seconds,
    bio_break_max_seconds_each    = excluded.bio_break_max_seconds_each,
    primary_group_id              = excluded.primary_group_id,
    updated_at                    = now(),
    updated_by                    = v_uid;

  insert into public.shift_events (session_id, user_id, type, by, meta) values (
    null, p_target_user_id, 'admin_override', v_uid,
    jsonb_build_object(
      'action', 'set_config',
      'existed_before', v_existed,
      'old', case when v_existed then to_jsonb(v_old) else null end,
      'new', jsonb_build_object(
        'mode',                          p_mode,
        'shift_break_seconds',           p_shift_break_seconds,
        'bio_break_max_per_day',         p_bio_break_max_per_day,
        'bio_break_warn_count',          p_bio_break_warn_count,
        'bio_break_warn_total_seconds',  p_bio_break_warn_total_seconds,
        'bio_break_max_seconds_each',    p_bio_break_max_seconds_each,
        'primary_group_id',              p_primary_group_id
      )
    )
  );

  return jsonb_build_object('user_id', p_target_user_id, 'existed_before', v_existed);
end;
$$;

-- ---------- 3. shift_admin_set_schedule ------------------------------
-- Upserts ONE (user, weekday) row in shift_schedules. The frontend
-- calls this 7× per save (or only for changed days — both are valid).
create or replace function public.shift_admin_set_schedule(
  p_target_user_id   uuid,
  p_weekday          smallint,
  p_enabled          boolean,
  p_required_seconds int
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.shift_schedules;
  v_existed boolean;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  if p_weekday < 0 or p_weekday > 6 then
    raise exception 'weekday must be 0-6 (Sun-Sat)' using errcode='22023';
  end if;
  if p_required_seconds < 0 or p_required_seconds > 86400 then
    raise exception 'required_seconds must be 0-86400' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.users where id = p_target_user_id and status='active'
  ) then
    raise exception 'target user not found or inactive' using errcode='42501';
  end if;

  select * into v_old from public.shift_schedules
   where user_id = p_target_user_id and weekday = p_weekday;
  v_existed := found;

  insert into public.shift_schedules (user_id, weekday, enabled, required_seconds)
  values (p_target_user_id, p_weekday, p_enabled, p_required_seconds)
  on conflict (user_id, weekday) do update set
    enabled          = excluded.enabled,
    required_seconds = excluded.required_seconds;

  -- Only emit an audit event when something actually changed — saving
  -- the same values back is a frequent no-op from the UI (we send all
  -- 7 days even when only 1 was touched).
  if not v_existed
     or v_old.enabled <> p_enabled
     or v_old.required_seconds <> p_required_seconds then
    insert into public.shift_events (session_id, user_id, type, by, meta) values (
      null, p_target_user_id, 'admin_override', v_uid,
      jsonb_build_object(
        'action', 'set_schedule',
        'weekday', p_weekday,
        'existed_before', v_existed,
        'old', case when v_existed then jsonb_build_object('enabled', v_old.enabled, 'required_seconds', v_old.required_seconds) else null end,
        'new', jsonb_build_object('enabled', p_enabled, 'required_seconds', p_required_seconds)
      )
    );
  end if;

  return jsonb_build_object('user_id', p_target_user_id, 'weekday', p_weekday, 'changed', not v_existed or v_old.enabled <> p_enabled or v_old.required_seconds <> p_required_seconds);
end;
$$;

-- ---------- 4. GRANTs ------------------------------------------------
grant execute on function public.shift_admin_set_config(uuid, text, int, int, int, int, int, uuid) to authenticated;
grant execute on function public.shift_admin_set_schedule(uuid, smallint, boolean, int) to authenticated;
