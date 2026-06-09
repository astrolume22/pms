-- =====================================================================
-- 0068 — SHIFT-BREAK OVERSTAY FREEZE.
--
-- Goal: when a manager's SHIFT break runs past the per-user allowance
--   (shift_configs.shift_break_seconds, default 3600), FREEZE their
--   8-hour work timer so the overstay isn't paid. No lock yet (that's
--   a later step) — the manager stays on_shift_break but their
--   8h-remaining stops decrementing. Ending the break finalizes the
--   freeze (credits the frozen time to paused_total_seconds so it
--   stays unpaid) and resumes the work timer cleanly.
--
-- How (mechanism is borrowed from 0065's lock pause):
--   shift_tick's elapsed math subtracts both `paused_total_seconds`
--   AND any open `clock_timestamp() - current_pause_started_at`. So
--   setting current_pause_started_at + current_pause_reason on an
--   on_shift_break session FREEZES the work timer. The break elapsed
--   is computed independently from `current_break_started_at` so the
--   break can keep ticking past the allowance while frozen — exactly
--   what we need for the "Break over — time frozen" pill.
--
-- All function bodies are CREATE OR REPLACE based on the LIVE
-- definitions (pulled via pg_get_functiondef), preserving every
-- existing field and branch. Only the new behavior is added.
--
-- DATA RULES respected:
--   • Additive only — CREATE OR REPLACE on functions; CHECK constraints
--     are dropped IF EXISTS + re-added with the new vocabulary
--     (existing rows comply).
--   • No FK changes, no DROP of tables / data.
--   • Single-table writes by exact session id with FOR UPDATE.
--   • Answers / boards untouched.
-- =====================================================================
begin;

-- 1. Widen CHECK constraints to allow the new vocabulary.
alter table public.shift_sessions
  drop constraint if exists shift_sessions_current_pause_reason_check;
alter table public.shift_sessions
  add constraint shift_sessions_current_pause_reason_check
  check (current_pause_reason = any (array['period_lock','admin','break_overstay']));

alter table public.shift_events
  drop constraint if exists shift_events_type_check;
alter table public.shift_events
  add constraint shift_events_type_check
  check (type = any (array[
    'shift_start','period_85_alert','period_lock','period_unlock',
    'shift_break_start','shift_break_end','bio_break_start','bio_break_end',
    'bio_break_auto_end','bio_break_request','bio_break_request_decided',
    'shift_complete','admin_override','late_start','early_end',
    'shift_break_overstay_freeze'
  ]));

-- 2. shift_tick — preserve LIVE body verbatim; only ADD the new
-- returned fields (shift_break_seconds / overstay / frozen / overstay_seconds).
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
  v_shift_break_allowance int;
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
  v_eff_max := coalesce(v_cfg.bio_break_max_per_day, 7);
  v_shift_break_allowance := coalesce(v_cfg.shift_break_seconds, 1800);

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
    -- 0067
    'shift_break_count_today',        v_s.shift_break_count_today,
    'shift_break_used_today',         v_s.shift_break_count_today >= 1,
    -- NEW (0068) — shift-break overstay freeze surface.
    'shift_break_seconds',            v_shift_break_allowance,
    'shift_break_overstay',           (v_s.status = 'on_shift_break'
                                        and v_s.current_break_kind = 'shift'
                                        and v_break_elapsed >= v_shift_break_allowance),
    'shift_break_overstay_seconds',   greatest(0, v_break_elapsed - v_shift_break_allowance),
    -- COALESCE the comparison so a NULL current_pause_reason returns
    -- false (PG 3-valued logic would otherwise yield NULL).
    'shift_break_frozen',             coalesce(v_s.current_pause_reason = 'break_overstay', false),
    'now',                            clock_timestamp()
  );
end;
$function$;

-- 3. NEW RPC shift_break_freeze(p_session_id uuid).
-- Idempotent: if not eligible (not on shift break, wrong kind, pause
-- already open, or break still inside the allowance), returns
-- {applied:false} without raising.
create or replace function public.shift_break_freeze(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_s   public.shift_sessions;
  v_cfg public.shift_configs;
  v_break_elapsed int;
  v_allowance int;
  v_applied boolean := false;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.user_id <> v_uid and not is_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- Eligibility gate. Idempotent: any of these false → applied=false.
  if v_s.status = 'on_shift_break'
     and v_s.current_break_kind = 'shift'
     and v_s.current_pause_started_at is null
     and v_s.current_break_started_at is not null then
    select * into v_cfg from public.shift_configs where user_id = v_s.user_id;
    v_allowance := coalesce(v_cfg.shift_break_seconds, 1800);
    v_break_elapsed := greatest(0,
      extract(epoch from (clock_timestamp() - v_s.current_break_started_at))::int);
    if v_break_elapsed >= v_allowance then
      update public.shift_sessions
         set current_pause_started_at = clock_timestamp(),
             current_pause_reason     = 'break_overstay',
             updated_at               = now()
       where id = v_s.id;
      insert into public.shift_events (session_id, user_id, type, by, meta)
        values (v_s.id, v_s.user_id, 'shift_break_overstay_freeze', v_uid,
                jsonb_build_object('break_elapsed_seconds', v_break_elapsed,
                                   'allowance_seconds',     v_allowance));
      v_applied := true;
    end if;
  end if;

  return jsonb_build_object(
    'session_id', v_s.id,
    'status',     v_s.status,
    -- Same COALESCE pattern as shift_tick — guard against NULL.
    'frozen',     (v_applied or coalesce(v_s.current_pause_reason = 'break_overstay', false)),
    'applied',    v_applied
  );
end;
$function$;

-- 4. shift_end_break — preserve LIVE body verbatim, but for the SHIFT
-- branch: if an open break-overstay freeze pause exists, FINALIZE it
-- in the same UPDATE (credit to paused_total_seconds, clear
-- current_pause_*). The bio branch is byte-for-byte unchanged.
-- Recorded shift-break duration in the event meta is capped at the
-- allowance so the overstay is NOT counted as paid break.
create or replace function public.shift_end_break(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_s   public.shift_sessions;
  v_cfg public.shift_configs;
  v_kind text;
  v_actual int;
  v_recorded int;
  v_exceeded boolean := false;
  -- NEW (0068)
  v_freeze_dur int := 0;
  v_shift_allowance int := 1800;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.user_id <> v_uid and not is_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if v_s.status not in ('on_shift_break','on_bio_break') then
    raise exception 'not on break (status=%)', v_s.status using errcode='22023';
  end if;

  v_kind   := v_s.current_break_kind;
  v_actual := greatest(0, extract(epoch from (clock_timestamp() - coalesce(v_s.current_break_started_at, clock_timestamp())))::int);
  v_recorded := v_actual;

  if v_kind = 'bio' then
    select * into v_cfg from public.shift_configs where user_id = v_s.user_id;
    if v_actual > coalesce(v_cfg.bio_break_max_seconds_each, 900) then
      v_recorded := coalesce(v_cfg.bio_break_max_seconds_each, 900);
      v_exceeded := true;
    end if;
    update public.shift_sessions
       set status                        = 'active',
           current_break_started_at      = null,
           current_break_kind            = null,
           bio_break_count_today         = bio_break_count_today + 1,
           bio_break_total_seconds_today = bio_break_total_seconds_today + v_recorded,
           updated_at                    = now()
     where id = v_s.id;
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (v_s.id, v_s.user_id,
              case when v_exceeded then 'bio_break_auto_end' else 'bio_break_end' end,
              v_uid, jsonb_build_object(
                'duration_seconds_actual',   v_actual,
                'duration_seconds_recorded', v_recorded,
                'exceeded_cap',              v_exceeded));
  else
    -- SHIFT branch.
    select * into v_cfg from public.shift_configs where user_id = v_s.user_id;
    v_shift_allowance := coalesce(v_cfg.shift_break_seconds, 1800);
    -- Cap the recorded duration at the allowance — the overstay must
    -- NOT count as paid break either.
    v_recorded := least(v_actual, v_shift_allowance);
    -- Finalize the break-overstay freeze pause if one is open. The
    -- credited time stays UNPAID against the 8h timer (paused_total).
    if v_s.current_pause_reason = 'break_overstay'
       and v_s.current_pause_started_at is not null then
      v_freeze_dur := greatest(0,
        extract(epoch from (clock_timestamp() - v_s.current_pause_started_at))::int);
    end if;
    update public.shift_sessions
       set status                   = 'active',
           current_break_started_at = null,
           current_break_kind       = null,
           paused_total_seconds     = paused_total_seconds + v_freeze_dur,
           current_pause_started_at = null,
           current_pause_reason     = null,
           updated_at               = now()
     where id = v_s.id;
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (v_s.id, v_s.user_id, 'shift_break_end', v_uid,
              jsonb_build_object(
                'duration_seconds_actual',     v_actual,
                'duration_seconds_recorded',   v_recorded,
                'overstay_seconds',            greatest(0, v_actual - v_shift_allowance),
                'frozen_seconds_credited',     v_freeze_dur,
                'allowance_seconds',           v_shift_allowance));
  end if;

  return jsonb_build_object(
    'session_id',                v_s.id,
    'status',                    'active',
    'kind',                      v_kind,
    'duration_seconds_actual',   v_actual,
    'duration_seconds_recorded', v_recorded,
    'exceeded_cap',              v_exceeded
  );
end;
$function$;

-- 5. shift_admin_unlock — preserve LIVE body verbatim, but ADD a
-- defensive branch BEFORE the existing early-return so that if an
-- admin happens to call unlock on a session in the break-overstay
-- frozen state (status='on_shift_break', current_pause_reason='break_overstay'),
-- the freeze pause is finalized cleanly. Status is NOT changed —
-- the manager stays on break. Period-lock behavior is byte-for-byte
-- unchanged.
create or replace function public.shift_admin_unlock(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions; v_dur int; v_was_period boolean;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;

  -- NEW (0068): handle the break-overstay freeze case.
  if v_s.status = 'on_shift_break'
     and v_s.current_pause_reason = 'break_overstay'
     and v_s.current_pause_started_at is not null then
    v_dur := greatest(0,
      extract(epoch from (clock_timestamp() - v_s.current_pause_started_at))::int);
    update public.shift_sessions
       set paused_total_seconds     = paused_total_seconds + v_dur,
           current_pause_started_at = null,
           current_pause_reason     = null,
           updated_at               = now()
     where id = p_session_id;
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (v_s.id, v_s.user_id, 'admin_override', v_uid,
              jsonb_build_object('action', 'break_overstay_unfreeze',
                                 'pause_seconds', v_dur));
    return jsonb_build_object('session_id', v_s.id, 'status', v_s.status,
                              'lock_wait_seconds', v_dur,
                              'already_unlocked', false,
                              'break_overstay_finalized', true);
  end if;

  -- Existing idempotent early-return on already-unlocked sessions.
  if v_s.status <> 'locked' then
    return jsonb_build_object('session_id', v_s.id, 'status', v_s.status,
                              'lock_wait_seconds', 0, 'already_unlocked', true);
  end if;
  v_dur := greatest(0, extract(epoch from (clock_timestamp() - v_s.current_pause_started_at))::int);
  v_was_period := (v_s.locked_reason = 'period_lock');
  update public.shift_sessions
     set status='active',
         paused_total_seconds = paused_total_seconds + v_dur,
         current_pause_started_at = null,
         current_pause_reason = null,
         locked_at = null,
         locked_reason = null,
         locked_by = null,
         current_period_index = current_period_index + case when v_was_period then 1 else 0 end,
         updated_at = now()
   where id = p_session_id;
  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_s.user_id, 'period_unlock', v_uid,
            jsonb_build_object('pause_seconds',   v_dur,
                               'was_period_lock', v_was_period,
                               'locked_by',       v_s.locked_by));
  return jsonb_build_object('session_id', v_s.id, 'status', 'active',
                            'lock_wait_seconds', v_dur, 'already_unlocked', false);
end;
$function$;

-- 6. Grants — mirror existing.
revoke all on function public.shift_tick(uuid)                from public, anon;
grant execute on function public.shift_tick(uuid)             to authenticated;
revoke all on function public.shift_break_freeze(uuid)        from public, anon;
grant execute on function public.shift_break_freeze(uuid)     to authenticated;
revoke all on function public.shift_end_break(uuid)           from public, anon;
grant execute on function public.shift_end_break(uuid)        to authenticated;
revoke all on function public.shift_admin_unlock(uuid)        from public, anon;
grant execute on function public.shift_admin_unlock(uuid)     to authenticated;

commit;
