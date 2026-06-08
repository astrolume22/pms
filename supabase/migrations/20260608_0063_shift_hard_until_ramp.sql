-- =====================================================================
-- 0063 — new-hire HARD-mode ramp for the first 14 days, then auto MEDIUM.
--
-- Design:
--   • shift_configs gains a nullable `hard_until timestamptz`. When set
--     and in the future, the user is forced to HARD regardless of the
--     persisted shift_configs.mode. When the deadline passes (or when
--     the column is null), the user reverts to shift_configs.mode.
--   • Mode resolution is LAZY — every time
--     shift_get_or_create_today_session() seeds a new day's session, it
--     evaluates `hard_until > now()` and picks between 'hard' and
--     shift_configs.mode. The resolved value is snapshotted into the
--     shift_sessions row so a running day's mode never retro-changes
--     mid-shift; the auto-switch only takes effect on the NEXT day's
--     seed.
--   • The single mode-resolution point is the v_effective_mode CASE
--     inside shift_get_or_create_today_session(). _shift_period_seconds,
--     shift_tick, shift_start, and shift_self_period_lock are all
--     UNCHANGED — they continue to read mode from the session snapshot,
--     not from shift_configs.
--
-- New-hire defaults:
--   • Auto-seed branch (user lands without a shift_configs row): the
--     new row is stamped with hard_until = now() + interval '14 days'.
--   • shift_admin_set_config:
--       - on INSERT (first time for this user) and p_hard_until is null
--         → stamp hard_until = now() + interval '14 days' automatically
--       - on INSERT and p_hard_until is provided → use that value
--       - on UPDATE (existing row) and p_hard_until is null → leave the
--         column untouched (admin edits MUST NOT reset an in-flight ramp)
--       - on UPDATE and p_hard_until is provided → set the column
--
-- The 16 existing shift_configs rows seeded before this migration keep
-- hard_until = NULL — the ramp only applies to NEW managers added
-- after this lands.
--
-- Additive only: no destructive change. Existing 10-arg
-- shift_admin_set_config signature is dropped (per 0062's pattern) and
-- replaced with the new 11-arg signature so PostgreSQL doesn't end up
-- with two overloaded versions.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. ADD COLUMN — hard_until on shift_configs (nullable, no backfill).
-- ---------------------------------------------------------------------
alter table public.shift_configs
  add column if not exists hard_until timestamptz null;

comment on column public.shift_configs.hard_until is
  'If set and in the future, the user is forced to HARD mode until this time (new-hire ramp). After it passes, the user reverts to shift_configs.mode.';

-- ---------------------------------------------------------------------
-- 2. REPLACE shift_get_or_create_today_session() — lazy mode resolution.
--    Only the mode-resolution branch changes; auto-seed config,
--    required_seconds, work_date, status, conflict handling all stay
--    byte-for-byte the same as in migration 0057.
-- ---------------------------------------------------------------------
create or replace function public.shift_get_or_create_today_session()
returns shift_sessions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid             uuid := auth.uid();
  v_today           date;
  v_session         public.shift_sessions;
  v_config          public.shift_configs;
  v_sched           public.shift_schedules;
  v_weekday         int;
  v_period          int;
  v_required        int;
  v_effective_mode  text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not is_active_user() then
    raise exception 'User is not active' using errcode = '42501';
  end if;

  v_today := (now() at time zone 'UTC')::date;

  -- Existing session for today?
  select * into v_session
    from public.shift_sessions
   where user_id = v_uid and work_date = v_today;
  if found then return v_session; end if;

  -- Need to seed. Snapshot from config + schedule.
  select * into v_config from public.shift_configs where user_id = v_uid;
  if not found then
    -- NEW (0063): auto-seeded config rows for first-time users also get
    -- the 14-day HARD ramp so the steep period kicks in automatically
    -- without admin intervention.
    insert into public.shift_configs (user_id, hard_until) values
      (v_uid, now() + interval '14 days')
    on conflict (user_id) do nothing
    returning * into v_config;
    if v_config is null then
      select * into v_config from public.shift_configs where user_id = v_uid;
    end if;
  end if;

  v_weekday := extract(dow from v_today)::int;
  select * into v_sched from public.shift_schedules
   where user_id = v_uid and weekday = v_weekday;
  v_required := coalesce(v_sched.required_seconds, v_config.required_seconds_default);
  if found and not v_sched.enabled then
    v_required := 0;
  end if;

  -- NEW (0063): effective mode resolution. While hard_until is in the
  -- future, the user is on HARD regardless of shift_configs.mode. After
  -- it passes (or if it's null), use the persisted mode. This is the
  -- SINGLE mode-resolution point — _shift_period_seconds, shift_tick,
  -- shift_start, shift_self_period_lock all still read from the session
  -- snapshot below, which means the resolution is locked in for the
  -- whole day at seed time.
  v_effective_mode := case
    when v_config.hard_until is not null and v_config.hard_until > now() then 'hard'
    else v_config.mode
  end;

  v_period := public._shift_period_seconds(v_effective_mode);

  insert into public.shift_sessions (
    user_id, work_date, status, mode, period_seconds, required_seconds
  ) values (
    v_uid, v_today, 'not_started', v_effective_mode, v_period, v_required
  )
  on conflict (user_id, work_date) do nothing
  returning * into v_session;

  if v_session.id is null then
    -- Someone else got there first (race) — read it back.
    select * into v_session from public.shift_sessions
     where user_id = v_uid and work_date = v_today;
  end if;

  return v_session;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. REPLACE shift_admin_set_config() — adds optional p_hard_until.
--
-- Drop the existing 10-arg signature first (matches the 0059 → 0062
-- replacement pattern) so PostgreSQL doesn't end up with two
-- overloaded versions.
-- ---------------------------------------------------------------------
drop function if exists public.shift_admin_set_config(uuid, text, int, int, int, int, int, uuid, text, int);

create or replace function public.shift_admin_set_config(
  p_target_user_id uuid,
  p_mode text,
  p_shift_break_seconds integer,
  p_bio_break_max_per_day integer,
  p_bio_break_warn_count integer,
  p_bio_break_warn_total_seconds integer,
  p_bio_break_max_seconds_each integer,
  p_primary_group_id uuid,
  p_timezone text default 'Asia/Manila',
  p_late_start_threshold_seconds integer default 900,
  -- NEW (0063): optional hard-mode ramp deadline.
  --   • On INSERT with NULL → defaults to now() + interval '14 days'
  --     so brand-new managers get the ramp automatically.
  --   • On INSERT with a value → admin sets a custom ramp.
  --   • On UPDATE with NULL → existing hard_until is left untouched
  --     (admin edits MUST NOT reset an in-flight ramp).
  --   • On UPDATE with a value → admin extends/shortens the ramp.
  -- Caveat: a passed NULL is indistinguishable from "not passed" so
  -- there's no path here to CLEAR an existing hard_until early. A
  -- separate clear-ramp RPC can be added later when the admin UI
  -- needs it.
  p_hard_until timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid              uuid := auth.uid();
  v_old              public.shift_configs;
  v_existed          boolean;
  v_new_hard_until   timestamptz;
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
  exception when others then
    raise exception 'invalid timezone: %', p_timezone using errcode='22023';
  end;

  if not exists (select 1 from public.users where id = p_target_user_id and status='active') then
    raise exception 'target user not found or inactive' using errcode='42501';
  end if;

  select * into v_old from public.shift_configs where user_id = p_target_user_id;
  v_existed := found;

  -- Resolve the hard_until value to persist based on insert vs update.
  if v_existed then
    -- UPDATE: keep existing hard_until unless explicitly overridden.
    -- A NULL p_hard_until is treated as "no change" — preserves the
    -- in-flight ramp on routine admin edits.
    v_new_hard_until := coalesce(p_hard_until, v_old.hard_until);
  else
    -- INSERT: brand-new manager. If admin didn't pass one, default to
    -- the 14-day ramp. If they did, honour their value (could be a
    -- future timestamp, or even something already-elapsed if the admin
    -- wants no ramp for this hire).
    v_new_hard_until := coalesce(p_hard_until, now() + interval '14 days');
  end if;

  insert into public.shift_configs (
    user_id, mode,
    shift_break_seconds, bio_break_max_per_day, bio_break_warn_count,
    bio_break_warn_total_seconds, bio_break_max_seconds_each,
    primary_group_id, timezone, late_start_threshold_seconds,
    hard_until, updated_at, updated_by
  ) values (
    p_target_user_id, p_mode,
    p_shift_break_seconds, p_bio_break_max_per_day, p_bio_break_warn_count,
    p_bio_break_warn_total_seconds, p_bio_break_max_seconds_each,
    p_primary_group_id, p_timezone, p_late_start_threshold_seconds,
    v_new_hard_until, now(), v_uid
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
    -- excluded.hard_until is the COALESCE'd value computed above, so
    -- on UPDATE-with-NULL it equals v_old.hard_until — no change.
    hard_until                    = excluded.hard_until,
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
        'late_start_threshold_seconds',  p_late_start_threshold_seconds,
        'hard_until',                    v_new_hard_until
      )
    )
  );

  return jsonb_build_object(
    'user_id',        p_target_user_id,
    'existed_before', v_existed,
    'hard_until',     v_new_hard_until
  );
end;
$function$;

-- Grant matches 0062's pattern. New 11-arg signature.
grant execute on function public.shift_admin_set_config(
  uuid, text, int, int, int, int, int, uuid, text, int, timestamptz
) to authenticated;

commit;
