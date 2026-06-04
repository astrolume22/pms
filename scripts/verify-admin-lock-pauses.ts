/**
 * Live proof for the founder requirement:
 *   "Admin lock must PAUSE the timer; admin unlock must RESUME from the
 *    frozen value (locked duration added to paused_total_seconds, so it
 *    does NOT eat into 8h); admin lock must NOT advance the period_index."
 *
 * Reads + mutates against prod DB inside ONE transaction that gets
 * rolled back. Manager's real shift_sessions for today is untouched.
 *
 * Sequence:
 *   (a) Manager has a synthetic active session, backdated 5s.
 *   (b) Read elapsed1 + remaining1 + period_index = 0.
 *   (c) Admin calls shift_admin_lock(reason='admin'). Row inspected:
 *       - status='locked', locked_reason='admin', locked_by=admin
 *       - current_pause_started_at set, current_pause_reason='admin'
 *   (d) Sleep ~2s. Tick again — elapsed must NOT have advanced by
 *       wall-clock (the freeze invariant).
 *   (e) Admin calls shift_admin_unlock. Row inspected:
 *       - status='active'
 *       - paused_total_seconds grew by ~lock duration
 *       - current_period_index UNCHANGED (still 0) — admin lock does
 *         NOT advance the period (only period_lock does)
 *       - locked_/pause_ fields cleared
 *   (f) Sleep ~1s. Tick. Elapsed must now grow again (timer resumed).
 *   (g) period_unlock event: meta.was_period_lock=false, locked_by=admin id.
 *
 * Rolled back at the end.
 */
import './loadEnv';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  let allOk = true;
  const expect = (ok: boolean, msg: string) => {
    allOk = allOk && ok;
    console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  };

  try {
    const { rows: [mgr] } = await c.query<{ id: string; full_name: string | null }>(
      `select id, full_name from public.users
        where role='manager' and status='active' and is_super_admin=false
        order by created_at asc limit 1;`,
    );
    if (!mgr) throw new Error('No manager.');
    const { rows: [adm] } = await c.query<{ id: string }>(
      `select id from public.users where role='admin' and is_super_admin=true limit 1;`,
    );
    if (!adm) throw new Error('No admin.');

    console.log(`test manager: "${mgr.full_name ?? '?'}" (${mgr.id.slice(0, 8)}…)`);
    console.log(`test admin:   (${adm.id.slice(0, 8)}…)\n`);

    await c.query('BEGIN');

    // Manager session — backdated 5s so elapsed > 0 right away.
    await c.query(`select set_config('request.jwt.claims', $1, true);`,
      [JSON.stringify({ sub: mgr.id, role: 'authenticated' })]);

    const sid = randomUUID();
    await c.query(
      `insert into public.shift_sessions
         (id, user_id, work_date, status, mode, period_seconds, required_seconds,
          started_at, paused_total_seconds, current_period_index)
       values ($1, $2, '2024-12-31', 'active', 'medium', 10800, 28800,
               clock_timestamp() - interval '5 seconds', 0, 0);`,
      [sid, mgr.id],
    );

    // ─── (a) baseline tick ───────────────────────────────────────────
    console.log('━━━ (a) baseline (active, elapsed ≈ 5s) ━━━');
    const t0 = (await c.query<{ r: any }>(`select public.shift_tick($1) as r;`, [sid])).rows[0].r;
    console.log(`  elapsed=${t0.elapsed_seconds}s remaining=${t0.remaining_seconds}s status=${t0.status} period_index=${t0.current_period_index}`);
    expect(t0.status === 'active', `status=active`);
    expect(t0.elapsed_seconds >= 4 && t0.elapsed_seconds <= 7, `elapsed in [4,7]s`);
    expect(t0.current_period_index === 0, `current_period_index=0`);
    const elapsedAtLock = t0.elapsed_seconds;
    const remainingAtLock = t0.remaining_seconds;

    // ─── (b) admin lock (reason='admin') ─────────────────────────────
    console.log('\n━━━ (b) admin calls shift_admin_lock(reason=admin) ━━━');
    await c.query(`select set_config('request.jwt.claims', $1, true);`,
      [JSON.stringify({ sub: adm.id, role: 'authenticated' })]);
    const lk = (await c.query<{ r: any }>(`select public.shift_admin_lock($1, 'admin') as r;`, [sid])).rows[0].r;
    console.log(`  rpc returned: ${JSON.stringify(lk)}`);
    expect(lk.status === 'locked', `rpc returns status=locked`);

    const { rows: [row1] } = await c.query<{
      status: string;
      locked_reason: string | null;
      locked_by: string | null;
      current_pause_reason: string | null;
      current_pause_started_at: string | null;
      paused_total_seconds: number;
      current_period_index: number;
    }>(
      `select status, locked_reason, locked_by, current_pause_reason,
              current_pause_started_at, paused_total_seconds, current_period_index
         from public.shift_sessions where id=$1;`,
      [sid],
    );
    console.log(`  row: ${JSON.stringify(row1)}`);
    expect(row1.status === 'locked', `row.status = locked`);
    expect(row1.locked_reason === 'admin', `row.locked_reason = admin (NOT period_lock)`);
    expect(row1.locked_by === adm.id, `row.locked_by = admin id`);
    expect(row1.current_pause_reason === 'admin', `current_pause_reason = admin`);
    expect(row1.current_pause_started_at !== null, `current_pause_started_at is set`);
    expect(row1.paused_total_seconds === 0, `paused_total_seconds still 0 (lock just started)`);
    expect(row1.current_period_index === 0, `current_period_index still 0`);

    // ─── (c) tick under lock — elapsed must freeze (wall-clock) ─────
    console.log('\n━━━ (c) sleep 2s → tick → elapsed must NOT grow by wall-clock ━━━');
    await sleep(2000);
    const tLocked = (await c.query<{ r: any }>(`select public.shift_tick($1) as r;`, [sid])).rows[0].r;
    console.log(`  during-lock tick: elapsed=${tLocked.elapsed_seconds}s remaining=${tLocked.remaining_seconds}s status=${tLocked.status}`);
    expect(tLocked.status === 'locked', `tick reports status=locked`);
    // Strict invariant: elapsed must NOT grow by the ~2s we slept.
    // (Allow +1 jitter for in-tx now()/clock_timestamp drift.)
    expect(
      tLocked.elapsed_seconds <= elapsedAtLock + 1,
      `elapsed did NOT grow by the slept 2s (was ${elapsedAtLock}s, now ${tLocked.elapsed_seconds}s) — timer is FROZEN`,
    );
    expect(
      tLocked.remaining_seconds >= remainingAtLock - 1,
      `remaining did NOT drop by the slept 2s (was ${remainingAtLock}s, now ${tLocked.remaining_seconds}s) — display frozen`,
    );

    // ─── (d) admin unlock — resume, no period advance ────────────────
    console.log('\n━━━ (d) admin calls shift_admin_unlock ━━━');
    const un = (await c.query<{ r: any }>(`select public.shift_admin_unlock($1) as r;`, [sid])).rows[0].r;
    console.log(`  rpc returned: ${JSON.stringify(un)}`);
    expect(un.status === 'active', `rpc returns status=active`);
    expect(typeof un.lock_wait_seconds === 'number' && un.lock_wait_seconds >= 1,
      `lock_wait_seconds >= 1 (got ${un.lock_wait_seconds})`);

    const { rows: [row2] } = await c.query<{
      status: string;
      locked_reason: string | null;
      locked_by: string | null;
      current_pause_reason: string | null;
      current_pause_started_at: string | null;
      paused_total_seconds: number;
      current_period_index: number;
    }>(
      `select status, locked_reason, locked_by, current_pause_reason,
              current_pause_started_at, paused_total_seconds, current_period_index
         from public.shift_sessions where id=$1;`,
      [sid],
    );
    console.log(`  row: ${JSON.stringify(row2)}`);
    expect(row2.status === 'active', `row.status = active`);
    expect(row2.locked_reason === null, `row.locked_reason cleared`);
    expect(row2.locked_by === null, `row.locked_by cleared`);
    expect(row2.current_pause_reason === null, `current_pause_reason cleared`);
    expect(row2.current_pause_started_at === null, `current_pause_started_at cleared`);
    expect(row2.paused_total_seconds >= 1,
      `paused_total_seconds grew by lock duration (got ${row2.paused_total_seconds}s, was 0) — 8h not eaten`);
    // KEY: admin lock does NOT advance the period index
    expect(row2.current_period_index === 0,
      `current_period_index UNCHANGED (still 0) — admin lock did NOT advance the period`);

    // ─── (e) tick after unlock — must resume from frozen elapsed ────
    console.log('\n━━━ (e) sleep 1s → tick → elapsed must resume + grow ━━━');
    await sleep(1500);
    const tResumed = (await c.query<{ r: any }>(`select public.shift_tick($1) as r;`, [sid])).rows[0].r;
    console.log(`  post-unlock tick: elapsed=${tResumed.elapsed_seconds}s remaining=${tResumed.remaining_seconds}s status=${tResumed.status}`);
    expect(tResumed.status === 'active', `tick reports status=active again`);
    // Elapsed should be in the neighborhood of the frozen value plus ~1s
    // of post-unlock real wall-clock. Allow generous bounds for in-tx
    // now()/clock_timestamp drift.
    expect(
      tResumed.elapsed_seconds >= elapsedAtLock - 1
        && tResumed.elapsed_seconds <= elapsedAtLock + 3,
      `elapsed resumes near frozen value (was ${elapsedAtLock}s, now ${tResumed.elapsed_seconds}s) — locked duration did NOT count toward elapsed`,
    );

    // ─── (f) audit: period_unlock event ──────────────────────────────
    console.log('\n━━━ (f) period_unlock event meta ━━━');
    const { rows: [evt] } = await c.query<{ by: string; meta: any }>(
      `select by::text, meta from public.shift_events
        where session_id=$1 and type='period_unlock'
        order by at desc limit 1;`,
      [sid],
    );
    console.log(`  ${JSON.stringify(evt)}`);
    expect(evt.by === adm.id, `event.by = admin id`);
    expect(evt.meta.was_period_lock === false,
      `meta.was_period_lock = false (it was an admin lock, NOT a period lock)`);
    expect(typeof evt.meta.pause_seconds === 'number' && evt.meta.pause_seconds >= 1,
      `meta.pause_seconds present and >= 1`);

    // ─── (g) audit: period_lock event captured the admin id ──────────
    console.log('\n━━━ (g) period_lock event (the lock itself) ━━━');
    const { rows: [evtLk] } = await c.query<{ by: string; meta: any }>(
      `select by::text, meta from public.shift_events
        where session_id=$1 and type='period_lock'
        order by at desc limit 1;`,
      [sid],
    );
    console.log(`  ${JSON.stringify(evtLk)}`);
    expect(evtLk.by === adm.id, `period_lock event.by = admin id`);
    expect(evtLk.meta.reason === 'admin', `period_lock event.meta.reason = admin`);

    // ─── (h) end ────────────────────────────────────────────────────
    await c.query('ROLLBACK');
    console.log(`\n${allOk ? '✓ ALL ASSERTIONS PASSED' : '✗ SOME ASSERTIONS FAILED'}`);
    if (!allOk) process.exit(1);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e);
    process.exit(1);
  } finally {
    await c.end();
  }
}
main();
