-- =====================================================================
-- 0074 — Allow server/cron context to call shift_mark_overstay_lock_emailed.
--
-- Bug: 0073 extended the per-minute shift_break_sweep() to call
-- shift_mark_overstay_lock_emailed() after each lock (so the cron path
-- could fire the once-only email). But the live 0070 body of that RPC
-- raises 'not authenticated' (42501) when auth.uid() IS NULL — written
-- for the user-JWT/client path. pg_cron runs with no JWT, so auth.uid()
-- returns NULL, so every cron tick that finds a lock-eligible session
-- crashes the whole sweep transaction (no auto-lock fires for offline
-- users).
--
-- Confirmed live in cron.job_run_details runid=25 (08:10) and 26 (08:11),
-- both status=failed with:
--   ERROR: not authenticated
--   CONTEXT: PL/pgSQL function shift_mark_overstay_lock_emailed(uuid) line 7
--   SQL statement "select public.shift_mark_overstay_lock_emailed(v_rec.id)"
--   PL/pgSQL function shift_break_sweep() line 102
--
-- Fix scope: SMALLEST possible — only the auth gate of
-- shift_mark_overstay_lock_emailed. The atomic once-only conditional
-- UPDATE and the {emailed_now} return are byte-for-byte preserved. The
-- v_uid IS NOT NULL branch (existing user-path: self/admin check)
-- is preserved byte-for-byte from the live 0070 body. Only the
-- v_uid IS NULL branch is ADDED — it's the trusted server/cron path
-- (the function is SECURITY DEFINER owned by postgres, and the sweep
-- itself is server-only via revoked grants).
--
-- The RPC's grants are NOT widened. It remains:
--   • REVOKED from public, anon.
--   • GRANTED EXECUTE to authenticated (existing client path).
--   • Implicitly callable by postgres as the function owner (sweep path).
-- No new caller gains access.
--
-- DATA RULES respected:
--   • Single CREATE OR REPLACE on one function.
--   • No table/column changes.
--   • No CASCADE / no DROP.
--   • No grant widening (grants re-applied exactly as 0070 set them).
-- =====================================================================
begin;

create or replace function public.shift_mark_overstay_lock_emailed(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_s    public.shift_sessions;
  v_rows int;
  v_sid  uuid;
begin
  if v_uid is null then
    -- Server/cron path (trusted): no JWT means we're being invoked from
    -- the SECURITY DEFINER sweep (shift_break_sweep), which runs as the
    -- postgres owner. There is NO widening of access here — the only
    -- non-user caller is the sweep, which is itself server-only. The
    -- atomic conditional UPDATE below is the actual once-only guard,
    -- gated on (status='locked' AND locked_reason='break_overstay' AND
    -- overstay_lock_email_sent_at IS NULL). If the session doesn't
    -- exist or isn't in that state, the UPDATE affects 0 rows and
    -- emailed_now returns false naturally.
    v_sid := p_session_id;
  else
    -- User path: preserve the LIVE 0070 self/admin authz byte-for-byte.
    select * into v_s from public.shift_sessions where id = p_session_id;
    if not found then raise exception 'session not found' using errcode='02000'; end if;
    if v_s.user_id <> v_uid and not is_admin() then
      raise exception 'forbidden' using errcode='42501';
    end if;
    v_sid := v_s.id;
  end if;

  -- Atomic NULL → now() transition. Identical to the live 0070 UPDATE.
  update public.shift_sessions
     set overstay_lock_email_sent_at = clock_timestamp(),
         updated_at                  = now()
   where id = p_session_id
     and status                       = 'locked'
     and locked_reason                = 'break_overstay'
     and overstay_lock_email_sent_at is null;
  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'session_id',  v_sid,
    'emailed_now', (v_rows = 1)
  );
end;
$function$;

-- Grants — re-applied exactly as 0070 set them. No widening.
revoke all on function public.shift_mark_overstay_lock_emailed(uuid) from public, anon;
grant execute on function public.shift_mark_overstay_lock_emailed(uuid) to authenticated;

commit;
