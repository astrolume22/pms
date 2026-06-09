-- =====================================================================
-- 0067 — break limits redesign:
--   (1) Shift break is now ONCE PER DAY (hard counter on the session).
--   (2) Bio break is a HARD LIMIT — no admin-request escape hatch.
--   (3) Bio request→admin flow is retired (no new bio_break_requests
--       rows will be created from the manager UI; the table + RPCs
--       stay in the DB as inert; THIS MIGRATION DOES NOT DROP THEM).
--
-- Built from the LIVE function bodies (pg_get_functiondef) so 0065's
-- account-lock pause logic (which lives in shift_admin_set_account_lock,
-- not shift_tick — shift_tick already correctly subtracts the open
-- pause via current_pause_started_at) is preserved verbatim. The only
-- changes to shift_tick are:
--   • v_eff_max no longer adds bio_break_admin_grants_today
--     (hard cap = config.bio_break_max_per_day only).
--   • bio_limit_reached uses the hard v_eff_max (same as above).
--   • Two new returned fields: shift_break_count_today,
--     shift_break_used_today.
-- Every other field, label, and ordering is byte-for-byte identical
-- to the live shift_tick body.
--
-- DATA RULES respected:
--   • Additive only — no DROP of tables / FKs / policies.
--   • CREATE OR REPLACE on the three functions (idempotent).
--   • ADD COLUMN IF NOT EXISTS for shift_break_count_today
--     (NOT NULL DEFAULT 0 — every existing row backfills to 0).
--   • No CASCADE. No FK changes. answers/board tables untouched.
--   • Single-table writes by exact session id with FOR UPDATE.
-- =====================================================================
begin;

-- 1. ADD COLUMN — daily counter for shift breaks.
alter table public.shift_sessions
  add column if not exists shift_break_count_today int not null default 0;

comment on column public.shift_sessions.shift_break_count_today is
  'Number of shift breaks the user has STARTED today. Increments on shift_take_shift_break and resets via the existing daily-reset path (shift_get_or_create_today_session creates a fresh row at the start of each work_date).';

-- 2. shift_take_shift_break — once per day.
create or replace function public.shift_take_shift_break(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.user_id <> v_uid and not is_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if v_s.status <> 'active' then
    raise exception 'cannot break from %', v_s.status using errcode='22023';
  end if;

  -- NEW (0067): hard once-per-day. Increment on START so a 5-minute
  -- break still uses the day's allowance. Return a 'blocked' flag
  -- (NOT an exception) so the UI can toast a friendly message.
  if v_s.shift_break_count_today >= 1 then
    return jsonb_build_object(
      'session_id', v_s.id,
      'status',     v_s.status,
      'blocked',    true,
      'reason',     'shift_break_used_today'
    );
  end if;

  -- DECISION 1: no pause math. Flip status, stamp the break,
  -- bump the once-per-day counter.
  update public.shift_sessions
     set status                   = 'on_shift_break',
         current_break_started_at = now(),
         current_break_kind       = 'shift',
         shift_break_count_today  = shift_break_count_today + 1,
         updated_at               = now()
   where id = v_s.id;
  insert into public.shift_events (session_id, user_id, type, by)
    values (v_s.id, v_s.user_id, 'shift_break_start', v_uid);
  return jsonb_build_object(
    'session_id', v_s.id,
    'status',     'on_shift_break',
    'blocked',    false
  );
end;
$function$;

-- 3. shift_take_bio_break — HARD limit. No admin-request escape hatch.
create or replace function public.shift_take_bio_break(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_s   public.shift_sessions;
  v_cfg public.shift_configs;
  v_effective_max int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.user_id <> v_uid and not is_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if v_s.status <> 'active' then
    raise exception 'cannot bio-break from %', v_s.status using errcode='22023';
  end if;
  select * into v_cfg from public.shift_configs where user_id = v_s.user_id;

  -- NEW (0067): hard cap = config.bio_break_max_per_day only.
  -- admin grants are no longer added — bio is a HARD STOP.
  v_effective_max := coalesce(v_cfg.bio_break_max_per_day, 7);

  if v_s.bio_break_count_today >= v_effective_max then
    -- No bio_break_requests row is created. The UI surfaces a hard
    -- "limit reached" pill.
    return jsonb_build_object(
      'session_id',   v_s.id,
      'status',       v_s.status,
      'limit_reached', true,
      'count_today',  v_s.bio_break_count_today,
      'max_per_day',  v_cfg.bio_break_max_per_day
    );
  end if;

  -- DECISION 1: no pause math.
  update public.shift_sessions
     set status                   = 'on_bio_break',
         current_break_started_at = now(),
         current_break_kind       = 'bio',
         updated_at               = now()
   where id = v_s.id;
  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_s.user_id, 'bio_break_start', v_uid,
            jsonb_build_object('count_so_far', v_s.bio_break_count_today));
  return jsonb_build_object(
    'session_id',    v_s.id,
    'status',        'on_bio_break',
    'limit_reached', false
  );
end;
$function$;

-- 4. shift_tick — preserves live body + adds the two new fields
-- (shift_break_count_today, shift_break_used_today) and switches
-- v_eff_max + bio_limit_reached to the HARD cap. Pause math (the
-- subtraction of clock_timestamp() - current_pause_started_at)
-- is preserved verbatim so 0065's account-lock pause keeps working.
create or replace function public.shift_tick(p_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
  -- NEW (0067): hard cap (no admin grants).
  v_eff_max := coalesce(v_cfg.bio_break_max_per_day, 7);

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
    -- NEW (0067)
    'shift_break_count_today',        v_s.shift_break_count_today,
    'shift_break_used_today',         v_s.shift_break_count_today >= 1,
    'now',                            clock_timestamp()
  );
end;
$function$;

-- 5. Grants — mirror the existing ones (authenticated only; revoke from public/anon).
revoke all on function public.shift_take_shift_break(uuid) from public, anon;
grant execute on function public.shift_take_shift_break(uuid) to authenticated;
revoke all on function public.shift_take_bio_break(uuid)   from public, anon;
grant execute on function public.shift_take_bio_break(uuid)   to authenticated;
revoke all on function public.shift_tick(uuid)             from public, anon;
grant execute on function public.shift_tick(uuid)             to authenticated;

commit;
