-- =====================================================================
-- 0073 — Server-side admin alerts from the per-minute cron sweep.
--
-- Extends shift_break_sweep() (0071) so when the cron is the one that
-- LOCKS a session for break overstay, it ALSO:
--   • inserts an in-app admin notification (the bell/box surfaced by
--     0070's notification watcher).
--   • fires the once-only critical email via the existing
--     /api/shift-alert-email Vercel function, guarded by
--     shift_mark_overstay_lock_emailed() so client + cron can't double-send.
--
-- ALSO adds a BIO-6 pass: when any session's bio_break_count_today crosses
-- 6, every admin gets one in-app notification, once per user per day.
-- The "once per day" guard is a new column bio6_notified_at that starts
-- NULL on each fresh daily session row (shift_get_or_create_today_session
-- creates a new row per work_date).
--
-- DATA RULES respected:
--   • Additive only — ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE on the
--     sweep, DROP+ADD CHECK with the same values + one new one.
--   • Single-table writes by exact id, FOR UPDATE locking.
--   • Never touches bio/shift break counts, started_at, or any other
--     timer field — preserves the Step 4 rule.
--   • The freeze pass and the original lock UPDATE/event logic from 0071
--     are byte-for-byte preserved.
-- =====================================================================
begin;

-- 1. Add the bio-6 notify flag (NULL until the cron has notified for
-- today). Fresh daily session rows start NULL automatically.
alter table public.shift_sessions
  add column if not exists bio6_notified_at timestamptz null;

comment on column public.shift_sessions.bio6_notified_at is
  'Set the first time the daily cron sweep notifies admins that this user crossed 6 bio breaks today. NULL means we have NOT notified yet. Resets naturally to NULL when shift_get_or_create_today_session inserts the next-day row.';

-- 2. Widen notifications.type CHECK to add the system/admin alert type.
-- Existing allowed values are preserved verbatim; one new value added.
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array[
    'mention','comment','assigned','status_changed','due_date','task_updated',
    'shift_admin_alert'
  ]));

-- 3. Private config schema for the cron's shared secret + (optional)
-- base URL override. NEVER readable by anon / authenticated — only the
-- postgres role (which owns + runs the SECURITY DEFINER sweep) can read.
create schema if not exists private;
create table if not exists private.config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
revoke all on schema private from public, anon, authenticated;
revoke all on table private.config from public, anon, authenticated;

comment on table private.config is
  'Private key/value config readable only by the postgres role (used by SECURITY DEFINER cron functions). Keys: cron_shared_secret (matches Vercel env CRON_SHARED_SECRET); app_base_url (optional override, defaults to https://p-m-system.vercel.app).';

-- 4. Extended shift_break_sweep().
-- The freeze pass and the lock UPDATE + event inserts are PRESERVED
-- byte-for-byte from the 0071 body. Only ADDITIONS:
--   (a) After each lock UPDATE: insert one notification row per active
--       admin (recipient_id=admin, actor_id=manager, type='shift_admin_alert').
--   (b) After each lock: call shift_mark_overstay_lock_emailed(); if it
--       transitions NULL→now, POST to /api/shift-alert-email via pg_net
--       (only when private.config has cron_shared_secret; otherwise log
--       a shift_event so the gap is visible).
--   (c) A new PASS 3 — BIO-6: insert one admin notification per active
--       admin for every session past 6 bio breaks today, and flip
--       bio6_notified_at to now() so the next sweep is a no-op.
-- Returns expanded jsonb: frozen_count, locked_count, emailed_count,
-- bio6_notified_count.
create or replace function public.shift_break_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_rec record;
  -- preserved
  v_allowance int;
  v_grace int;
  v_break_elapsed int;
  v_freeze_dur int;
  v_recorded int;
  v_frozen_count int := 0;
  v_locked_count int := 0;
  -- 0073 additions
  v_emailed_count int := 0;
  v_bio6_count int := 0;
  v_secret text;
  v_url text;
  v_email_mark jsonb;
  v_today_utc date := (v_now at time zone 'UTC')::date;
begin
  -- Resolve config (missing secret/url is non-fatal — email simply skipped).
  select value into v_secret from private.config where key='cron_shared_secret';
  select value into v_url    from private.config where key='app_base_url';
  if v_url is null then v_url := 'https://p-m-system.vercel.app'; end if;

  -- ============ PASS 1 — LOCK (preserved from 0071) ============
  for v_rec in
    select s.id,
           s.user_id,
           s.paused_total_seconds,
           s.current_break_started_at,
           s.current_pause_started_at,
           s.current_pause_reason,
           coalesce(c.shift_break_seconds, 1800) as allowance,
           coalesce(c.shift_break_overstay_grace_seconds, 900) as grace
      from public.shift_sessions s
      join public.shift_configs c on c.user_id = s.user_id
     where s.status = 'on_shift_break'
       and s.current_break_kind = 'shift'
       and s.current_break_started_at is not null
       and greatest(0, extract(epoch from (v_now - s.current_break_started_at))::int)
           >= coalesce(c.shift_break_seconds, 1800) + coalesce(c.shift_break_overstay_grace_seconds, 900)
     for update of s
  loop
    v_allowance := v_rec.allowance;
    v_grace     := v_rec.grace;
    v_break_elapsed := greatest(0,
      extract(epoch from (v_now - v_rec.current_break_started_at))::int);
    v_freeze_dur := case
      when v_rec.current_pause_reason = 'break_overstay'
       and v_rec.current_pause_started_at is not null
      then greatest(0, extract(epoch from (v_now - v_rec.current_pause_started_at))::int)
      else 0
    end;
    v_recorded := least(v_break_elapsed, v_allowance);

    update public.shift_sessions set
      status                   = 'locked',
      current_break_started_at = null,
      current_break_kind       = null,
      paused_total_seconds     = paused_total_seconds + v_freeze_dur,
      current_pause_started_at = v_now,
      current_pause_reason     = 'break_overstay',
      locked_at                = v_now,
      locked_reason            = 'break_overstay',
      locked_by                = null,
      updated_at               = v_now
     where id = v_rec.id;

    insert into public.shift_events (session_id, user_id, type, by, meta) values
      (v_rec.id, v_rec.user_id, 'shift_break_end', null,
        jsonb_build_object(
          'duration_seconds_actual',   v_break_elapsed,
          'duration_seconds_recorded', v_recorded,
          'overstay_seconds',          greatest(0, v_break_elapsed - v_allowance),
          'frozen_seconds_credited',   v_freeze_dur,
          'allowance_seconds',         v_allowance,
          'ended_by',                  'overstay_lock_sweep',
          'sweep',                     true)),
      (v_rec.id, v_rec.user_id, 'shift_break_overstay_lock', null,
        jsonb_build_object(
          'break_elapsed_seconds',   v_break_elapsed,
          'allowance_seconds',       v_allowance,
          'grace_seconds',           v_grace,
          'frozen_seconds_credited', v_freeze_dur,
          'sweep',                   true));

    v_locked_count := v_locked_count + 1;

    -- 0073 — admin in-app notifications for the lock. One row per
    -- active admin. recipient_id=admin so each admin sees their own;
    -- actor_id=the locked manager.
    insert into public.notifications
      (recipient_id, actor_id, type, board_id, item_id, update_id, is_read)
      select u.id, v_rec.user_id, 'shift_admin_alert', null, null, null, false
        from public.users u
       where u.status='active' and (u.role='admin' or u.is_super_admin=true);

    -- 0073 — once-only critical email via the existing /api/shift-alert-email
    -- function. Guard with shift_mark_overstay_lock_emailed so the client
    -- path and the cron path can't both fire (DB-level NULL → now() lock).
    select public.shift_mark_overstay_lock_emailed(v_rec.id) into v_email_mark;
    if coalesce((v_email_mark->>'emailed_now')::boolean, false) then
      v_emailed_count := v_emailed_count + 1;
      -- Skip the HTTP if the secret isn't configured yet — leaves an
      -- admin_override event so the gap is visible. The notification is
      -- still inserted above, so admins still get pinged in-app.
      if v_secret is not null and v_secret <> '' then
        begin
          perform net.http_post(
            url     := v_url || '/api/shift-alert-email',
            body    := jsonb_build_object(
                         'session_id', v_rec.id::text,
                         'kind',       'break_overstay_lock'),
            headers := jsonb_build_object(
                         'Content-Type',  'application/json',
                         'X-Cron-Secret', v_secret),
            timeout_milliseconds := 5000
          );
        exception when others then
          insert into public.shift_events (session_id, user_id, type, by, meta) values
            (v_rec.id, v_rec.user_id, 'admin_override', null,
              jsonb_build_object('action', 'sweep_email_http_post_failed',
                                 'sweep', true,
                                 'sqlerrm', sqlerrm));
        end;
      else
        insert into public.shift_events (session_id, user_id, type, by, meta) values
          (v_rec.id, v_rec.user_id, 'admin_override', null,
            jsonb_build_object('action', 'sweep_email_skipped_no_secret',
                               'sweep', true));
      end if;
    end if;
  end loop;

  -- ============ PASS 2 — FREEZE (preserved from 0071) ============
  for v_rec in
    select s.id,
           s.user_id,
           s.current_break_started_at,
           coalesce(c.shift_break_seconds, 1800) as allowance
      from public.shift_sessions s
      join public.shift_configs c on c.user_id = s.user_id
     where s.status = 'on_shift_break'
       and s.current_break_kind = 'shift'
       and s.current_break_started_at is not null
       and s.current_pause_started_at is null
       and greatest(0, extract(epoch from (v_now - s.current_break_started_at))::int)
           >= coalesce(c.shift_break_seconds, 1800)
     for update of s
  loop
    v_allowance := v_rec.allowance;
    v_break_elapsed := greatest(0,
      extract(epoch from (v_now - v_rec.current_break_started_at))::int);

    update public.shift_sessions set
      current_pause_started_at = v_now,
      current_pause_reason     = 'break_overstay',
      updated_at               = v_now
     where id = v_rec.id;

    insert into public.shift_events (session_id, user_id, type, by, meta) values
      (v_rec.id, v_rec.user_id, 'shift_break_overstay_freeze', null,
        jsonb_build_object(
          'break_elapsed_seconds', v_break_elapsed,
          'allowance_seconds',     v_allowance,
          'sweep',                 true));

    v_frozen_count := v_frozen_count + 1;
  end loop;

  -- ============ PASS 3 — BIO-6 ADMIN ALERT (NEW in 0073) ============
  -- For every TODAY session with >=6 bio breaks AND not yet notified,
  -- insert one admin notification per active admin and flip the flag.
  for v_rec in
    select s.id, s.user_id
      from public.shift_sessions s
     where s.bio_break_count_today >= 6
       and s.bio6_notified_at is null
       and s.work_date = v_today_utc
     for update of s
  loop
    insert into public.notifications
      (recipient_id, actor_id, type, board_id, item_id, update_id, is_read)
      select u.id, v_rec.user_id, 'shift_admin_alert', null, null, null, false
        from public.users u
       where u.status='active' and (u.role='admin' or u.is_super_admin=true);
    update public.shift_sessions set bio6_notified_at = v_now where id = v_rec.id;
    v_bio6_count := v_bio6_count + 1;
  end loop;

  return jsonb_build_object(
    'frozen_count',        v_frozen_count,
    'locked_count',        v_locked_count,
    'emailed_count',       v_emailed_count,
    'bio6_notified_count', v_bio6_count,
    'ran_at',              v_now
  );
end;
$function$;

revoke all on function public.shift_break_sweep() from public, anon, authenticated;
grant execute on function public.shift_break_sweep() to postgres;

commit;
