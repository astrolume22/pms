-- =====================================================================
-- 0057 — Shift System DB layer (Phase 4.1)
-- =====================================================================
-- Adds the five shift tables, RLS policies, seed data for the 14 active
-- managers, and the SECURITY DEFINER RPCs that drive the server-time
-- countdown and lifecycle transitions.
--
-- LOCKED DECISIONS encoded here (override any older "pause" wording in
-- the build plan):
--   • NO break ever pauses the timer. Shift + bio breaks are ALWAYS
--     PAID. The countdown keeps running for the entire duration of any
--     break. paused_total_seconds + current_pause_started_at +
--     current_pause_reason exist ONLY for the period LOCK and the
--     admin LOCK — never for breaks. Break RPCs do not touch them.
--   • Per-user config only (no per-group default at this stage).
--   • shift_configs.primary_group_id (NULLABLE FK to groups) — the
--     group the Start-Shift gate + blur apply to; admin sets it later.
--   • Daily reset is LAZY: shift_get_or_create_today_session() inserts
--     today's row on first call; admin_close_orphaned_shifts() closes
--     any stale active rows from previous days. No cron added.
--
-- Server-time only: every elapsed/remaining computation reads now()
-- inside an RPC. The client is purely a display layer that interpolates
-- between ticks. Refresh / refocus / clock change cannot steal time.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP POLICY IF EXISTS before each CREATE POLICY, ON CONFLICT DO
-- NOTHING on every seed insert, guarded admin_close_orphaned_shifts.
-- =====================================================================

-- ---------- TABLES ---------------------------------------------------

create table if not exists public.shift_configs (
  user_id                       uuid        primary key references public.users(id)  on delete cascade,
  mode                          text        not null default 'medium'
                                              check (mode in ('easy','medium','hard')),
  required_seconds_default      int         not null default 28800,                  -- 8h
  shift_break_seconds           int         not null default 3600,                   -- 60min allowance
  shift_break_paid_seconds      int         not null default 3600,                   -- portion that counts INSIDE
  bio_break_max_per_day         int         not null default 7,
  bio_break_warn_count          int         not null default 6,
  bio_break_warn_total_seconds  int         not null default 3600,                   -- 60min cumulative
  bio_break_max_seconds_each    int         not null default 900,                    -- 15min per
  primary_group_id              uuid            null references public.groups(id)    on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  updated_by                    uuid            null references public.users(id)     on delete set null
);

create table if not exists public.shift_schedules (
  user_id            uuid     not null references public.users(id) on delete cascade,
  weekday            smallint not null check (weekday between 0 and 6),               -- 0 = Sunday (Postgres EXTRACT(DOW))
  enabled            boolean  not null default true,
  required_seconds   int      not null default 28800,
  primary key (user_id, weekday)
);

create table if not exists public.shift_sessions (
  id                             uuid        primary key default uuid_generate_v4(),
  user_id                        uuid        not null references public.users(id) on delete cascade,
  work_date                      date        not null,
  status                         text        not null default 'not_started'
                                               check (status in ('not_started','active','on_shift_break',
                                                                 'on_bio_break','locked','completed')),
  -- Snapshot of config at start so retroactive admin edits don't warp this shift
  mode                           text        not null check (mode in ('easy','medium','hard')),
  period_seconds                 int         not null,
  required_seconds               int         not null,
  -- Time bookkeeping (server-authoritative; breaks NEVER touch the pause fields)
  started_at                     timestamptz null,
  paused_total_seconds           int         not null default 0,
  current_pause_started_at       timestamptz null,
  current_pause_reason           text        null
                                               check (current_pause_reason in ('period_lock','admin')),
  current_period_index           int         not null default 0,
  period_85_last_index_alerted   int         not null default -1,
  -- Lock state (when status = 'locked')
  locked_at                      timestamptz null,
  locked_reason                  text        null
                                               check (locked_reason in ('period_lock','shift_complete','admin','bio_request')),
  locked_by                      uuid        null references public.users(id) on delete set null,
  -- Daily counters (cached for fast limit checks)
  bio_break_count_today          int         not null default 0,
  bio_break_total_seconds_today  int         not null default 0,
  -- Lifecycle
  completed_at                   timestamptz null,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  unique (user_id, work_date)
);
create index if not exists shift_sessions_user_idx     on public.shift_sessions (user_id, work_date desc);
create index if not exists shift_sessions_status_idx   on public.shift_sessions (status) where status in ('active','on_shift_break','on_bio_break','locked');

create table if not exists public.shift_events (
  id          uuid        primary key default uuid_generate_v4(),
  session_id  uuid        not null references public.shift_sessions(id) on delete cascade,
  user_id     uuid        not null,                                                   -- denormalized for admin monitor queries
  type        text        not null check (type in (
                  'shift_start','period_85_alert','period_lock','period_unlock',
                  'shift_break_start','shift_break_end',
                  'bio_break_start','bio_break_end','bio_break_auto_end',
                  'bio_break_request','bio_break_request_decided',
                  'shift_complete','admin_override')),
  at          timestamptz not null default now(),
  by          uuid        null references public.users(id) on delete set null,        -- null = system
  meta        jsonb       not null default '{}'::jsonb
);
create index if not exists shift_events_session_at_idx on public.shift_events (session_id, at);
create index if not exists shift_events_user_at_idx    on public.shift_events (user_id, at);

create table if not exists public.bio_break_requests (
  id            uuid        primary key default uuid_generate_v4(),
  session_id    uuid        not null references public.shift_sessions(id) on delete cascade,
  user_id       uuid        not null references public.users(id)          on delete cascade,
  requested_at  timestamptz not null default now(),
  status        text        not null default 'pending'
                              check (status in ('pending','approved','denied')),
  decided_by    uuid        null references public.users(id) on delete set null,
  decided_at    timestamptz null,
  decision_note text        null
);
create index if not exists bio_break_requests_user_idx    on public.bio_break_requests (user_id, requested_at);
create index if not exists bio_break_requests_pending_idx on public.bio_break_requests (status, requested_at) where status = 'pending';

-- ---------- RLS ------------------------------------------------------

alter table public.shift_configs       enable row level security;
alter table public.shift_schedules     enable row level security;
alter table public.shift_sessions      enable row level security;
alter table public.shift_events        enable row level security;
alter table public.bio_break_requests  enable row level security;

-- shift_configs: self/admin read, admin-only writes
drop policy if exists shift_configs_select on public.shift_configs;
create policy shift_configs_select on public.shift_configs for select
  using (is_admin() or user_id = auth.uid());
drop policy if exists shift_configs_write on public.shift_configs;
create policy shift_configs_write on public.shift_configs for all
  using (is_admin()) with check (is_admin());

-- shift_schedules: same posture
drop policy if exists shift_schedules_select on public.shift_schedules;
create policy shift_schedules_select on public.shift_schedules for select
  using (is_admin() or user_id = auth.uid());
drop policy if exists shift_schedules_write on public.shift_schedules;
create policy shift_schedules_write on public.shift_schedules for all
  using (is_admin()) with check (is_admin());

-- shift_sessions: self/admin read; user can start own, admin can do anything
drop policy if exists shift_sessions_select on public.shift_sessions;
create policy shift_sessions_select on public.shift_sessions for select
  using (is_admin() or user_id = auth.uid());
drop policy if exists shift_sessions_insert on public.shift_sessions;
create policy shift_sessions_insert on public.shift_sessions for insert
  with check (is_admin() or (user_id = auth.uid() and is_active_user()));
drop policy if exists shift_sessions_update on public.shift_sessions;
create policy shift_sessions_update on public.shift_sessions for update
  using (is_admin() or user_id = auth.uid())
  with check (is_admin() or user_id = auth.uid());
drop policy if exists shift_sessions_delete on public.shift_sessions;
create policy shift_sessions_delete on public.shift_sessions for delete
  using (is_admin());

-- shift_events: append-only — self/admin read, self/admin insert, NO update/delete
drop policy if exists shift_events_select on public.shift_events;
create policy shift_events_select on public.shift_events for select
  using (is_admin() or user_id = auth.uid());
drop policy if exists shift_events_insert on public.shift_events;
create policy shift_events_insert on public.shift_events for insert
  with check (is_admin() or user_id = auth.uid());
-- (no update / delete policies = default deny)

-- bio_break_requests: self insert (when active), admin decide, both can read
drop policy if exists bio_break_requests_select on public.bio_break_requests;
create policy bio_break_requests_select on public.bio_break_requests for select
  using (is_admin() or user_id = auth.uid());
drop policy if exists bio_break_requests_insert on public.bio_break_requests;
create policy bio_break_requests_insert on public.bio_break_requests for insert
  with check (user_id = auth.uid() and is_active_user());
drop policy if exists bio_break_requests_update on public.bio_break_requests;
create policy bio_break_requests_update on public.bio_break_requests for update
  using (is_admin()) with check (is_admin());

-- ---------- SEED — managers only (active, non-admin) ----------------
-- 14 active managers expected; on conflict do nothing makes this rerun-safe
-- and a no-op for users already seeded.
insert into public.shift_configs (user_id)
select id from public.users
 where role = 'manager' and status = 'active' and is_super_admin = false
on conflict (user_id) do nothing;

-- Mon-Sat enabled 8h, Sun disabled (Postgres DOW: 0=Sunday)
insert into public.shift_schedules (user_id, weekday, enabled, required_seconds)
select u.id, gs.wd,
       case when gs.wd = 0 then false else true end as enabled,
       28800 as required_seconds
  from public.users u
  cross join generate_series(0, 6) as gs(wd)
 where u.role = 'manager' and u.status = 'active' and u.is_super_admin = false
on conflict (user_id, weekday) do nothing;

-- =====================================================================
-- SECURITY DEFINER RPCs
-- =====================================================================

-- period_seconds derived from mode
create or replace function public._shift_period_seconds(p_mode text) returns int
  language sql immutable set search_path to 'public' as $$
    select case p_mode
      when 'easy'   then 14400
      when 'medium' then 10800
      when 'hard'   then 3600
    end;
$$;

-- ---- shift_get_or_create_today_session ------------------------------
-- Returns today's shift_sessions row (or creates it).
-- Idempotent under unique (user_id, work_date).
create or replace function public.shift_get_or_create_today_session()
  returns public.shift_sessions
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date;
  v_session public.shift_sessions;
  v_config  public.shift_configs;
  v_sched   public.shift_schedules;
  v_weekday int;
  v_period  int;
  v_required int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not is_active_user() then
    raise exception 'User is not active' using errcode = '42501';
  end if;

  v_today := (now() at time zone 'UTC')::date;

  -- Existing session?
  select * into v_session
    from public.shift_sessions
   where user_id = v_uid and work_date = v_today;
  if found then return v_session; end if;

  -- Need to seed. Snapshot from config + schedule.
  select * into v_config from public.shift_configs where user_id = v_uid;
  if not found then
    insert into public.shift_configs (user_id) values (v_uid)
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

  v_period := public._shift_period_seconds(v_config.mode);

  insert into public.shift_sessions (
    user_id, work_date, status, mode, period_seconds, required_seconds
  ) values (
    v_uid, v_today, 'not_started', v_config.mode, v_period, v_required
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
$$;

-- ---- shift_tick — READ-ONLY -----------------------------------------
-- Returns the live state for the UI countdown. Pure compute over the
-- session row + now(). Breaks do NOT subtract from elapsed (DECISION 1).
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
  v_period_end int;
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
    -- Breaks are NOT subtracted (DECISION 1: breaks are paid).
    --
    -- clock_timestamp() (NOT now()) so the value is the actual wall
    -- clock at this exact instant. now() in Postgres returns the
    -- transaction start time — fine when each tick is its own RPC
    -- transaction (the normal case), but it breaks any test that
    -- calls tick multiple times inside one transaction. Using
    -- clock_timestamp() makes the calculation correct in both modes.
    v_elapsed := greatest(0,
      extract(epoch from (clock_timestamp() - v_s.started_at))::int
      - v_s.paused_total_seconds
      - case when v_s.current_pause_started_at is not null
             then extract(epoch from (clock_timestamp() - v_s.current_pause_started_at))::int
             else 0 end
    );
  end if;

  v_remain     := greatest(0, v_s.required_seconds - v_elapsed);
  v_period_end := (v_s.current_period_index + 1) * v_s.period_seconds;
  v_85_due := v_elapsed >= (v_period_end * 0.85)::int
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
    'current_period_end_seconds',     v_period_end,
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

-- ---- shift_start ----------------------------------------------------
create or replace function public.shift_start()
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions;
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
  update public.shift_sessions
     set status='active', started_at=now(), updated_at=now()
   where id = v_s.id
   returning * into v_s;
  insert into public.shift_events (session_id, user_id, type, by)
    values (v_s.id, v_uid, 'shift_start', v_uid);
  return jsonb_build_object('session_id', v_s.id, 'started_at', v_s.started_at);
end;
$$;

-- ---- shift_take_shift_break (DECISION 1: NO pause) -----------------
create or replace function public.shift_take_shift_break()
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions;
begin
  if v_uid is null or not is_active_user() then
    raise exception 'not active' using errcode='42501';
  end if;
  select * into v_s from public.shift_sessions
   where user_id = v_uid and work_date = (now() at time zone 'UTC')::date
   for update;
  if not found then raise exception 'no session' using errcode='02000'; end if;
  if v_s.status <> 'active' then
    raise exception 'cannot break from %', v_s.status using errcode='22023';
  end if;
  -- DECISION 1: do NOT touch pause fields. Only flip status + log.
  update public.shift_sessions
     set status='on_shift_break', updated_at=now()
   where id = v_s.id;
  insert into public.shift_events (session_id, user_id, type, by)
    values (v_s.id, v_uid, 'shift_break_start', v_uid);
  return jsonb_build_object('session_id', v_s.id, 'status', 'on_shift_break');
end;
$$;

-- ---- shift_take_bio_break (DECISION 1: NO pause; checks bio limit) -
create or replace function public.shift_take_bio_break()
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions; v_cfg public.shift_configs;
begin
  if v_uid is null or not is_active_user() then
    raise exception 'not active' using errcode='42501';
  end if;
  select * into v_s from public.shift_sessions
   where user_id = v_uid and work_date = (now() at time zone 'UTC')::date
   for update;
  if not found then raise exception 'no session' using errcode='02000'; end if;
  if v_s.status <> 'active' then
    raise exception 'cannot bio-break from %', v_s.status using errcode='22023';
  end if;
  select * into v_cfg from public.shift_configs where user_id = v_uid;
  if v_s.bio_break_count_today >= v_cfg.bio_break_max_per_day then
    raise exception 'bio break limit reached; request admin approval' using errcode='22023';
  end if;
  -- DECISION 1: do NOT touch pause fields.
  update public.shift_sessions
     set status='on_bio_break', updated_at=now()
   where id = v_s.id;
  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_uid, 'bio_break_start', v_uid,
            jsonb_build_object('count_so_far', v_s.bio_break_count_today));
  return jsonb_build_object('session_id', v_s.id, 'status', 'on_bio_break');
end;
$$;

-- ---- shift_end_break (DECISION 1: NO unpause math) -----------------
-- For bio breaks, caps duration at bio_break_max_seconds_each (auto-end at 15min)
-- and increments the daily counters.
create or replace function public.shift_end_break()
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_s public.shift_sessions;
  v_cfg public.shift_configs;
  v_start timestamptz;
  v_dur int;
  v_auto boolean := false;
  v_was_bio boolean;
begin
  if v_uid is null or not is_active_user() then
    raise exception 'not active' using errcode='42501';
  end if;
  select * into v_s from public.shift_sessions
   where user_id = v_uid and work_date = (now() at time zone 'UTC')::date
   for update;
  if not found then raise exception 'no session' using errcode='02000'; end if;
  if v_s.status not in ('on_shift_break','on_bio_break') then
    raise exception 'not on break' using errcode='22023';
  end if;
  v_was_bio := (v_s.status = 'on_bio_break');

  if v_was_bio then
    select at into v_start from public.shift_events
     where session_id = v_s.id and type = 'bio_break_start'
     order by at desc limit 1;
    -- clock_timestamp() not now() — see shift_tick comment.
    v_dur := greatest(0, extract(epoch from (clock_timestamp() - v_start))::int);
    select * into v_cfg from public.shift_configs where user_id = v_uid;
    if v_dur > v_cfg.bio_break_max_seconds_each then
      v_dur := v_cfg.bio_break_max_seconds_each;
      v_auto := true;
    end if;
    -- DECISION 1: no pause math. Just bump counters + close break.
    update public.shift_sessions
       set status='active',
           bio_break_count_today          = bio_break_count_today + 1,
           bio_break_total_seconds_today  = bio_break_total_seconds_today + v_dur,
           updated_at = now()
     where id = v_s.id;
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (v_s.id, v_uid,
              case when v_auto then 'bio_break_auto_end' else 'bio_break_end' end,
              v_uid, jsonb_build_object('duration_seconds', v_dur));
  else
    select at into v_start from public.shift_events
     where session_id = v_s.id and type = 'shift_break_start'
     order by at desc limit 1;
    v_dur := greatest(0, extract(epoch from (clock_timestamp() - v_start))::int);
    update public.shift_sessions
       set status='active', updated_at = now()
     where id = v_s.id;
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (v_s.id, v_uid, 'shift_break_end', v_uid,
              jsonb_build_object('duration_seconds', v_dur));
  end if;

  return jsonb_build_object('session_id', v_s.id, 'status', 'active', 'auto_ended', v_auto, 'duration_seconds', v_dur);
end;
$$;

-- ---- shift_admin_lock(session_id, reason) ---------------------------
-- Period locks pause the countdown (paused_total_seconds is the
-- mechanism — see shift_tick).
create or replace function public.shift_admin_lock(p_session_id uuid, p_reason text)
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  if p_reason not in ('period_lock','shift_complete','admin','bio_request') then
    raise exception 'invalid lock reason' using errcode='22023';
  end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.status = 'locked' then
    raise exception 'already locked' using errcode='22023';
  end if;
  update public.shift_sessions
     set status='locked',
         current_pause_started_at = now(),
         current_pause_reason = case when p_reason='admin' then 'admin' else 'period_lock' end,
         locked_at = now(),
         locked_reason = p_reason,
         locked_by = case when p_reason='admin' then v_uid else null end,
         updated_at = now()
   where id = p_session_id;
  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_s.user_id, 'period_lock', v_uid, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('session_id', v_s.id, 'status', 'locked');
end;
$$;

-- ---- shift_admin_unlock(session_id) ---------------------------------
-- Resumes timer: adds the pause duration to paused_total_seconds and,
-- if the lock was a period_lock, advances current_period_index.
create or replace function public.shift_admin_unlock(p_session_id uuid)
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
            jsonb_build_object('pause_seconds', v_dur, 'was_period_lock', v_was_period));
  return jsonb_build_object('session_id', v_s.id, 'status', 'active');
end;
$$;

-- ---- shift_admin_rearm(session_id) — "play again" -------------------
-- Resets the timer to a fresh state. Started_at = now(), all pause /
-- period / lock / bio counters cleared.
create or replace function public.shift_admin_rearm(p_session_id uuid)
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  select * into v_s from public.shift_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  update public.shift_sessions
     set status='active',
         started_at = now(),
         paused_total_seconds = 0,
         current_pause_started_at = null,
         current_pause_reason = null,
         current_period_index = 0,
         period_85_last_index_alerted = -1,
         locked_at = null,
         locked_reason = null,
         locked_by = null,
         bio_break_count_today = 0,
         bio_break_total_seconds_today = 0,
         completed_at = null,
         updated_at = now()
   where id = p_session_id;
  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_s.user_id, 'admin_override', v_uid, '{"action":"rearm"}'::jsonb);
  return jsonb_build_object('session_id', v_s.id, 'status', 'active');
end;
$$;

-- ---- bio_break_request_create ---------------------------------------
create or replace function public.bio_break_request_create()
  returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_s public.shift_sessions; v_id uuid;
begin
  if v_uid is null or not is_active_user() then
    raise exception 'not active' using errcode='42501';
  end if;
  select * into v_s from public.shift_sessions
   where user_id = v_uid and work_date = (now() at time zone 'UTC')::date;
  if not found then raise exception 'no session' using errcode='02000'; end if;
  if v_s.status not in ('active','on_bio_break','on_shift_break') then
    raise exception 'cannot request now' using errcode='22023';
  end if;
  insert into public.bio_break_requests (session_id, user_id)
    values (v_s.id, v_uid)
    returning id into v_id;
  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_uid, 'bio_break_request', v_uid, jsonb_build_object('request_id', v_id));
  return jsonb_build_object('request_id', v_id, 'status', 'pending');
end;
$$;

-- ---- bio_break_request_decide(request_id, decision, note?) ----------
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
  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_req.session_id, v_req.user_id, 'bio_break_request_decided', v_uid,
            jsonb_build_object('request_id', p_request_id, 'decision', p_decision));
  return jsonb_build_object('request_id', p_request_id, 'status', p_decision);
end;
$$;

-- ---- admin_close_orphaned_shifts ------------------------------------
-- Closes any session whose work_date is older than today and still in a
-- live state. Emits a shift_event noting auto-close. Returns the count.
create or replace function public.admin_close_orphaned_shifts()
  returns int language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_count int := 0; r record;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  for r in
    select id, user_id from public.shift_sessions
     where work_date < (now() at time zone 'UTC')::date
       and status in ('active','on_shift_break','on_bio_break','locked')
     for update
  loop
    update public.shift_sessions
       set status='completed', completed_at=now(), updated_at=now()
     where id = r.id;
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (r.id, r.user_id, 'admin_override', v_uid,
              '{"action":"auto_close_orphaned"}'::jsonb);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------- GRANTS ---------------------------------------------------
-- Allow logged-in users to invoke the RPCs (RLS + the is_admin() checks
-- inside each function are the actual gates).
grant execute on function public.shift_get_or_create_today_session()         to authenticated;
grant execute on function public.shift_tick(uuid)                            to authenticated;
grant execute on function public.shift_start()                               to authenticated;
grant execute on function public.shift_take_shift_break()                    to authenticated;
grant execute on function public.shift_take_bio_break()                      to authenticated;
grant execute on function public.shift_end_break()                           to authenticated;
grant execute on function public.shift_admin_lock(uuid, text)                to authenticated;
grant execute on function public.shift_admin_unlock(uuid)                    to authenticated;
grant execute on function public.shift_admin_rearm(uuid)                     to authenticated;
grant execute on function public.bio_break_request_create()                  to authenticated;
grant execute on function public.bio_break_request_decide(uuid, text, text)  to authenticated;
grant execute on function public.admin_close_orphaned_shifts()               to authenticated;
