-- =====================================================================
-- 0070 — Step 4c: once-only email guard for the shift-break overstay lock.
--
-- The break-overstay lock RPC (0069) is already idempotent at the
-- session-state level. This migration adds a separate IDempotency
-- guard SPECIFICALLY for the email side-effect, so even if the client
-- effect re-runs (poll cycle, hot-reload, etc.) the email is delivered
-- EXACTLY ONCE per lock.
--
-- DATA RULES respected:
--   • Additive only — ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.
--   • No CASCADE / no DROP of tables.
--   • Single-table writes by exact session id.
--   • answers / boards untouched.
-- =====================================================================
begin;

-- 1. Mark column. NULL until the client successfully transitions
--    NULL → now() through shift_mark_overstay_lock_emailed.
alter table public.shift_sessions
  add column if not exists overstay_lock_email_sent_at timestamptz null;

comment on column public.shift_sessions.overstay_lock_email_sent_at is
  'Set the instant the client successfully sends the once-only break-overstay-lock email. NULL means the email has not been sent yet. Mark transition NULL → now() is gated by shift_mark_overstay_lock_emailed under status=locked AND locked_reason=break_overstay.';

-- 2. shift_break_overstay_lock — preserve the LIVE body byte-for-byte.
-- The lock logic stays unchanged; email is sent from the client guarded
-- by the new RPC below, NOT from this function. We re-emit it so this
-- migration captures the canonical body alongside the guard column.
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

  if v_s.status = 'on_shift_break'
     and v_s.current_break_kind = 'shift'
     and v_s.current_break_started_at is not null then
    select * into v_cfg from public.shift_configs where user_id = v_s.user_id;
    v_allowance := coalesce(v_cfg.shift_break_seconds, 1800);
    v_grace     := coalesce(v_cfg.shift_break_overstay_grace_seconds, 900);
    v_break_elapsed := greatest(0,
      extract(epoch from (v_now - v_s.current_break_started_at))::int);
    if v_break_elapsed >= v_allowance + v_grace then
      if v_s.current_pause_reason = 'break_overstay'
         and v_s.current_pause_started_at is not null then
        v_freeze_dur := greatest(0,
          extract(epoch from (v_now - v_s.current_pause_started_at))::int);
      end if;
      v_recorded := least(v_break_elapsed, v_allowance);
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

-- 3. NEW RPC — shift_mark_overstay_lock_emailed(p_session_id uuid).
-- Atomic NULL→now() transition gated by status='locked' AND
-- locked_reason='break_overstay'. The conditional UPDATE + ROW_COUNT
-- check means only the FIRST caller sees emailed_now=true; subsequent
-- callers and any other state return emailed_now=false. No exception
-- on the "already sent" path — it's a query, not an error.
create or replace function public.shift_mark_overstay_lock_emailed(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_s   public.shift_sessions;
  v_rows int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  -- Self/admin gate. We read the session to enforce authz, then issue
  -- the conditional UPDATE that's the actual guard.
  select * into v_s from public.shift_sessions where id = p_session_id;
  if not found then raise exception 'session not found' using errcode='02000'; end if;
  if v_s.user_id <> v_uid and not is_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  update public.shift_sessions
     set overstay_lock_email_sent_at = clock_timestamp(),
         updated_at                  = now()
   where id = p_session_id
     and status                       = 'locked'
     and locked_reason                = 'break_overstay'
     and overstay_lock_email_sent_at is null;
  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'session_id',  v_s.id,
    'emailed_now', (v_rows = 1)
  );
end;
$function$;

-- 4. Grants.
revoke all on function public.shift_break_overstay_lock(uuid)              from public, anon;
grant execute on function public.shift_break_overstay_lock(uuid)           to authenticated;
revoke all on function public.shift_mark_overstay_lock_emailed(uuid)       from public, anon;
grant execute on function public.shift_mark_overstay_lock_emailed(uuid)    to authenticated;

commit;
