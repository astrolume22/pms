-- =====================================================================
-- 0060 — Break buttons + bio limits (Phase 4.4)
-- =====================================================================
-- Adds the small bits missing from 0057's break RPCs so the manager
-- UI can:
--   • take a shift or bio break with a session_id (and admin-driven
--     override path for the rare "admin starts a break for someone"),
--   • render a live "on break — MM:SS" readout via shift_tick,
--   • detect bio-limit-reached and show "Request Bio Break" instead of
--     erroring out,
--   • see warn thresholds via shift_tick so we don't need a second
--     fetch.
--
-- LOCKED RULE (DECISION 1): NO break EVER pauses the work timer. The
-- pause fields (paused_total_seconds, current_pause_started_at,
-- current_pause_reason) are LOCK-only — break RPCs never touch them.
-- Break time is tracked in the new current_break_* fields ONLY for
-- the UI display + bio limit math.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP FUNCTION IF EXISTS +
-- CREATE OR REPLACE everywhere.
-- =====================================================================

-- ---------- 1. Additive columns on shift_sessions --------------------
alter table public.shift_sessions
  add column if not exists current_break_started_at      timestamptz null,
  add column if not exists current_break_kind            text        null,
  add column if not exists bio_break_admin_grants_today  int         not null default 0;

-- Constraint on current_break_kind (idempotent via DO block).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.shift_sessions'::regclass
       and conname = 'shift_sessions_break_kind_check'
  ) then
    alter table public.shift_sessions
      add constraint shift_sessions_break_kind_check
      check (current_break_kind is null or current_break_kind in ('shift','bio'));
  end if;
end $$;

-- ---------- 2. Break RPCs — signature change (drop + recreate) ------
-- Old signatures took no args; new ones take session_id + allow admin
-- override. The drops are safe because the GRANTs from 0057 also go
-- away — we re-grant at the bottom.
drop function if exists public.shift_take_shift_break();
drop function if exists public.shift_take_bio_break();
drop function if exists public.shift_end_break();

-- ---- shift_take_shift_break(session_id) ----------------------------
create or replace function public.shift_take_shift_break(p_session_id uuid)
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
  -- DECISION 1: no pause math. Just flip status + stamp the break.
  update public.shift_sessions
     set status                   = 'on_shift_break',
         current_break_started_at = now(),
         current_break_kind       = 'shift',
         updated_at               = now()
   where id = v_s.id;
  insert into public.shift_events (session_id, user_id, type, by)
    values (v_s.id, v_s.user_id, 'shift_break_start', v_uid);
  return jsonb_build_object(
    'session_id', v_s.id,
    'status',     'on_shift_break'
  );
end;
$$;

-- ---- shift_take_bio_break(session_id) ------------------------------
-- Returns { needs_request: true } when at-limit instead of raising.
-- The UI uses that flag to switch the button to "Request Bio Break".
-- Effective limit = config.bio_break_max_per_day
--                 + session.bio_break_admin_grants_today
-- (admin-approved requests increment grants_today server-side in
--  bio_break_request_decide below).
create or replace function public.shift_take_bio_break(p_session_id uuid)
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
  v_effective_max := coalesce(v_cfg.bio_break_max_per_day, 7) + coalesce(v_s.bio_break_admin_grants_today, 0);

  if v_s.bio_break_count_today >= v_effective_max then
    return jsonb_build_object(
      'session_id',       v_s.id,
      'status',           v_s.status,
      'needs_request',    true,
      'count_today',      v_s.bio_break_count_today,
      'max_per_day',      v_cfg.bio_break_max_per_day,
      'admin_grants_today', v_s.bio_break_admin_grants_today
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
    'needs_request', false
  );
end;
$$;

-- ---- shift_end_break(session_id) -----------------------------------
-- Duration = clock_timestamp() - current_break_started_at (no need
-- to query shift_events). Caps bio duration at config.bio_break_max
-- _seconds_each; records exceeded_cap=true in the event meta when
-- the wall-clock break exceeded the cap.
create or replace function public.shift_end_break(p_session_id uuid)
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_s   public.shift_sessions;
  v_cfg public.shift_configs;
  v_kind text;
  v_actual int;
  v_recorded int;
  v_exceeded boolean := false;
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

  v_kind := v_s.current_break_kind;
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
    update public.shift_sessions
       set status                   = 'active',
           current_break_started_at = null,
           current_break_kind       = null,
           updated_at               = now()
     where id = v_s.id;
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (v_s.id, v_s.user_id, 'shift_break_end', v_uid,
              jsonb_build_object('duration_seconds', v_actual));
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
$$;

-- ---------- 3. bio_break_request_decide — bump grants on approve ----
create or replace function public.bio_break_request_decide(
  p_request_id uuid, p_decision text, p_note text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_req public.bio_break_requests;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  if p_decision not in ('approved','denied') then
    raise exception 'invalid decision' using errcode='22023';
  end if;
  select * into v_req from public.bio_break_requests where id = p_request_id for update;
  if not found then raise exception 'request not found' using errcode='02000'; end if;
  if v_req.status <> 'pending' then
    raise exception 'already decided' using errcode='22023';
  end if;
  update public.bio_break_requests
     set status = p_decision,
         decided_by = v_uid,
         decided_at = now(),
         decision_note = p_note
   where id = p_request_id;

  -- On approve, grant one extra bio break for THIS session today.
  -- This makes the spec's "may take one more bio break" work without
  -- a separate consume-on-use tracker.
  if p_decision = 'approved' then
    update public.shift_sessions
       set bio_break_admin_grants_today = bio_break_admin_grants_today + 1,
           updated_at = now()
     where id = v_req.session_id;
  end if;

  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_req.session_id, v_req.user_id, 'bio_break_request_decided', v_uid,
            jsonb_build_object('request_id', p_request_id, 'decision', p_decision));
  return jsonb_build_object('request_id', p_request_id, 'status', p_decision);
end;
$$;

-- ---------- 4. shift_tick — expose break + bio limits ---------------
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
    -- Break state
    'current_break_kind',             v_s.current_break_kind,
    'current_break_started_at',       v_s.current_break_started_at,
    'current_break_elapsed_seconds',  v_break_elapsed,
    -- Bio counters + config (denormalized so the UI can warn / decide)
    'bio_break_count_today',          v_s.bio_break_count_today,
    'bio_break_total_seconds_today',  v_s.bio_break_total_seconds_today,
    'bio_break_admin_grants_today',   v_s.bio_break_admin_grants_today,
    'bio_break_max_per_day',          v_cfg.bio_break_max_per_day,
    'bio_break_warn_count',           v_cfg.bio_break_warn_count,
    'bio_break_warn_total_seconds',   v_cfg.bio_break_warn_total_seconds,
    'bio_break_max_seconds_each',     v_cfg.bio_break_max_seconds_each,
    'bio_limit_reached',              v_s.bio_break_count_today >= v_eff_max,
    -- Lock state
    'locked_at',                      v_s.locked_at,
    'locked_reason',                  v_s.locked_reason,
    'completed_at',                   v_s.completed_at,
    'now',                            clock_timestamp()
  );
end;
$$;

-- ---------- 5. GRANTs (re-applied for the dropped+recreated RPCs) ---
grant execute on function public.shift_take_shift_break(uuid)     to authenticated;
grant execute on function public.shift_take_bio_break(uuid)       to authenticated;
grant execute on function public.shift_end_break(uuid)            to authenticated;
grant execute on function public.shift_tick(uuid)                 to authenticated;
grant execute on function public.bio_break_request_decide(uuid, text, text) to authenticated;
