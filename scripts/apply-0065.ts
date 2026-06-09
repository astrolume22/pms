/**
 * Apply 0065 (admin lock pauses the 8h timer) + prove the freeze/resume.
 *
 *  1. Apply migration (idempotent: CREATE OR REPLACE only).
 *  2. Open a transaction (rolled back at the end so nothing persists):
 *       a. Pick a non-admin manager + clean their config + today's session
 *       b. Start their shift, sleep 3s, read shift_tick → T0
 *       c. Admin locks them via shift_admin_set_account_lock(user, true)
 *       d. Read shift_tick → T1. Assert status='locked' AND
 *          T1.remaining ≈ T0.remaining (frozen at the lock instant).
 *       e. Sleep 4s, read shift_tick → T2. Assert T2.remaining = T1.remaining
 *          (timer did NOT decrement while locked).
 *       f. Admin unlocks via shift_admin_set_account_lock(user, false)
 *       g. Read shift_tick → T3. Assert status='active' AND
 *          T3.remaining ≈ T1.remaining (locked window NOT counted).
 *  3. Rollback. Print the numbers.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260608_0065_shift_lock_pauses_timer.sql';

interface TickPayload {
  status: string;
  elapsed_seconds: number;
  remaining_seconds: number;
  paused_total_seconds: number;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.');

  // Confirm the new function bodies landed.
  const { rows: [fA] } = await c.query<{ src: string }>(
    `select pg_get_functiondef(p.oid) as src
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='shift_admin_set_account_lock'`,
  );
  const fHasPause = /v_session_paused\s*:=\s*true/i.test(fA.src);
  const fHasResume = /v_session_resumed\s*:=\s*true/i.test(fA.src);
  console.log('  shift_admin_set_account_lock has pause branch? ' + fHasPause);
  console.log('  shift_admin_set_account_lock has resume branch? ' + fHasResume);
  if (!fHasPause || !fHasResume) { console.error('FAIL — new branches missing'); process.exit(1); }

  const { rows: [fU] } = await c.query<{ src: string }>(
    `select pg_get_functiondef(p.oid) as src
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='shift_admin_unlock'`,
  );
  const uHasIdem = /already_unlocked/.test(fU.src);
  console.log('  shift_admin_unlock has idempotent already_unlocked? ' + uHasIdem);
  if (!uHasIdem) { console.error('FAIL — shift_admin_unlock idempotency missing'); process.exit(1); }

  // ---------- ROLLBACK SIMULATION ----------
  const { rows: [admin] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users where role='admin' and status='active' limit 1`,
  );
  const { rows: [mgr] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users where role='manager' and status='active' and is_super_admin=false limit 1`,
  );
  if (!admin || !mgr) { console.error('FAIL — admin/manager not found'); process.exit(1); }

  console.log('\n========== ROLLBACK SIMULATION ==========');
  console.log('admin :', admin.username, '(' + admin.id + ')');
  console.log('mgr   :', mgr.username,   '(' + mgr.id   + ')');

  await c.query('begin');
  try {
    // Clean slate for the manager.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
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

    // Manager starts their shift.
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [s] } = await c.query<{ res: { session_id: string; started_at: string } }>(
      `select public.shift_start() as res`,
    );
    const sid = s.res.session_id;
    console.log('\nshift_start →', s.res);

    // Sleep 3s so elapsed is non-trivial.
    await sleep(3000);
    const { rows: [t0] } = await c.query<{ tick: TickPayload }>(
      `select public.shift_tick($1) as tick`, [sid],
    );
    console.log('\nT0 (after 3s of work):',
      'status=' + t0.tick.status,
      ' elapsed=' + t0.tick.elapsed_seconds,
      ' remaining=' + t0.tick.remaining_seconds);
    if (t0.tick.status !== 'active') throw new Error('T0 FAIL — expected active');

    // Admin locks the account → migration should ALSO pause the session.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    const { rows: [lockRes] } = await c.query<{ res: { session_paused: boolean; account_locked: boolean } }>(
      `select public.shift_admin_set_account_lock($1, true) as res`, [mgr.id],
    );
    console.log('\nshift_admin_set_account_lock(true) →', lockRes.res);
    if (lockRes.res.session_paused !== true) throw new Error('FAIL — session_paused should be true');

    // Read tick immediately AND after a 4s wait. Both must report status='locked'
    // and identical remaining_seconds (frozen at the lock instant).
    const { rows: [t1] } = await c.query<{ tick: TickPayload }>(
      `select public.shift_tick($1) as tick`, [sid],
    );
    console.log('\nT1 (right after lock):',
      'status=' + t1.tick.status,
      ' elapsed=' + t1.tick.elapsed_seconds,
      ' remaining=' + t1.tick.remaining_seconds);
    if (t1.tick.status !== 'locked') throw new Error('T1 FAIL — expected locked');
    // The frozen elapsed should be at most 1s off T0 (clock_timestamp drift).
    if (Math.abs(t1.tick.elapsed_seconds - t0.tick.elapsed_seconds) > 1) {
      throw new Error('T1 FAIL — elapsed jumped from T0 by more than 1s ('
        + t0.tick.elapsed_seconds + ' → ' + t1.tick.elapsed_seconds + ')');
    }

    await sleep(4000);
    const { rows: [t2] } = await c.query<{ tick: TickPayload }>(
      `select public.shift_tick($1) as tick`, [sid],
    );
    console.log('\nT2 (4s after lock — should be FROZEN):',
      'status=' + t2.tick.status,
      ' elapsed=' + t2.tick.elapsed_seconds,
      ' remaining=' + t2.tick.remaining_seconds);
    if (t2.tick.status !== 'locked') throw new Error('T2 FAIL — expected still locked');
    // shift_tick (0062) has a ±1s rounding artifact because the two
    // clock_timestamp() calls inside it can straddle an integer boundary.
    // Without the pause, 4 seconds of wait would drop remaining by ~4;
    // with the pause, we expect remaining within ±1 of T1.
    const dec = t1.tick.remaining_seconds - t2.tick.remaining_seconds;
    if (Math.abs(dec) > 1) {
      throw new Error('T2 FAIL — remaining changed by >1s while locked: '
        + t1.tick.remaining_seconds + ' → ' + t2.tick.remaining_seconds);
    }
    console.log('  ✅ timer FROZE during the 4s lock window (drift = '
      + dec + 's, vs ~4s if it had kept ticking — within ±1s rounding)');

    // Admin unlocks → migration should ALSO resume the session.
    const { rows: [unlockRes] } = await c.query<{ res: { session_resumed: boolean } }>(
      `select public.shift_admin_set_account_lock($1, false) as res`, [mgr.id],
    );
    console.log('\nshift_admin_set_account_lock(false) →', unlockRes.res);
    if (unlockRes.res.session_resumed !== true) throw new Error('FAIL — session_resumed should be true');

    // Read tick post-unlock. Status back to 'active', and elapsed
    // should be near T0 (the locked window was NOT counted).
    const { rows: [t3] } = await c.query<{ tick: TickPayload }>(
      `select public.shift_tick($1) as tick`, [sid],
    );
    console.log('\nT3 (right after unlock — should resume from T0):',
      'status=' + t3.tick.status,
      ' elapsed=' + t3.tick.elapsed_seconds,
      ' remaining=' + t3.tick.remaining_seconds,
      ' paused_total=' + t3.tick.paused_total_seconds);
    if (t3.tick.status !== 'active') throw new Error('T3 FAIL — expected active');
    // Same ±1s tolerance for the same rounding reason. The critical
    // assertion is: T3.elapsed didn't gain the 4 seconds of lock time.
    if (Math.abs(t3.tick.elapsed_seconds - t0.tick.elapsed_seconds) > 2) {
      throw new Error('T3 FAIL — elapsed gained time during the locked window: T0='
        + t0.tick.elapsed_seconds + ' → T3=' + t3.tick.elapsed_seconds);
    }
    console.log('  ✅ resumed from where it froze; locked window NOT counted');

    // Sanity: the 4s lock window should have been added to paused_total_seconds
    // (some script timing slop is normal — we expect roughly 3-7s).
    if (t3.tick.paused_total_seconds < 3 || t3.tick.paused_total_seconds > 7) {
      throw new Error('T3 FAIL — paused_total_seconds outside [3,7]: '
        + t3.tick.paused_total_seconds);
    }
    console.log('  ✅ paused_total_seconds = ' + t3.tick.paused_total_seconds
      + ' (matches the ~4s locked window)');

    console.log('\n========== SUMMARY ==========');
    console.log('  T0 (active, +3s work)  : elapsed=' + t0.tick.elapsed_seconds + ' remaining=' + t0.tick.remaining_seconds);
    console.log('  T1 (locked, +0s)       : elapsed=' + t1.tick.elapsed_seconds + ' remaining=' + t1.tick.remaining_seconds);
    console.log('  T2 (locked, +4s wait)  : elapsed=' + t2.tick.elapsed_seconds + ' remaining=' + t2.tick.remaining_seconds);
    console.log('  T3 (active, post-unlock): elapsed=' + t3.tick.elapsed_seconds + ' remaining=' + t3.tick.remaining_seconds);

  } finally {
    await c.query('rollback');
    console.log('\n(simulation transaction rolled back — no data persisted)');
  }

  console.log('\n✅ 0065 verified: lock freezes the 8h timer; unlock resumes with zero time lost.');
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
