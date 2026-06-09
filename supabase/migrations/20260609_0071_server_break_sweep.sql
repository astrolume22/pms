-- =====================================================================
-- 0071 — Server-side sweep: freeze + lock overstayed shift breaks even
-- when the manager is offline / tab closed.
--
-- Until now, the freeze (0068) and lock (0069) RPCs are CLIENT-fired
-- from BreakControls.tsx, so an offline user never gets locked. This
-- migration adds shift_break_sweep() which replicates those two
-- transitions across ALL eligible sessions in one server-internal
-- call, intended to run every minute from pg_cron.
--
-- The per-session client-fired RPCs stay in place (they give instant
-- in-app feedback when the user is online); this sweep is the
-- belt-and-suspenders safety net.
--
-- DATA RULES respected:
--   • Additive only — CREATE OR REPLACE on one new function, no
--     DROP of tables / FKs / columns / existing functions.
--   • Single-table writes by exact session id, FOR UPDATE locking.
--   • answers / boards untouched.
--   • bio_break_count_today / shift_break_count_today / started_at
--     are NEVER touched by the sweep (per the Step 4 rule that only
--     the explicit Re-arm button resets counts/timer).
-- =====================================================================
begin;

-- =====================================================================
-- shift_break_sweep() — runs every minute from pg_cron.
--
-- Pass order matters:
--   1. LOCK pass first. Catches every session past allowance+grace.
--      Replicates 0069's lock transition byte-for-byte (same UPDATE,
--      same two events, same meta keys) WITHOUT the auth.uid/self
--      gate. v_freeze_dur is 0 when the session was never frozen
--      (e.g. it crossed both thresholds inside one cron minute) —
--      same branch the live 0069 RPC uses, so this is consistent.
--   2. FREEZE pass second. Catches any remaining sessions whose
--      break_elapsed crossed allowance but not allowance+grace. Sessions
--      already locked by pass 1 are skipped by the gate (status check).
--      Replicates 0068's freeze UPDATE byte-for-byte.
--
-- Idempotency:
--   • LOCK gate filters status='on_shift_break' → already-locked rows
--     are skipped (the prior sweep set them to 'locked').
--   • FREEZE gate filters status='on_shift_break' AND
--     current_pause_started_at IS NULL → already-frozen rows are
--     skipped.
--   • A sweep with no eligible rows updates nothing, inserts nothing,
--     returns {frozen_count:0, locked_count:0}.
--
-- Authorization model:
--   • SECURITY DEFINER (runs as the function owner — postgres in
--     Supabase — so it bypasses RLS even on the cron user).
--   • No auth.uid() reference. This is a server/cron function, not
--     a user-callable RPC. The per-user freeze/lock RPCs (0068/0069)
--     keep their auth gate for the client path.
--   • Granted only to postgres (cron runs as the scheduling user;
--     in Supabase that's postgres). Revoked from public/anon/
--     authenticated — regular users cannot bulk-lock other users.
--
-- Event audit trail:
--   • by = NULL (cron has no user actor).
--   • meta.sweep = true so admins can distinguish server-initiated
--     transitions from the client-fired ones (which set by=v_uid).
--   • shift_break_end uses ended_by='overstay_lock_sweep' (mirrors
--     0069's ended_by='overstay_lock' for the client path).
-- =====================================================================
create or replace function public.shift_break_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_rec record;
  v_allowance int;
  v_grace int;
  v_break_elapsed int;
  v_freeze_dur int;
  v_recorded int;
  v_frozen_count int := 0;
  v_locked_count int := 0;
begin
  -- ============ PASS 1 — LOCK ============
  -- Sessions past allowance + grace. We loop with FOR UPDATE so two
  -- overlapping sweep invocations can't double-lock the same row.
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
    -- Mirror 0069's freeze-dur branch: 0 when the session was never
    -- frozen (no open break_overstay pause), else the open pause's
    -- elapsed.
    v_freeze_dur := case
      when v_rec.current_pause_reason = 'break_overstay'
       and v_rec.current_pause_started_at is not null
      then greatest(0, extract(epoch from (v_now - v_rec.current_pause_started_at))::int)
      else 0
    end;
    -- Cap recorded shift-break duration at the allowance — the
    -- overstay must NOT count as paid break.
    v_recorded := least(v_break_elapsed, v_allowance);

    -- One UPDATE — byte-for-byte the 0069 transition. Continuous
    -- freeze: pause closes (credited above) AND a new break_overstay
    -- pause opens AT THE SAME INSTANT (v_now), so no paid time leaks.
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

    -- shift_break_end + shift_break_overstay_lock events.
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
  end loop;

  -- ============ PASS 2 — FREEZE ============
  -- Sessions whose break_elapsed crossed allowance but NOT
  -- allowance+grace, AND still have no open pause. Sessions that
  -- pass 1 just locked are filtered out by the status='on_shift_break'
  -- gate.
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

    -- One UPDATE — byte-for-byte the 0068 freeze transition.
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

  return jsonb_build_object(
    'frozen_count', v_frozen_count,
    'locked_count', v_locked_count,
    'ran_at',       v_now
  );
end;
$function$;

-- Server-only. Users keep using the per-session freeze/lock RPCs
-- (which have auth gates). The sweep is callable by postgres
-- (cron scheduler runs as the user who scheduled it; in Supabase
-- that's the postgres role).
revoke all on function public.shift_break_sweep() from public, anon, authenticated;
-- postgres has EXECUTE by default as the function owner; explicit
-- grant for clarity in case ownership ever changes.
grant execute on function public.shift_break_sweep() to postgres;

-- =====================================================================
-- pg_cron SCHEDULE — currently COMMENTED OUT.
--
-- PHASE 0 check showed pg_cron is NOT installed (only pg_net 0.20.0
-- is present). To enable per-minute server sweeps:
--
--   1. Supabase Dashboard → Database → Extensions → search "pg_cron".
--      Toggle it on. (This requires project-owner permissions; it
--      runs `create extension pg_cron with schema cron;` under the
--      hood.)
--   2. After the toggle, run the cron.schedule() line below from a
--      psql / SQL editor session connected as the postgres role.
--      A 2-line follow-up migration can wrap it.
--
-- Schedule expression: '* * * * *' = every minute. The function is
-- idempotent so a missed minute (or a doubled run during clock drift)
-- is safe.
--
-- The UNschedule call is included so re-running the schedule line is
-- safe (it would otherwise raise "duplicate job name").
-- =====================================================================
--   -- WHEN pg_cron IS INSTALLED, uncomment these two lines:
--   select cron.unschedule(jobid) from cron.job where jobname = 'shift_break_sweep';
--   select cron.schedule(
--     'shift_break_sweep',
--     '* * * * *',
--     $$ select public.shift_break_sweep(); $$
--   );

commit;
