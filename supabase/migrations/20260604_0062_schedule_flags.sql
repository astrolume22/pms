-- =====================================================================
-- 0062 — Schedule enforcement + late-start / early-end flags (Phase 4.5)
-- =====================================================================
-- Additive (nullable cols and DEFAULT-backfilled NOT NULL cols), no
-- destructive changes. Idempotent.
--
-- LOCKED DECISIONS from prompt + clarification:
--   • Per-employee timezone on shift_configs (NOT users.timezone).
--     Default 'Asia/Manila'. Admin can edit per-employee.
--   • Per-employee late-start threshold on shift_configs (default 900s).
--   • Per-weekday optional start_time_local on shift_schedules.
--   • Add shift_admin_force_end RPC so early_end_flag actually fires
--     (natural 8h completion always lands at or after expected_end_at,
--     so early_end is only meaningful when admin force-ends a session
--     before required_seconds have elapsed).
--   • All flag decisions computed server-side from now() in the
--     employee's tz — never the browser clock.
-- =====================================================================

-- ---------- 1. shift_configs new columns -----------------------------
alter table public.shift_configs
  add column if not exists timezone                       text not null default 'Asia/Manila',
  add column if not exists late_start_threshold_seconds   int  not null default 900;

-- ---------- 2. shift_schedules new column ----------------------------
alter table public.shift_schedules
  add column if not exists start_time_local time null;

-- ---------- 3. shift_sessions new flag columns -----------------------
alter table public.shift_sessions
  add column if not exists late_start_flag      boolean      null,
  add column if not exists late_start_minutes   int          null,
  add column if not exists early_end_flag       boolean      null,
  add column if not exists early_end_minutes    int          null,
  add column if not exists expected_end_at      timestamptz  null,
  add column if not exists scheduled_start_at   timestamptz  null;

-- ---------- 4. shift_events: add 'late_start' + 'early_end' types ----
alter table public.shift_events drop constraint if exists shift_events_type_check;
alter table public.shift_events add constraint shift_events_type_check
  check (type = any (array[
    'shift_start'::text,
    'period_85_alert'::text,
    'period_lock'::text,
    'period_unlock'::text,
    'shift_break_start'::text,
    'shift_break_end'::text,
    'bio_break_start'::text,
    'bio_break_end'::text,
    'bio_break_auto_end'::text,
    'bio_break_request'::text,
    'bio_break_request_decided'::text,
    'shift_complete'::text,
    'admin_override'::text,
    'late_start'::text,
    'early_end'::text
  ]));

-- ---------- 5. shift_admin_set_schedule — add start_time_local ------
-- Old signature (uuid, smallint, boolean, int) is dropped + recreated
-- with an added defaulted nullable param. Existing frontend callers
-- that omit the new param keep working (defaults to null = no
-- start-window).
drop function if exists public.shift_admin_set_schedule(uuid, smallint, boolean, int);

create or replace function public.shift_admin_set_schedule(
  p_target_user_id   uuid,
  p_weekday          smallint,
  p_enabled          boolean,
  p_required_seconds int,
  p_start_time_local time default null
) returns jsonb
  language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.shift_schedules;
  v_existed boolean;
  v_changed boolean;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  if p_weekday < 0 or p_weekday > 6 then
    raise exception 'weekday must be 0-6 (Sun-Sat)' using errcode='22023';
  end if;
  if p_required_seconds < 0 or p_required_seconds > 86400 then
    raise exception 'required_seconds must be 0-86400' using errcode='22023';
  end if;
  if not exists (select 1 from public.users where id = p_target_user_id and status='active') then
    raise exception 'target user not found or inactive' using errcode='42501';
  end if;

  select * into v_old from public.shift_schedules
   where user_id = p_target_user_id and weekday = p_weekday;
  v_existed := found;

  insert into public.shift_schedules (user_id, weekday, enabled, required_seconds, start_time_local)
  values (p_target_user_id, p_weekday, p_enabled, p_required_seconds, p_start_time_local)
  on conflict (user_id, weekday) do update set
    enabled          = excluded.enabled,
    required_seconds = excluded.required_seconds,
    start_time_local = excluded.start_time_local;

  v_changed := not v_existed
            or v_old.enabled <> p_enabled
            or v_old.required_seconds <> p_required_seconds
            or coalesce(v_old.start_time_local::text, '') <> coalesce(p_start_time_local::text, '');

  if v_changed then
    insert into public.shift_events (session_id, user_id, type, by, meta) values (
      null, p_target_user_id, 'admin_override', v_uid,
      jsonb_build_object(
        'action',         'set_schedule',
        'weekday',        p_weekday,
        'existed_before', v_existed,
        'old', case when v_existed then jsonb_build_object(
          'enabled',          v_old.enabled,
          'required_seconds', v_old.required_seconds,
          'start_time_local', v_old.start_time_local
        ) else null end,
        'new', jsonb_build_object(
          'enabled',          p_enabled,
          'required_seconds', p_required_seconds,
          'start_time_local', p_start_time_local
        )
      )
    );
  end if;

  return jsonb_build_object('user_id', p_target_user_id, 'weekday', p_weekday, 'changed', v_changed);
end;
$$;

grant execute on function public.shift_admin_set_schedule(uuid, smallint, boolean, int, time) to authenticated;

-- ---------- 6. shift_admin_set_config — add tz + threshold ----------
drop function if exists public.shift_admin_set_config(uuid, text, int, int, int, int, int, uuid);

create or replace function public.shift_admin_set_config(
  p_target_user_id                uuid,
  p_mode                          text,
  p_shift_break_seconds           int,
  p_bio_break_max_per_day         int,
  p_bio_break_warn_count          int,
  p_bio_break_warn_total_seconds  int,
  p_bio_break_max_seconds_each    int,
  p_primary_group_id              uuid,
  p_timezone                      text default 'Asia/Manila',
  p_late_start_threshold_seconds  int  default 900
) returns jsonb
  language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.shift_configs;
  v_existed boolean;
  v_tz_ok boolean;
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
  if p_late_start_threshold_seconds <  0 then raise exception 'late_start_threshold_seconds must be >= 0' using errcode='22023'; end if;

  -- Validate timezone name by attempting a conversion.
  begin
    perform now() at time zone p_timezone;
    v_tz_ok := true;
  exception when others then
    raise exception 'invalid timezone: %', p_timezone using errcode='22023';
  end;

  if not exists (select 1 from public.users where id = p_target_user_id and status='active') then
    raise exception 'target user not found or inactive' using errcode='42501';
  end if;

  select * into v_old from public.shift_configs where user_id = p_target_user_id;
  v_existed := found;

  insert into public.shift_configs (
    user_id, mode,
    shift_break_seconds, bio_break_max_per_day, bio_break_warn_count,
    bio_break_warn_total_seconds, bio_break_max_seconds_each,
    primary_group_id, timezone, late_start_threshold_seconds,
    updated_at, updated_by
  ) values (
    p_target_user_id, p_mode,
    p_shift_break_seconds, p_bio_break_max_per_day, p_bio_break_warn_count,
    p_bio_break_warn_total_seconds, p_bio_break_max_seconds_each,
    p_primary_group_id, p_timezone, p_late_start_threshold_seconds,
    now(), v_uid
  )
  on conflict (user_id) do update set
    mode                          = excluded.mode,
    shift_break_seconds           = excluded.shift_break_seconds,
    bio_break_max_per_day         = excluded.bio_break_max_per_day,
    bio_break_warn_count          = excluded.bio_break_warn_count,
    bio_break_warn_total_seconds  = excluded.bio_break_warn_total_seconds,
    bio_break_max_seconds_each    = excluded.bio_break_max_seconds_each,
    primary_group_id              = excluded.primary_group_id,
    timezone                      = excluded.timezone,
    late_start_threshold_seconds  = excluded.late_start_threshold_seconds,
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
        'primary_group_id',              p_primary_group_id,
        'timezone',                      p_timezone,
        'late_start_threshold_seconds',  p_late_start_threshold_seconds
      )
    )
  );

  return jsonb_build_object('user_id', p_target_user_id, 'existed_before', v_existed);
end;
$$;

grant execute on function public.shift_admin_set_config(uuid, text, int, int, int, int, int, uuid, text, int) to authenticated;

-- ---------- 7. shift_start — compute late-start flag + expected_end -
create or replace function public.shift_start()
  returns jsonb
  language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_s public.shift_sessions;
  v_cfg public.shift_configs;
  v_sched public.shift_schedules;
  v_local_today      date;
  v_local_weekday    int;
  v_scheduled_start  timestamptz := null;
  v_expected_end     timestamptz := null;
  v_seconds_late     int := null;
  v_late             boolean := false;
  v_late_mins        int := null;
begin
  if v_uid is null or not is_active_user() then
    raise exception 'not authenticated/active' using errcode='42501';
  end if;
  perform public.shift_get_or_create_today_session();
  select * into v_s from public.shift_sessions
    where user_id = v_uid and work_date = (now() at time zone 'UTC')::date
    for update;
  if v_s.status <> 'not_started' then
    raise exception 'shift already %', v_s.status using errcode='22023';
  end if;

  -- Compute scheduled_start_at in the employee's timezone, then the
  -- late-start flag based on now() vs scheduled + the per-config
  -- threshold.  Skip entirely if there's no schedule row, the day is
  -- disabled, or no start_time_local is set for the day.
  select * into v_cfg from public.shift_configs where user_id = v_uid;
  v_local_today    := (now() at time zone v_cfg.timezone)::date;
  v_local_weekday  := extract(dow from v_local_today)::int;
  select * into v_sched from public.shift_schedules
    where user_id = v_uid and weekday = v_local_weekday;
  if found and v_sched.enabled and v_sched.start_time_local is not null then
    v_scheduled_start := ((v_local_today::text || ' ' || v_sched.start_time_local::text)::timestamp
                          at time zone v_cfg.timezone);
    v_expected_end := v_scheduled_start + (v_s.required_seconds || ' seconds')::interval;
    v_seconds_late := extract(epoch from (now() - v_scheduled_start))::int;
    if v_seconds_late > coalesce(v_cfg.late_start_threshold_seconds, 900) then
      v_late := true;
      v_late_mins := greatest(0, v_seconds_late / 60);
    end if;
  end if;

  update public.shift_sessions
     set status              = 'active',
         started_at          = now(),
         scheduled_start_at  = v_scheduled_start,
         expected_end_at     = v_expected_end,
         late_start_flag     = v_late,
         late_start_minutes  = case when v_late then v_late_mins else null end,
         updated_at          = now()
   where id = v_s.id
   returning * into v_s;

  insert into public.shift_events (session_id, user_id, type, by)
    values (v_s.id, v_uid, 'shift_start', v_uid);
  if v_late then
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (v_s.id, v_uid, 'late_start', v_uid,
              jsonb_build_object('minutes_late', v_late_mins,
                                 'scheduled_start_at', v_scheduled_start));
  end if;

  return jsonb_build_object(
    'session_id',          v_s.id,
    'started_at',          v_s.started_at,
    'scheduled_start_at',  v_scheduled_start,
    'expected_end_at',     v_expected_end,
    'late_start_flag',     v_late,
    'late_start_minutes',  v_late_mins
  );
end;
$$;

-- ---------- 8. shift_admin_force_end — admin marks completed now() ---
-- Admin-only. Bypasses the "elapsed >= required" check. Computes
-- early_end_flag relative to expected_end_at. Emits shift_complete +
-- (optionally) early_end events.
create or replace function public.shift_admin_force_end(p_session_id uuid)
  returns jsonb
  language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_s public.shift_sessions;
  v_elapsed int := 0;
  v_early boolean := false;
  v_early_mins int := null;
  v_from text;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.status = 'completed' then
    return jsonb_build_object('session_id', v_s.id, 'already_completed', true);
  end if;
  if v_s.status not in ('active','on_shift_break','on_bio_break','locked') then
    raise exception 'cannot force-end from status %', v_s.status using errcode='22023';
  end if;

  if v_s.started_at is not null then
    v_elapsed := greatest(0,
      extract(epoch from (clock_timestamp() - v_s.started_at))::int
      - v_s.paused_total_seconds
      - case when v_s.current_pause_started_at is not null
             then extract(epoch from (clock_timestamp() - v_s.current_pause_started_at))::int
             else 0 end
    );
  end if;

  if v_s.expected_end_at is not null and now() < v_s.expected_end_at then
    v_early := true;
    v_early_mins := greatest(0, extract(epoch from (v_s.expected_end_at - now()))::int / 60);
  end if;

  v_from := v_s.status;

  update public.shift_sessions
     set status                    = 'completed',
         completed_at              = now(),
         locked_reason             = 'shift_complete',
         current_break_started_at  = null,
         current_break_kind        = null,
         early_end_flag            = v_early,
         early_end_minutes         = case when v_early then v_early_mins else null end,
         updated_at                = now()
   where id = v_s.id;

  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_s.user_id, 'shift_complete', v_uid,
            jsonb_build_object(
              'worked_seconds', v_elapsed,
              'from_status',    v_from,
              'force_end',      true,
              'auto_swept',     false
            ));
  if v_early then
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (v_s.id, v_s.user_id, 'early_end', v_uid,
              jsonb_build_object('minutes_early', v_early_mins));
  end if;

  return jsonb_build_object(
    'session_id',         v_s.id,
    'completed',          true,
    'worked_seconds',     v_elapsed,
    'from_status',        v_from,
    'early_end_flag',     v_early,
    'early_end_minutes',  v_early_mins
  );
end;
$$;

grant execute on function public.shift_admin_force_end(uuid) to authenticated;

-- ---------- 9. shift_tick — expose the new flag fields --------------
create or replace function public.shift_tick(p_session_id uuid)
  returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_s public.shift_sessions;
  v_cfg public.shift_configs;
  v_admin boolean;
  v_elapsed int;
  v_remain int;
  v_period_start int;
  v_period_end   int;
  v_85_threshold int;
  v_85_due boolean;
  v_lock_due boolean;
  v_break_elapsed int;
  v_eff_max int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_admin := is_admin();
  select * into v_s from public.shift_sessions where id = p_session_id;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.user_id <> v_uid and not v_admin then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_cfg from public.shift_configs where user_id = v_s.user_id;

  if v_s.started_at is null then
    v_elapsed := 0;
  else
    v_elapsed := greatest(0,
      extract(epoch from (clock_timestamp() - v_s.started_at))::int
      - v_s.paused_total_seconds
      - case when v_s.current_pause_started_at is not null
             then extract(epoch from (clock_timestamp() - v_s.current_pause_started_at))::int
             else 0 end
    );
  end if;
  v_remain       := greatest(0, v_s.required_seconds - v_elapsed);
  v_period_start := v_s.current_period_index * v_s.period_seconds;
  v_period_end   := (v_s.current_period_index + 1) * v_s.period_seconds;
  v_85_threshold := v_period_start + (v_s.period_seconds * 0.85)::int;
  v_85_due := v_elapsed >= v_85_threshold
              and v_s.period_85_last_index_alerted < v_s.current_period_index
              and v_s.status in ('active','on_shift_break','on_bio_break');
  v_lock_due := v_elapsed >= v_period_end
              and v_s.status in ('active','on_shift_break','on_bio_break');
  v_break_elapsed := case
    when v_s.current_break_started_at is null then 0
    else greatest(0, extract(epoch from (clock_timestamp() - v_s.current_break_started_at))::int)
  end;
  v_eff_max := coalesce(v_cfg.bio_break_max_per_day, 7) + coalesce(v_s.bio_break_admin_grants_today, 0);

  return jsonb_build_object(
    'session_id',                     v_s.id,
    'user_id',                        v_s.user_id,
    'status',                         v_s.status,
    'started_at',                     v_s.started_at,
    'work_date',                      v_s.work_date,
    'mode',                           v_s.mode,
    'period_seconds',                 v_s.period_seconds,
    'required_seconds',               v_s.required_seconds,
    'elapsed_seconds',                v_elapsed,
    'remaining_seconds',              v_remain,
    'paused_total_seconds',           v_s.paused_total_seconds,
    'current_period_index',           v_s.current_period_index,
    'current_period_start_seconds',   v_period_start,
    'current_period_end_seconds',     v_period_end,
    'period_85_threshold_seconds',    v_85_threshold,
    'period_85_due',                  v_85_due,
    'period_lock_due',                v_lock_due,
    'current_break_kind',             v_s.current_break_kind,
    'current_break_started_at',       v_s.current_break_started_at,
    'current_break_elapsed_seconds',  v_break_elapsed,
    'bio_break_count_today',          v_s.bio_break_count_today,
    'bio_break_total_seconds_today',  v_s.bio_break_total_seconds_today,
    'bio_break_admin_grants_today',   v_s.bio_break_admin_grants_today,
    'bio_break_max_per_day',          v_cfg.bio_break_max_per_day,
    'bio_break_warn_count',           v_cfg.bio_break_warn_count,
    'bio_break_warn_total_seconds',   v_cfg.bio_break_warn_total_seconds,
    'bio_break_max_seconds_each',     v_cfg.bio_break_max_seconds_each,
    'bio_limit_reached',              v_s.bio_break_count_today >= v_eff_max,
    'locked_at',                      v_s.locked_at,
    'locked_reason',                  v_s.locked_reason,
    'completed_at',                   v_s.completed_at,
    -- P4.5 flag surfacing
    'scheduled_start_at',             v_s.scheduled_start_at,
    'expected_end_at',                v_s.expected_end_at,
    'late_start_flag',                v_s.late_start_flag,
    'late_start_minutes',             v_s.late_start_minutes,
    'early_end_flag',                 v_s.early_end_flag,
    'early_end_minutes',              v_s.early_end_minutes,
    'now',                            clock_timestamp()
  );
end;
$$;
