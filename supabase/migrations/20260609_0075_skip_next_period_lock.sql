-- =====================================================================
-- 0075 — Admin "skip next period lock" for a specific manager.
--
-- Today the hourly period-lock is fired CLIENT-side: ShiftDriver calls
-- shift_self_period_lock when shift_tick.period_lock_due flips true.
-- The cron sweep (shift_break_sweep) handles ONLY break-overstay; it
-- does NOT fire period locks. So per PHASE 0, the only place where
-- status flips to 'locked' with locked_reason='period_lock' (as an
-- automatic system-initiated transition) is shift_self_period_lock.
--
-- This migration:
--   • Adds a one-shot per-session flag shift_sessions.skip_next_period_lock
--     (+ audit columns) that an admin can arm.
--   • Adds shift_admin_skip_next_lock(p_session_id) — SECURITY DEFINER,
--     admin-only — to arm the flag.
--   • Extends shift_self_period_lock to CONSUME the flag at the moment
--     a period lock would otherwise fire: skip the UPDATE→locked, set
--     skip_next_period_lock=false, advance current_period_index by 1
--     (so the NEXT tick's period_end moves forward by exactly one
--     period and the same boundary cannot immediately re-trigger), log
--     an admin_override event, return {skipped:true} without locking.
--   • Surfaces skip_next_period_lock in shift_tick so the admin UI can
--     show armed state.
--
-- DATA RULES respected:
--   • ADD COLUMN IF NOT EXISTS (idempotent).
--   • ON DELETE SET NULL on the audit user FK (per CLAUDE.md rule).
--   • CREATE OR REPLACE on shift_self_period_lock and shift_tick —
--     every other line of those bodies is preserved byte-for-byte from
--     the live (post-0074) definitions.
--   • Single-table writes by exact session id with FOR UPDATE.
--   • Re-grants exactly mirror existing.
-- =====================================================================
begin;

-- 1. ADD COLUMNS.
alter table public.shift_sessions
  add column if not exists skip_next_period_lock boolean not null default false,
  add column if not exists skip_next_period_lock_set_by uuid
    references public.users(id) on delete set null,
  add column if not exists skip_next_period_lock_set_at timestamptz null;

comment on column public.shift_sessions.skip_next_period_lock is
  'One-shot flag — when true, the NEXT call to shift_self_period_lock for this session does not lock; it consumes the flag (sets false) and advances current_period_index by 1 so the boundary moves forward by exactly one period. Set by admins via shift_admin_skip_next_lock.';

-- 2. NEW RPC — shift_admin_skip_next_lock(p_session_id uuid).
-- Admin-only. Idempotent: arming twice in a row is fine.
create or replace function public.shift_admin_skip_next_lock(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_s   public.shift_sessions;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;

  update public.shift_sessions
     set skip_next_period_lock        = true,
         skip_next_period_lock_set_by = v_uid,
         skip_next_period_lock_set_at = now(),
         updated_at                   = now()
   where id = p_session_id;

  insert into public.shift_events (session_id, user_id, type, by, meta) values
    (v_s.id, v_s.user_id, 'admin_override', v_uid,
      jsonb_build_object('action', 'skip_next_period_lock',
                         'previous_armed', v_s.skip_next_period_lock));

  return jsonb_build_object(
    'session_id', v_s.id,
    'skip_armed', true
  );
end;
$function$;

revoke all on function public.shift_admin_skip_next_lock(uuid) from public, anon;
grant execute on function public.shift_admin_skip_next_lock(uuid) to authenticated;

-- 3. shift_self_period_lock — preserve LIVE body; ADD the skip branch.
-- The skip branch sits between the "already locked" idempotent return
-- and the "must be in a lockable status" guard, so:
--   • already-locked sessions still short-circuit as before.
--   • non-lockable statuses (not_started/completed) still error as before.
--   • a normal lockable session with skip_next_period_lock=true takes
--     the skip path; without the flag, the UPDATE→locked path runs
--     byte-for-byte the same as 0058 / live.
create or replace function public.shift_self_period_lock(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_s   public.shift_sessions;
  v_old_cpi int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode='42501';
  end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.user_id <> v_uid and not is_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  -- Idempotent: already locked = no-op.
  if v_s.status = 'locked' then
    return jsonb_build_object('session_id', v_s.id, 'status', 'locked', 'already_locked', true);
  end if;
  if v_s.status not in ('active','on_shift_break','on_bio_break') then
    raise exception 'session not lockable from status %', v_s.status using errcode='22023';
  end if;

  -- 0075 — admin skip-next-lock branch. Consume the one-shot flag and
  -- advance the period boundary forward by one. Status is UNCHANGED
  -- (manager keeps working / breaking). Idempotent in the sense that
  -- re-calling this RPC without the flag re-armed will lock normally.
  if v_s.skip_next_period_lock then
    v_old_cpi := v_s.current_period_index;
    update public.shift_sessions
       set skip_next_period_lock = false,
           current_period_index  = current_period_index + 1,
           updated_at            = now()
     where id = v_s.id;
    insert into public.shift_events (session_id, user_id, type, by, meta) values
      (v_s.id, v_s.user_id, 'admin_override', null,
        jsonb_build_object('action',                   'period_lock_skipped',
                           'period_index',             v_old_cpi,
                           'new_current_period_index', v_old_cpi + 1,
                           'skip_armed_by',            v_s.skip_next_period_lock_set_by,
                           'skip_armed_at',            v_s.skip_next_period_lock_set_at));
    return jsonb_build_object(
      'session_id', v_s.id,
      'status',     v_s.status,
      'skipped',    true,
      'already_locked', false
    );
  end if;

  -- Existing lock path — preserved byte-for-byte from the live 0058 body.
  update public.shift_sessions
     set status = 'locked',
         current_pause_started_at = now(),
         current_pause_reason     = 'period_lock',
         locked_at                = now(),
         locked_reason            = 'period_lock',
         locked_by                = null,                 -- system-initiated
         updated_at               = now()
   where id = v_s.id;
  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_s.user_id, 'period_lock', null,
            jsonb_build_object('reason', 'period_lock',
                               'period_index', v_s.current_period_index));
  return jsonb_build_object('session_id', v_s.id, 'status', 'locked', 'already_locked', false);
end;
$function$;

revoke all on function public.shift_self_period_lock(uuid) from public, anon;
grant execute on function public.shift_self_period_lock(uuid) to authenticated;

-- 4. shift_tick — preserve LIVE body verbatim; ADD the skip flag to
-- the returned jsonb so the admin UI can show armed state. All
-- existing fields are byte-for-byte preserved.
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
    'shift_break_frozen',             coalesce(v_s.current_pause_reason = 'break_overstay', false),
    -- 0069
    'shift_break_overstay_grace_seconds', v_overstay_grace,
    -- 0075 — admin-armed skip flag
    'skip_next_period_lock',          v_s.skip_next_period_lock,
    'now',                            clock_timestamp()
  );
end;
$function$;

revoke all on function public.shift_tick(uuid) from public, anon;
grant execute on function public.shift_tick(uuid) to authenticated;

commit;
