-- =====================================================================
-- 0065 — locking a manager FREEZES their 8h timer; unlock RESUMES with
-- zero time lost.
--
-- Why:
--   After 0064 the admin "lock" is account-level: shift_configs.account_locked
--   blocks shift_start() entirely. But if the user already has a RUNNING
--   session today, that session is untouched — current_pause_started_at
--   stays NULL, status stays 'active', and shift_tick keeps decrementing
--   the 8h clock while the manager can't reach the board. The founder
--   needs the lock to ALSO freeze the timer the moment it's applied, and
--   resume from exactly where it froze on unlock.
--
-- What this migration changes (additive only — no DROP / no destructive
-- change):
--
--   1. shift_admin_set_account_lock(user, true)
--        ADDITIONALLY: if the target user has a working session today
--        (status in active / on_shift_break / on_bio_break) PAUSES it:
--          • status = 'locked'
--          • current_pause_started_at = now()
--          • current_pause_reason     = 'admin'
--          • locked_at = now(), locked_reason = 'admin', locked_by = admin
--        Idempotent: a session that's already locked or not_started or
--        completed is left untouched (no double-pause, no exception).
--
--   2. shift_admin_set_account_lock(user, false)
--        ADDITIONALLY: if the target's session is admin-paused
--        (status='locked' AND locked_reason='admin' AND
--        current_pause_started_at IS NOT NULL) RESUMES it:
--          • paused_total_seconds += (now() - current_pause_started_at)
--          • current_pause_started_at = NULL, current_pause_reason = NULL
--          • status = 'active', locked_at/reason/by cleared
--        Because the pause duration is credited to paused_total_seconds,
--        shift_tick's elapsed = (now() - started_at) - paused_total_seconds
--        excludes the entire locked window. The 8h clock resumes from
--        exactly where it froze. Idempotent: anything not in the
--        admin-paused state is left untouched.
--
--   3. shift_admin_unlock(p_session_id) is made IDEMPOTENT for the
--      "already unlocked" case. After change #2, the toggle's OFF path
--      may call shift_admin_unlock on a session that the account-unlock
--      just resumed (so its status is already 'active'). The previous
--      version raised 'not locked' (22023); now it returns success with
--      already_unlocked=true. Behavior on a still-locked session is
--      byte-for-byte identical to 0058.
--
-- shift_tick is UNCHANGED — it already correctly returns a frozen
-- elapsed/remaining when current_pause_started_at is set, and surfaces
-- v_s.status verbatim. The manager's ShiftCountdownChip already shows
-- 'LOCKED' when status='locked'; the AdminShiftControlSection Remaining
-- column already shows the frozen number + "Paused (locked)" badge.
--
-- DATA RULES respected:
--   • No DROP, no CASCADE. CREATE OR REPLACE only.
--   • No FK changes. No new columns. No table touched in DDL.
--   • Single-row writes by exact id (shift_sessions.id) or by
--     (user_id, work_date) within a FOR UPDATE-locked SELECT.
--   • answers table never referenced.
-- =====================================================================
begin;

create or replace function public.shift_admin_set_account_lock(
  p_target_user_id uuid,
  p_locked         boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_old        public.shift_configs;
  v_existed    boolean;
  -- Wall-clock pause instant. Use clock_timestamp() (not now()) so the
  -- duration arithmetic in shift_tick / shift_admin_unlock is exact
  -- even when callers chain multiple RPCs inside a single transaction
  -- (e.g. the apply-0065 verification script). In normal RPC traffic
  -- now() and clock_timestamp() match to within microseconds.
  v_now        timestamptz := clock_timestamp();
  v_locked_at  timestamptz;
  v_locked_by  uuid;
  v_s          public.shift_sessions;
  v_pause_secs int;
  v_session_paused  boolean := false;
  v_session_resumed boolean := false;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode='42501';
  end if;
  if p_target_user_id is null then
    raise exception 'p_target_user_id is required' using errcode='22023';
  end if;
  if not exists (select 1 from public.users where id = p_target_user_id and status='active') then
    raise exception 'target user not found or inactive' using errcode='42501';
  end if;

  v_locked_at := case when p_locked then v_now else null end;
  v_locked_by := case when p_locked then v_uid else null end;

  select * into v_old from public.shift_configs where user_id = p_target_user_id;
  v_existed := found;

  -- UPSERT into shift_configs (unchanged behavior from 0064).
  insert into public.shift_configs (
    user_id, account_locked, account_locked_at, account_locked_by,
    hard_until, updated_at, updated_by
  ) values (
    p_target_user_id, p_locked, v_locked_at, v_locked_by,
    v_now + interval '14 days', v_now, v_uid
  )
  on conflict (user_id) do update set
    account_locked    = excluded.account_locked,
    account_locked_at = excluded.account_locked_at,
    account_locked_by = excluded.account_locked_by,
    updated_at        = v_now,
    updated_by        = v_uid;

  -- NEW: also pause/unpause the user's session today so the 8h timer
  -- freezes the instant they're locked and resumes with zero time lost.
  select * into v_s from public.shift_sessions
    where user_id = p_target_user_id
      and work_date = (v_now at time zone 'UTC')::date
    for update;

  if found then
    if p_locked then
      -- LOCK SIDE: only act on a running session. Idempotent — skip
      -- if already locked / not_started / completed.
      if v_s.status in ('active','on_shift_break','on_bio_break') then
        update public.shift_sessions set
          status                   = 'locked',
          current_pause_started_at = v_now,
          current_pause_reason     = 'admin',
          locked_at                = v_now,
          locked_reason            = 'admin',
          locked_by                = v_uid,
          updated_at               = v_now
        where id = v_s.id;
        v_session_paused := true;
        insert into public.shift_events (session_id, user_id, type, by, meta) values (
          v_s.id, v_s.user_id, 'admin_override', v_uid,
          jsonb_build_object('action',    'account_lock_pause',
                             'paused_at', v_now,
                             'from_status', v_s.status)
        );
      end if;
    else
      -- UNLOCK SIDE: only act on an admin-paused locked session.
      -- Idempotent — period-locked sessions are left for shift_admin_unlock
      -- + shift_admin_rearm to handle separately.
      if v_s.status = 'locked'
         and v_s.locked_reason = 'admin'
         and v_s.current_pause_started_at is not null then
        v_pause_secs := greatest(0, extract(epoch from (v_now - v_s.current_pause_started_at))::int);
        update public.shift_sessions set
          status                   = 'active',
          paused_total_seconds     = paused_total_seconds + v_pause_secs,
          current_pause_started_at = null,
          current_pause_reason     = null,
          locked_at                = null,
          locked_reason            = null,
          locked_by                = null,
          updated_at               = v_now
        where id = v_s.id;
        v_session_resumed := true;
        insert into public.shift_events (session_id, user_id, type, by, meta) values (
          v_s.id, v_s.user_id, 'admin_override', v_uid,
          jsonb_build_object('action',         'account_unlock_resume',
                             'paused_seconds', v_pause_secs,
                             'resumed_at',     v_now)
        );
      end if;
    end if;
  end if;

  -- Audit (unchanged from 0064 for the config-level flip; now also
  -- records whether a session was paused/resumed).
  insert into public.shift_events (session_id, user_id, type, by, meta) values (
    null, p_target_user_id, 'admin_override', v_uid,
    jsonb_build_object(
      'action',         case when p_locked then 'account_lock' else 'account_unlock' end,
      'existed_before', v_existed,
      'old_locked',     case when v_existed then v_old.account_locked else null end,
      'new_locked',     p_locked,
      'session_paused', v_session_paused,
      'session_resumed', v_session_resumed
    )
  );

  return jsonb_build_object(
    'user_id',           p_target_user_id,
    'account_locked',    p_locked,
    'account_locked_at', v_locked_at,
    'account_locked_by', v_locked_by,
    'session_paused',    v_session_paused,
    'session_resumed',   v_session_resumed
  );
end;
$function$;

-- shift_admin_unlock — made idempotent for the "already unlocked" case
-- so the toggle's OFF flow (which may call account-unlock + period-unlock
-- in sequence) doesn't trip on the already-resumed session.
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
  -- NEW: idempotent on already-unlocked sessions. Previously raised
  -- 'not locked' (22023). The toggle's OFF path may now hit this case
  -- when the preceding account-unlock already resumed the session.
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
$$;

revoke all on function public.shift_admin_set_account_lock(uuid, boolean) from public, anon;
grant execute on function public.shift_admin_set_account_lock(uuid, boolean) to authenticated;
revoke all on function public.shift_admin_unlock(uuid) from public, anon;
grant execute on function public.shift_admin_unlock(uuid) to authenticated;

commit;
