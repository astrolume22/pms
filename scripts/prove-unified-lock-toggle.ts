/**
 * Rollback simulation for the unified admin lock toggle.
 *
 *   (a) row reads checked=true when session is period-locked (account_locked=false)
 *   (b) toggle OFF: shift_admin_unlock + shift_admin_rearm → session active, period_lock_due=false → does NOT instantly re-lock
 *   (c) toggle ON: shift_admin_set_account_lock(user, true) → account_locked=true → shift_start raises 'account locked' (42501)
 *   (d) toggle OFF on account_locked user: cleared → shift_start proceeds normally
 *
 * Everything runs inside a transaction that ROLLS BACK at the end — nothing persists.
 * The auto period-lock trigger (shift_self_period_lock) and the account_locked
 * shift_start guard are READ ONLY here; we only call them, not modify them.
 */
import './loadEnv';
import { Client } from 'pg';

interface TickPayload { status: string; period_lock_due: boolean }

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows: [admin] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users where role='admin' and status='active' limit 1`,
  );
  if (!admin) { console.error('FAIL: no admin user found'); process.exit(1); }
  const { rows: [mgr] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users where role='manager' and status='active' and is_super_admin=false limit 1`,
  );
  if (!mgr) { console.error('FAIL: no test manager found'); process.exit(1); }

  console.log('========== Test users ==========');
  console.log('admin :', admin.username, '(' + admin.id + ')');
  console.log('mgr   :', mgr.username,   '(' + mgr.id   + ')');

  await c.query('begin');
  try {
    // Set jwt claim as admin first while we wipe + seed.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);

    // Clean slate for today.
    await c.query(
      `delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date`,
      [mgr.id],
    );
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgr.id]);
    await c.query(`
      insert into public.shift_configs (
        user_id, mode, shift_break_seconds, bio_break_max_per_day,
        bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
        primary_group_id, timezone, late_start_threshold_seconds, account_locked
      ) values ($1, 'hard', 1800, 7, 4, 1200, 360, null, 'Asia/Manila', 900, false)
    `, [mgr.id]);

    // Start the manager's shift (as the manager).
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [s1] } = await c.query<{ res: { session_id: string; started_at: string } }>(
      `select public.shift_start() as res`,
    );
    const sid = s1.res.session_id;
    console.log('\nseed shift_start →', s1.res);

    // Simulate the auto period-lock landing (as admin, using shift_admin_lock
    // with reason='period_lock' to get the SAME end state shift_self_period_lock produces).
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`select public.shift_admin_lock($1, 'period_lock')`, [sid]);

    // ---------- (a) ----------
    console.log('\n========== (a) row reads checked=true when session period-locked ==========');
    const { rows: [a] } = await c.query<{
      session_status: string | null; account_locked: boolean | null; session_locked_reason: string | null;
    }>(`
      select s.status as session_status, c.account_locked, s.locked_reason as session_locked_reason
        from public.users u
   left join public.shift_configs  c on c.user_id = u.id
   left join public.shift_sessions s on s.user_id = u.id
                                    and s.work_date = (now() at time zone 'UTC')::date
       where u.id = $1
    `, [mgr.id]);
    console.log('  AdminShiftRow fields:', a);
    const checkedA = (a.account_locked ?? false) || a.session_status === 'locked';
    console.log('  unified checked = (account_locked || status===\'locked\') =', checkedA);
    if (!checkedA) throw new Error('(a) FAIL — checked should be true while session is period-locked');
    console.log('  PASS — toggle correctly shows ON for a period-locked session (account_locked=false)');

    // ---------- (b) ----------
    console.log('\n========== (b) toggle OFF: unlock + rearm → does NOT instantly re-lock ==========');
    await c.query(`select public.shift_admin_unlock($1)`, [sid]);
    await c.query(`select public.shift_admin_rearm($1)`,  [sid]);
    const { rows: [b] } = await c.query<{
      status: string; current_period_index: number; paused_total_seconds: number;
      locked_reason: string | null;
    }>(`select status, current_period_index, paused_total_seconds, locked_reason
          from public.shift_sessions where id=$1`, [sid]);
    console.log('  session after unlock+rearm:', b);
    if (b.status !== 'active') throw new Error('(b) FAIL — status should be active');
    if (b.current_period_index !== 0) throw new Error('(b) FAIL — current_period_index should be 0');
    if (b.paused_total_seconds !== 0) throw new Error('(b) FAIL — paused_total_seconds should be 0');
    if (b.locked_reason !== null) throw new Error('(b) FAIL — locked_reason should be null');

    // Fresh tick (as the manager) — confirm period_lock_due=false so the
    // very next ShiftDriver poll does NOT instantly re-fire period_lock.
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [tickRow] } = await c.query<{ tick: TickPayload }>(
      `select public.shift_tick($1) as tick`, [sid],
    );
    console.log('  fresh shift_tick → status=' + tickRow.tick.status + '  period_lock_due=' + tickRow.tick.period_lock_due);
    if (tickRow.tick.status !== 'active') throw new Error('(b) FAIL — tick status should be active');
    if (tickRow.tick.period_lock_due !== false) throw new Error('(b) FAIL — period_lock_due should be false on a fresh clock');
    console.log('  PASS — session unlocked + re-armed; fresh tick does NOT instantly re-lock');

    // ---------- (c) ----------
    console.log('\n========== (c) toggle ON: account_locked=true → shift_start raises 42501 ==========');
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`select public.shift_admin_set_account_lock($1, true)`, [mgr.id]);
    const { rows: [c1] } = await c.query<{ account_locked: boolean }>(
      `select account_locked from public.shift_configs where user_id=$1`, [mgr.id],
    );
    console.log('  account_locked after set →', c1.account_locked);
    if (c1.account_locked !== true) throw new Error('(c) FAIL — account_locked should be true');

    // Wipe today's session so shift_start hits the lock guard cleanly
    // (it raises before the not_started check).
    await c.query(
      `delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date`,
      [mgr.id],
    );

    // Try shift_start as the manager — expect 42501 'account locked'.
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    await c.query('savepoint expect_account_locked');
    let raisedC: string | null = null;
    try { await c.query(`select public.shift_start()`); }
    catch (e) {
      raisedC = (e as Error).message ?? String(e);
      await c.query('rollback to savepoint expect_account_locked');
    }
    await c.query('release savepoint expect_account_locked');
    console.log('  shift_start →', raisedC ?? 'NO EXCEPTION (FAIL)');
    if (!raisedC || !/account locked/i.test(raisedC)) {
      throw new Error('(c) FAIL — expected "account locked" exception, got: ' + raisedC);
    }
    console.log('  PASS — shift_start blocked with 42501 \'account locked\'');

    // ---------- (d) ----------
    console.log('\n========== (d) toggle OFF on account_locked user: shift_start proceeds ==========');
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`select public.shift_admin_set_account_lock($1, false)`, [mgr.id]);
    const { rows: [d1] } = await c.query<{ account_locked: boolean }>(
      `select account_locked from public.shift_configs where user_id=$1`, [mgr.id],
    );
    console.log('  account_locked after clear →', d1.account_locked);
    if (d1.account_locked !== false) throw new Error('(d) FAIL — account_locked should be false');

    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [s2] } = await c.query<{ res: { session_id: string; started_at: string } }>(
      `select public.shift_start() as res`,
    );
    console.log('  shift_start →', s2.res);
    if (!s2.res?.session_id) throw new Error('(d) FAIL — shift_start should have produced a session');
    console.log('  PASS — shift_start proceeded normally after the account unlock');

  } finally {
    await c.query('rollback');
    console.log('\n(simulation transaction rolled back — no data persisted)');
  }

  // ---------- Confirm auto period-lock + account_locked guard sources unchanged ----------
  console.log('\n========== final integrity check ==========');
  // shift_self_period_lock body must still set status='locked', locked_reason='period_lock', locked_by=null.
  const { rows: [selfPl] } = await c.query<{ src: string }>(
    `select pg_get_functiondef(p.oid) as src
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='shift_self_period_lock'`,
  );
  const selfHasSetLocked = /set status = 'locked'/i.test(selfPl.src)
                       && /locked_reason\s*=\s*'period_lock'/i.test(selfPl.src);
  console.log('  shift_self_period_lock auto-lock body intact?', selfHasSetLocked ? 'YES' : 'NO');
  if (!selfHasSetLocked) throw new Error('shift_self_period_lock has changed — DO NOT proceed');
  // shift_start must still raise 42501 'account locked'.
  const { rows: [startSrc] } = await c.query<{ src: string }>(
    `select pg_get_functiondef(p.oid) as src
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='shift_start'`,
  );
  const startGuardIntact = /raise exception 'account locked' using errcode='42501'/i.test(startSrc.src);
  console.log('  shift_start account_locked guard intact?', startGuardIntact ? 'YES' : 'NO');
  if (!startGuardIntact) throw new Error('shift_start guard has changed — DO NOT proceed');

  console.log('\n✅ All four scenarios pass; auto period-lock + account_locked guard unchanged');
  await c.end();
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
