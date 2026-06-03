-- =====================================================================
-- 0061 — 8h auto-complete + cron sweep (Phase 4.8)
-- =====================================================================
-- Two new RPCs:
--   • shift_complete_if_due(session_id)
--       Self-or-admin. Computes work elapsed server-side; if the
--       session's elapsed >= required_seconds AND status is one of
--       (active, on_shift_break, on_bio_break), flips it to 'completed'
--       and stamps completed_at + locked_reason. Emits shift_complete
--       event with worked_seconds + the originating status. Idempotent.
--
--   • shift_sweep_due_and_orphans()
--       Callable by ANY admin OR by the service role (cron). Two passes:
--         1) Sweep TODAY's sessions whose elapsed >= required and are
--            still in a working state — complete them and emit
--            shift_complete with meta.auto_swept = true.
--         2) Close PRIOR-DAY orphans (work_date < current UTC date AND
--            status NOT IN ('completed','not_started')) — complete them
--            and emit admin_override with action='auto_close_orphaned'.
--       Returns counts + the user_ids of newly-completed-today sessions
--       so the cron can email those managers.
--
-- Both RPCs are SECURITY DEFINER, additive, idempotent. No tables
-- changed.
-- =====================================================================

-- ---------- shift_complete_if_due ------------------------------------
create or replace function public.shift_complete_if_due(p_session_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_s       public.shift_sessions;
  v_elapsed int;
  v_was     text;
begin
  -- Self or admin (or service-role / cron-style auth.uid()=NULL).
  if v_uid is null then
    -- Service-role / system caller — proceed.
    null;
  else
    select * into v_s from public.shift_sessions where id = p_session_id for update;
    if not found then raise exception 'session not found' using errcode='02000'; end if;
    if v_s.user_id <> v_uid and not is_admin() then
      raise exception 'forbidden' using errcode='42501';
    end if;
  end if;

  -- Re-fetch for the service-role path so v_s is populated either way.
  if v_uid is null then
    select * into v_s from public.shift_sessions where id = p_session_id for update;
    if not found then raise exception 'session not found' using errcode='02000'; end if;
  end if;

  -- Idempotent: already completed → no-op.
  if v_s.status = 'completed' then
    return jsonb_build_object(
      'session_id',        v_s.id,
      'already_completed', true,
      'completed_at',      v_s.completed_at
    );
  end if;

  -- Compute work elapsed (same formula as shift_tick).
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

  -- Not due yet → return remaining for the caller.
  if v_elapsed < v_s.required_seconds then
    return jsonb_build_object(
      'session_id',        v_s.id,
      'already_completed', false,
      'due',               false,
      'elapsed_seconds',   v_elapsed,
      'remaining_seconds', v_s.required_seconds - v_elapsed
    );
  end if;

  -- Only complete from working states. Locked sessions don't accumulate
  -- elapsed past lock; in the rare case they reach required_seconds
  -- before being locked, admin can unlock first.
  if v_s.status not in ('active','on_shift_break','on_bio_break') then
    return jsonb_build_object(
      'session_id',        v_s.id,
      'already_completed', false,
      'due',               true,
      'completed',         false,
      'reason',            'wrong_status',
      'status',            v_s.status
    );
  end if;

  v_was := v_s.status;

  update public.shift_sessions
     set status        = 'completed',
         completed_at  = now(),
         locked_reason = 'shift_complete',
         -- Clear in-progress break stamps so a tab reload doesn't show a
         -- "still on break" UI on a completed shift.
         current_break_started_at = null,
         current_break_kind       = null,
         updated_at    = now()
   where id = v_s.id;

  insert into public.shift_events (session_id, user_id, type, by, meta)
    values (v_s.id, v_s.user_id, 'shift_complete', v_uid,
            jsonb_build_object(
              'worked_seconds',  v_elapsed,
              'from_status',     v_was,
              'auto_swept',      false
            ));

  return jsonb_build_object(
    'session_id',        v_s.id,
    'already_completed', false,
    'due',               true,
    'completed',         true,
    'worked_seconds',    v_elapsed,
    'from_status',       v_was
  );
end;
$$;

-- ---------- shift_sweep_due_and_orphans ------------------------------
-- Callable by service-role (auth.uid() IS NULL) OR by admins (the
-- founder can also trigger from the admin panel if we surface it).
create or replace function public.shift_sweep_due_and_orphans()
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'UTC')::date;
  v_completed_today uuid[] := '{}';
  v_orphan_user_ids uuid[] := '{}';
  v_orphan_count int := 0;
  v_completed_count int := 0;
  v_elapsed int;
  r record;
begin
  -- Gate: anonymous service role OR authenticated admin.
  if v_uid is not null and not is_admin() then
    raise exception 'admin or service role only' using errcode='42501';
  end if;

  -- PASS 1: today's due sessions.
  for r in
    select * from public.shift_sessions
     where work_date = v_today
       and status in ('active','on_shift_break','on_bio_break')
       and started_at is not null
     for update
  loop
    v_elapsed := greatest(0,
      extract(epoch from (clock_timestamp() - r.started_at))::int
      - r.paused_total_seconds
      - case when r.current_pause_started_at is not null
             then extract(epoch from (clock_timestamp() - r.current_pause_started_at))::int
             else 0 end
    );
    if v_elapsed >= r.required_seconds then
      update public.shift_sessions
         set status        = 'completed',
             completed_at  = now(),
             locked_reason = 'shift_complete',
             current_break_started_at = null,
             current_break_kind       = null,
             updated_at    = now()
       where id = r.id;
      insert into public.shift_events (session_id, user_id, type, by, meta)
        values (r.id, r.user_id, 'shift_complete', v_uid,
                jsonb_build_object(
                  'worked_seconds', v_elapsed,
                  'from_status',    r.status,
                  'auto_swept',     true
                ));
      v_completed_today := array_append(v_completed_today, r.user_id);
      v_completed_count := v_completed_count + 1;
    end if;
  end loop;

  -- PASS 2: prior-day orphans (anything not completed from a previous
  -- work_date). Treated as "auto-closed" via admin_override.
  for r in
    select * from public.shift_sessions
     where work_date < v_today
       and status not in ('completed','not_started')
     for update
  loop
    update public.shift_sessions
       set status        = 'completed',
           completed_at  = now(),
           current_break_started_at = null,
           current_break_kind       = null,
           updated_at    = now()
     where id = r.id;
    insert into public.shift_events (session_id, user_id, type, by, meta)
      values (r.id, r.user_id, 'admin_override', v_uid,
              jsonb_build_object('action','auto_close_orphaned','prior_status', r.status));
    v_orphan_user_ids := array_append(v_orphan_user_ids, r.user_id);
    v_orphan_count := v_orphan_count + 1;
  end loop;

  return jsonb_build_object(
    'completed_today_count',     v_completed_count,
    'completed_today_user_ids',  v_completed_today,
    'closed_orphan_count',       v_orphan_count,
    'closed_orphan_user_ids',    v_orphan_user_ids,
    'now',                       clock_timestamp()
  );
end;
$$;

-- ---------- GRANTs ---------------------------------------------------
grant execute on function public.shift_complete_if_due(uuid)      to authenticated;
grant execute on function public.shift_sweep_due_and_orphans()    to authenticated;
