-- =====================================================================
-- 0058 — Shift periodic lock + 85% alert (Phase 4.3)
-- =====================================================================
-- Builds on 0057. No new tables. Three RPC changes:
--   • shift_tick: fix the 85% threshold for period_index >= 1.
--     The old formula multiplied 0.85 by the absolute period END,
--     which fires too early on every period after the first
--     (e.g. for idx=1, threshold was 1.7×period instead of 1.85×).
--     New formula computes 85% INTO THE CURRENT PERIOD:
--       threshold = idx * period_seconds + 0.85 * period_seconds
--   • shift_self_period_lock(session_id) — NEW. Self-or-admin
--     callable. Flips status to 'locked', sets locked_reason
--     'period_lock', records the pause so the timer is frozen
--     (the one allowed pause; breaks never pause). Idempotent:
--     calling on an already-locked session returns ok without
--     changes. Emits a 'period_lock' event.
--   • shift_mark_85_alerted(session_id) — NEW. Self-or-admin.
--     Sets period_85_last_index_alerted = current_period_index so
--     the alert fires exactly once per period. Emits
--     'period_85_alert'. Idempotent (already-alerted = no-op).
--
-- shift_admin_unlock is unchanged — it already does the right thing
-- (pause-duration → paused_total_seconds, null lock fields, status
-- → active, increment current_period_index, emit 'period_unlock'
-- with pause_seconds + was_period_lock in meta, is_admin() gated).
-- Only the meta is widened a touch to also carry locked_by.
-- =====================================================================

-- ---------- shift_tick (corrected 85% threshold) ---------------------
create or replace function public.shift_tick(p_session_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_s        public.shift_sessions;
  v_admin    boolean;
  v_elapsed  int;
  v_remain   int;
  v_period_start int;
  v_period_end   int;
  v_85_threshold int;
  v_85_due   boolean;
  v_lock_due boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_admin := is_admin();
  select * into v_s from public.shift_sessions where id = p_session_id;
  if not found then
    raise exception 'session not found' using errcode = '02000';
  end if;
  if v_s.user_id <> v_uid and not v_admin then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_s.started_at is null then
    v_elapsed := 0;
  else
    -- Elapsed = wall-clock since start, MINUS lock pause time only.
    -- Breaks are NOT subtracted (DECISION 1 from 0057).
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
  -- BUG FIX (P4.3): 85% threshold is INTO the current period, not into
  -- absolute time. For idx=0 the formula is identical to the old one;
  -- for idx>=1 it now correctly fires after 85% of period_seconds since
  -- the last period boundary.
  v_85_threshold := v_period_start + (v_s.period_seconds * 0.85)::int;
  v_85_due := v_elapsed >= v_85_threshold
              and v_s.period_85_last_index_alerted < v_s.current_period_index
              and v_s.status in ('active','on_shift_break','on_bio_break');
  v_lock_due := v_elapsed >= v_period_end
              and v_s.status in ('active','on_shift_break','on_bio_break');

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
    'bio_break_count_today',          v_s.bio_break_count_today,
    'bio_break_total_seconds_today',  v_s.bio_break_total_seconds_today,
    'locked_at',                      v_s.locked_at,
    'locked_reason',                  v_s.locked_reason,
    'completed_at',                   v_s.completed_at,
    'now',                            clock_timestamp()
  );
end;
$$;

-- ---------- shift_self_period_lock(session_id) — NEW -----------------
-- Caller = session's user OR admin. Idempotent: already-locked → ok.
-- This is the canonical PERIOD lock; admin manual lock still uses
-- shift_admin_lock(reason='admin').
create or replace function public.shift_self_period_lock(p_session_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions;
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
  -- Only sessions actually in the lock-due range should reach this RPC.
  -- We don't re-verify period_lock_due server-side here (would race with
  -- the client tick that triggered it), but we DO refuse to lock a
  -- session that hasn't started or is already completed.
  if v_s.status not in ('active','on_shift_break','on_bio_break') then
    raise exception 'session not lockable from status %', v_s.status using errcode='22023';
  end if;
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
$$;

-- ---------- shift_mark_85_alerted(session_id) — NEW ------------------
create or replace function public.shift_mark_85_alerted(p_session_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode='42501';
  end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.user_id <> v_uid and not is_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  -- Idempotent: already alerted this period = no-op.
  if v_s.period_85_last_index_alerted >= v_s.current_period_index then
    return jsonb_build_object('session_id', v_s.id, 'already_alerted', true);
  end if;
  update public.shift_sessions
     set period_85_last_index_alerted = v_s.current_period_index,
         updated_at = now()
   where id = v_s.id;
  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_s.user_id, 'period_85_alert', v_uid,
            jsonb_build_object('period_index', v_s.current_period_index));
  return jsonb_build_object('session_id', v_s.id, 'already_alerted', false,
                            'period_index', v_s.current_period_index);
end;
$$;

-- ---------- shift_admin_unlock — meta now includes locked_by ---------
-- Behavior unchanged otherwise; just widening the audit payload.
create or replace function public.shift_admin_unlock(p_session_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions; v_dur int; v_was_period boolean;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.status <> 'locked' then raise exception 'not locked' using errcode='22023'; end if;
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
            jsonb_build_object('pause_seconds', v_dur,
                               'was_period_lock', v_was_period,
                               'locked_by', v_s.locked_by));
  return jsonb_build_object('session_id', v_s.id, 'status', 'active',
                            'lock_wait_seconds', v_dur);
end;
$$;

-- ---------- GRANTS ---------------------------------------------------
grant execute on function public.shift_self_period_lock(uuid) to authenticated;
grant execute on function public.shift_mark_85_alerted(uuid)  to authenticated;
