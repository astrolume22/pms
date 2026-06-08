-- =====================================================================
-- 0064 — account-level admin lock (per user, independent of any session).
--
-- Why:
--   Today the admin "lock" is session-scoped (shift_admin_lock takes a
--   p_session_id). That means an offline manager, a manager who hasn't
--   started today's shift, or any user without a shift_sessions row for
--   today CANNOT be locked. The admin toggle disables in those cases.
--   We also have NO server-side block on shift_start() for a locked
--   account — even if we somehow flagged a user as locked, they could
--   still hit "Start Shift" and become 'active'.
--
-- What this migration changes (additive only — no destructive change):
--
--   1. shift_configs gains three columns:
--        account_locked    boolean   NOT NULL DEFAULT false
--        account_locked_at timestamptz NULL
--        account_locked_by uuid       NULL → public.users(id)
--                                            ON DELETE SET NULL
--      Default false means every existing row (and every future row)
--      starts unlocked. NO backfill: the 16 seeded managers remain
--      account_locked=false after this migration.
--
--   2. New RPC shift_admin_set_account_lock(p_target_user_id uuid,
--                                          p_locked boolean) RETURNS jsonb.
--      Admin-only. UPSERTs into shift_configs (auto-creating a config
--      row matching the seed path's shape — hard_until = now() + 14d —
--      if the user somehow doesn't have one yet, so this RPC NEVER
--      fails for "no config row").  Writes an 'admin_override' audit
--      to shift_events with meta.action = 'account_lock' |
--      'account_unlock' (reuses the existing audit type list — no
--      CHECK constraint change needed). session_id is NULL because by
--      design this lock has no session dependency.
--
--   3. shift_start() gains ONE new guard, RIGHT after the existing
--      authentication / is_active_user check and BEFORE any state read:
--          if (account_locked) raise 'account locked' (42501)
--      Every other line of shift_start stays byte-for-byte the same so
--      the late-start computation, the period snapshot, the scheduled-
--      start timing, and the audit-event chain are all unchanged.
--      The block is enforced server-side so a stale client or a direct
--      RPC call cannot bypass the UI overlay.
--
--   4. New RPC shift_my_account_lock() RETURNS jsonb — a small,
--      self-only read the candidate side polls (~30s) to know whether
--      to show the AccountLockedOverlay.  Uses auth.uid() — no params,
--      no admin check, RLS-safe: a user can only see their own lock
--      state.
--
-- shift_admin_lock / shift_admin_unlock / shift_self_period_lock are
-- UNCHANGED — the session-level period-lock is a different concept and
-- this migration is purely additive.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. ADD COLUMNS — account_locked / account_locked_at / account_locked_by.
-- ---------------------------------------------------------------------
alter table public.shift_configs
  add column if not exists account_locked    boolean      not null default false,
  add column if not exists account_locked_at timestamptz  null,
  add column if not exists account_locked_by uuid         null
    references public.users(id) on delete set null;

comment on column public.shift_configs.account_locked is
  'When true, this user cannot start a shift. Set by an admin via shift_admin_set_account_lock; checked server-side by shift_start() and surfaced to the candidate UI by shift_my_account_lock().';
comment on column public.shift_configs.account_locked_at is
  'Wall-clock time the current account lock was applied. NULL when account_locked=false.';
comment on column public.shift_configs.account_locked_by is
  'The admin (auth.uid()) who applied the current account lock. ON DELETE SET NULL — admin removal must not silently unlock the user.';

-- ---------------------------------------------------------------------
-- 2. RPC — shift_admin_set_account_lock(p_target_user_id, p_locked).
-- ---------------------------------------------------------------------
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
  v_now        timestamptz := now();
  v_locked_at  timestamptz;
  v_locked_by  uuid;
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

  -- UPSERT: if the user has no config row yet (rare — get_or_create
  -- normally creates one on the first session seed), insert one
  -- matching the seed path's hard_until = now()+14d so the new-hire
  -- ramp stays consistent. NEVER fails for "no row".
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

  -- Audit. session_id IS NULL by design — this lock is account-scoped.
  -- We reuse 'admin_override' (already in the shift_events.type CHECK)
  -- with meta.action distinguishing 'account_lock' from 'account_unlock'.
  insert into public.shift_events (session_id, user_id, type, by, meta) values (
    null, p_target_user_id, 'admin_override', v_uid,
    jsonb_build_object(
      'action',         case when p_locked then 'account_lock' else 'account_unlock' end,
      'existed_before', v_existed,
      'old_locked',     case when v_existed then v_old.account_locked else null end,
      'new_locked',     p_locked
    )
  );

  return jsonb_build_object(
    'user_id',           p_target_user_id,
    'account_locked',    p_locked,
    'account_locked_at', v_locked_at,
    'account_locked_by', v_locked_by
  );
end;
$function$;

revoke all on function public.shift_admin_set_account_lock(uuid, boolean) from public, anon;
grant execute on function public.shift_admin_set_account_lock(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. shift_start() — add the account_locked guard.
--    Only ONE new check; every other line is byte-for-byte the same
--    as 0057 (and the late-start branch added later). Guard runs AFTER
--    the auth/is_active_user check and BEFORE any other state read.
-- ---------------------------------------------------------------------
create or replace function public.shift_start()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- NEW (0064): account-level admin lock blocks shift start entirely.
  -- Reads shift_configs.account_locked for the caller; if true, refuse
  -- before any session state is touched. The candidate UI gets a
  -- friendly overlay via shift_my_account_lock() — this raise is the
  -- belt-and-suspenders server guard.
  if exists (
    select 1 from public.shift_configs
     where user_id = v_uid and account_locked = true
  ) then
    raise exception 'account locked' using errcode='42501';
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
$function$;

-- ---------------------------------------------------------------------
-- 4. shift_my_account_lock() — candidate-side read, self-only.
-- ---------------------------------------------------------------------
create or replace function public.shift_my_account_lock()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'account_locked',    coalesce(c.account_locked, false),
    'account_locked_at', c.account_locked_at
  )
  from (
    select cfg.account_locked, cfg.account_locked_at
      from public.shift_configs cfg
     where cfg.user_id = auth.uid()
    union all
    -- Fallback row so the query still returns a JSON object when the
    -- user has no config row yet. unlocked is the safe default.
    select false, null
    where not exists (select 1 from public.shift_configs where user_id = auth.uid())
  ) c
  limit 1;
$function$;

revoke all on function public.shift_my_account_lock() from public, anon;
grant execute on function public.shift_my_account_lock() to authenticated;

commit;
