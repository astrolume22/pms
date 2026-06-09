-- =====================================================================
-- 0069 — Step 4b: SHIFT-BREAK OVERSTAY LOCK.
--
-- After 0068's freeze, if a manager's shift break overstays the
-- allowance by another GRACE window (default 15 min), LOCK the screen
-- with a calm no-blame overlay. The 8-hour work timer stays FROZEN
-- continuously across overstay → lock (a freeze pause is open through
-- the entire overstay; the lock RPC closes that and opens a fresh
-- break_overstay pause, so the work timer never resumes during either
-- state).
--
-- Built from LIVE function bodies (pg_get_functiondef) — all
-- 0065/0067/0068 logic preserved verbatim, only NEW behavior added.
--
-- DATA RULES respected:
--   • Additive only — no DROP of tables / FKs / columns.
--   • CREATE OR REPLACE on functions; CHECK constraints widened via
--     drop+recreate with all live values preserved.
--   • ALTER TABLE ... ADD COLUMN IF NOT EXISTS (idempotent).
--   • Single-table writes by exact session id with FOR UPDATE.
--   • Answers / boards untouched.
-- =====================================================================
begin;

-- 1. Per-user grace window (default 15 min = 900s).
alter table public.shift_configs
  add column if not exists shift_break_overstay_grace_seconds int not null default 900;

comment on column public.shift_configs.shift_break_overstay_grace_seconds is
  'Grace seconds after shift_break_seconds expires before the screen is locked. The 0068 freeze applies the instant allowance is exceeded; the lock applies once the OVERSTAY equals this value.';

-- 2. Widen locked_reason CHECK to allow 'break_overstay'.
-- Live values (quoted from pg_get_constraintdef): 'period_lock',
-- 'shift_complete', 'admin', 'bio_request'. We add 'break_overstay'.
alter table public.shift_sessions
  drop constraint if exists shift_sessions_locked_reason_check;
alter table public.shift_sessions
  add constraint shift_sessions_locked_reason_check
  check (locked_reason = any (array[
    'period_lock','shift_complete','admin','bio_request','break_overstay'
  ]));

-- 3. shift_events.type already allows 'shift_break_overstay_freeze' (0068).
-- Add 'shift_break_overstay_lock' alongside it (drop+recreate the CHECK
-- preserving all existing live values).
alter table public.shift_events
  drop constraint if exists shift_events_type_check;
alter table public.shift_events
  add constraint shift_events_type_check
  check (type = any (array[
    'shift_start','period_85_alert','period_lock','period_unlock',
    'shift_break_start','shift_break_end','bio_break_start','bio_break_end',
    'bio_break_auto_end','bio_break_request','bio_break_request_decided',
    'shift_complete','admin_override','late_start','early_end',
    'shift_break_overstay_freeze','shift_break_overstay_lock'
  ]));

-- 4. shift_tick — preserve LIVE 0068 body verbatim; ADD grace seconds
-- field. (locked_reason is already returned by live shift_tick — no
-- change needed there.)
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
  v_overstay_grace int;
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
  v_overstay_grace := coalesce(v_cfg.shift_break_overstay_grace_seconds, 900);

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
    -- 0068
    'shift_break_seconds',            v_shift_break_allowance,
    'shift_break_overstay',           (v_s.status = 'on_shift_break'
                                        and v_s.current_break_kind = 'shift'
                                        and v_break_elapsed >= v_shift_break_allowance),
    'shift_break_overstay_seconds',   greatest(0, v_break_elapsed - v_shift_break_allowance),
    -- COALESCE so NULL doesn't propagate to JSON null.
    'shift_break_frozen',             coalesce(v_s.current_pause_reason = 'break_overstay', false),
    -- 0069 — NEW grace window.
    'shift_break_overstay_grace_seconds', v_overstay_grace,
    'now',                            clock_timestamp()
  );
end;
$function$;

-- 5. NEW RPC shift_break_overstay_lock(p_session_id uuid).
-- Eligible: status='on_shift_break' AND current_break_kind='shift' AND
-- break_elapsed >= allowance + grace. Idempotent: any other state →
-- {applied:false} without raising. When eligible, one UPDATE finalizes
-- the open freeze pause (credit to paused_total), clears break fields,
-- OPENS a fresh break_overstay pause, and sets status='locked' /
-- locked_reason='break_overstay'. The work timer is FROZEN continuously
-- across overstay → lock: a freeze pause is open the entire overstay,
-- credited into paused_total at the lock instant; the new lock pause
-- opens at the SAME instant, so shift_tick subtracts an open pause for
-- every poll. No paid time leaks.
create or replace function public.shift_break_overstay_lock(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_s   public.shift_sessions;
  v_cfg public.shift_configs;
  v_now timestamptz := clock_timestamp();
  v_break_elapsed int;
  v_allowance int;
  v_grace int;
  v_freeze_dur int := 0;
  v_recorded int;
  v_applied boolean := false;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.user_id <> v_uid and not is_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- Eligibility gate. Idempotent on any non-eligible state.
  if v_s.status = 'on_shift_break'
     and v_s.current_break_kind = 'shift'
     and v_s.current_break_started_at is not null then
    select * into v_cfg from public.shift_configs where user_id = v_s.user_id;
    v_allowance := coalesce(v_cfg.shift_break_seconds, 1800);
    v_grace     := coalesce(v_cfg.shift_break_overstay_grace_seconds, 900);
    v_break_elapsed := greatest(0,
      extract(epoch from (v_now - v_s.current_break_started_at))::int);
    if v_break_elapsed >= v_allowance + v_grace then
      -- 1) Finalize the open freeze pause (the 0068 break_overstay
      --    pause that's been frozen since the allowance ran out).
      if v_s.current_pause_reason = 'break_overstay'
         and v_s.current_pause_started_at is not null then
        v_freeze_dur := greatest(0,
          extract(epoch from (v_now - v_s.current_pause_started_at))::int);
      end if;
      -- 2) Cap recorded shift-break duration at the allowance.
      v_recorded := least(v_break_elapsed, v_allowance);
      -- 3+4) One UPDATE: end break, credit freeze, open lock pause,
      --      flip to locked. Continuous freeze: pause closes and a
      --      new pause opens AT THE SAME INSTANT (v_now), so no paid
      --      time leaks.
      update public.shift_sessions
         set status                   = 'locked',
             current_break_started_at = null,
             current_break_kind       = null,
             paused_total_seconds     = paused_total_seconds + v_freeze_dur,
             current_pause_started_at = v_now,
             current_pause_reason     = 'break_overstay',
             locked_at                = v_now,
             locked_reason            = 'break_overstay',
             locked_by                = null,
             updated_at               = v_now
       where id = v_s.id;
      -- Two events for the audit trail: the shift_break_end (capped
      -- recorded), then the overstay_lock with metadata.
      insert into public.shift_events (session_id, user_id, type, by, meta)
        values (v_s.id, v_s.user_id, 'shift_break_end', v_uid,
                jsonb_build_object(
                  'duration_seconds_actual',   v_break_elapsed,
                  'duration_seconds_recorded', v_recorded,
                  'overstay_seconds',          greatest(0, v_break_elapsed - v_allowance),
                  'frozen_seconds_credited',   v_freeze_dur,
                  'allowance_seconds',         v_allowance,
                  'ended_by',                  'overstay_lock'));
      insert into public.shift_events (session_id, user_id, type, by, meta)
        values (v_s.id, v_s.user_id, 'shift_break_overstay_lock', v_uid,
                jsonb_build_object(
                  'break_elapsed_seconds', v_break_elapsed,
                  'allowance_seconds',     v_allowance,
                  'grace_seconds',         v_grace,
                  'frozen_seconds_credited', v_freeze_dur));
      v_applied := true;
    end if;
  end if;

  return jsonb_build_object(
    'session_id', v_s.id,
    'status',     case when v_applied then 'locked' else v_s.status end,
    'locked',     v_applied or v_s.status = 'locked',
    'applied',    v_applied
  );
end;
$function$;

-- 6. shift_admin_unlock — preserve LIVE 0068 body byte-for-byte. It
-- already handles status='locked' generically:
--   • v_was_period := (v_s.locked_reason = 'period_lock')  → false for
--     'break_overstay', so current_period_index is NOT advanced.
--   • paused_total_seconds += pause window  → credits the open lock pause.
--   • Clears locked_at/locked_reason/locked_by + current_pause_*.
--   • Does NOT touch bio/shift counts or started_at.
-- The 0068 defensive on_shift_break + break_overstay branch is preserved
-- ABOVE the main lock branch (covers the rare case admin hits unlock on
-- a still-on-break session). Net: NO migration change to this function
-- is required for break_overstay unlock to work correctly. We re-emit
-- the function here with the SAME body so the migration is the single
-- source of truth for the 4b feature; behavior is byte-for-byte
-- identical to live.
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

  -- 0068 defensive: handle break_overstay freeze on on_shift_break.
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

  -- Idempotent early return on already-unlocked sessions.
  if v_s.status <> 'locked' then
    return jsonb_build_object('session_id', v_s.id, 'status', v_s.status,
                              'lock_wait_seconds', 0, 'already_unlocked', true);
  end if;
  -- Main lock branch: credit pause, clear locked_*, advance period
  -- index ONLY for period_lock (so break_overstay unlock leaves
  -- current_period_index untouched). Bio/shift counts + started_at
  -- are intentionally NOT touched.
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

-- 7. Grants — mirror existing.
revoke all on function public.shift_tick(uuid)                    from public, anon;
grant execute on function public.shift_tick(uuid)                 to authenticated;
revoke all on function public.shift_break_overstay_lock(uuid)     from public, anon;
grant execute on function public.shift_break_overstay_lock(uuid)  to authenticated;
revoke all on function public.shift_admin_unlock(uuid)            from public, anon;
grant execute on function public.shift_admin_unlock(uuid)         to authenticated;

commit;
