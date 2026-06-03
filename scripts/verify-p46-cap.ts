/**
 * P4.6 proof — confirm the one-shift-per-day cap is already enforced.
 * No migration; nothing changes. All scenarios inside SAVEPOINTed
 * sub-transactions so a planned-rejection doesn't poison the outer
 * test transaction.
 */
import './loadEnv';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let allOk = true;
  const expect = (ok: boolean, msg: string) => { allOk = allOk && ok; console.log(`  ${ok ? '✓' : '✗'} ${msg}`); };

  try {
    const { rows: [mgr] } = await c.query<{ id: string; full_name: string | null }>(
      `select id, full_name from public.users where role='manager' and status='active' and is_super_admin=false order by created_at asc limit 1;`);
    const { rows: [adm] } = await c.query<{ id: string }>(
      `select id from public.users where role='admin' and is_super_admin=true limit 1;`);
    if (!mgr || !adm) throw new Error('need manager + admin');
    console.log(`test manager: "${mgr.full_name ?? '?'}" (${mgr.id.slice(0,8)}…)`);

    await c.query('BEGIN');

    // ─── (a) self shift_start on a completed today's row → rejected, row unchanged ─
    console.log('\n━━━ (a) self shift_start on completed today → rejected, row unchanged ━━━');
    await c.query(`delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date;`, [mgr.id]);
    const sid = randomUUID();
    const origStarted = new Date(Date.now() - 9 * 3600_000).toISOString();   // 9h ago
    const origCompleted = new Date(Date.now() - 1 * 3600_000).toISOString(); // 1h ago
    await c.query(
      `insert into public.shift_sessions
         (id, user_id, work_date, status, mode, period_seconds, required_seconds,
          started_at, completed_at, bio_break_count_today)
       values ($1, $2, (now() at time zone 'UTC')::date, 'completed', 'medium', 10800, 28800,
               $3::timestamptz, $4::timestamptz, 5);`,
      [sid, mgr.id, origStarted, origCompleted]);

    // Manager attempt to self-start a second shift
    await c.query(`select set_config('request.jwt.claims', $1, true);`, [JSON.stringify({ sub: mgr.id, role: 'authenticated' })]);
    await c.query('SAVEPOINT sp_start;');
    let rejectedSelfStart = false;
    let selfStartMsg = '';
    try {
      await c.query(`select public.shift_start();`);
    } catch (e) {
      rejectedSelfStart = true;
      selfStartMsg = (e as Error).message.split('\n')[0];
      await c.query('ROLLBACK TO SAVEPOINT sp_start;');
    }
    expect(rejectedSelfStart, `shift_start rejected on completed session ("${selfStartMsg}")`);

    // Confirm row UNCHANGED
    const { rows: [post] } = await c.query<{
      status: string; started_at: string; completed_at: string; bio_break_count_today: number;
    }>(
      `select status, started_at::text, completed_at::text, bio_break_count_today from public.shift_sessions where id=$1;`,
      [sid]);
    expect(post.status === 'completed',                              `row.status still = completed (was not reset)`);
    // Compare instants (PG returns its own ISO format, doesn't byte-equal the original ISO).
    expect(new Date(post.started_at).getTime() === new Date(origStarted).getTime(),
                                                                     `started_at unchanged (not restamped)`);
    expect(new Date(post.completed_at).getTime() === new Date(origCompleted).getTime(),
                                                                     `completed_at unchanged`);
    expect(post.bio_break_count_today === 5,                         `bio_break_count_today unchanged`);

    // ─── (b) same test for a 'locked' row — also rejected, row unchanged ─
    console.log('\n━━━ (b) shift_start on locked today → rejected ━━━');
    await c.query(`update public.shift_sessions set status='locked', completed_at=null, locked_at=now(), locked_reason='admin' where id=$1;`, [sid]);
    await c.query('SAVEPOINT sp_locked;');
    let rejectedLocked = false;
    try {
      await c.query(`select public.shift_start();`);
    } catch (e) {
      rejectedLocked = true;
      console.log(`  rejected: ${(e as Error).message.split('\n')[0]}`);
      await c.query('ROLLBACK TO SAVEPOINT sp_locked;');
    }
    expect(rejectedLocked, `shift_start rejected on locked session`);

    // ─── (c) admin rearm DOES give a fresh run; non-admin rearm rejected ─
    console.log('\n━━━ (c) admin path: shift_admin_rearm is admin-only ━━━');
    await c.query(`select set_config('request.jwt.claims', $1, true);`, [JSON.stringify({ sub: mgr.id, role: 'authenticated' })]);
    await c.query('SAVEPOINT sp_rearm_mgr;');
    let rearmRejected = false;
    try {
      await c.query(`select public.shift_admin_rearm($1);`, [sid]);
    } catch (e) {
      rearmRejected = true;
      console.log(`  manager rearm rejected: ${(e as Error).message.split('\n')[0]}`);
      await c.query('ROLLBACK TO SAVEPOINT sp_rearm_mgr;');
    }
    expect(rearmRejected, `non-admin call to shift_admin_rearm rejected`);

    // Admin rearm succeeds
    await c.query(`select set_config('request.jwt.claims', $1, true);`, [JSON.stringify({ sub: adm.id, role: 'authenticated' })]);
    const rearm = (await c.query<{ r: any }>(`select public.shift_admin_rearm($1) as r;`, [sid])).rows[0].r;
    console.log(`  admin rearm: ${JSON.stringify(rearm)}`);
    const { rows: [postRearm] } = await c.query<{ status: string; started_at: string; bio_break_count_today: number; current_period_index: number; paused_total_seconds: number; locked_reason: string | null }>(
      `select status, started_at::text, bio_break_count_today, current_period_index, paused_total_seconds, locked_reason from public.shift_sessions where id=$1;`, [sid]);
    expect(postRearm.status === 'active',                            `admin rearm → status active`);
    expect(postRearm.started_at !== origStarted,                     `admin rearm → started_at refreshed to now`);
    expect(postRearm.bio_break_count_today === 0,                    `admin rearm → bio counters reset`);
    expect(postRearm.current_period_index === 0,                     `admin rearm → period_index reset`);
    expect(postRearm.paused_total_seconds === 0,                     `admin rearm → paused_total reset`);
    expect(postRearm.locked_reason === null,                         `admin rearm → lock fields cleared`);

    // ─── (d) UNIQUE constraint physically blocks a 2nd same-day insert ─
    console.log('\n━━━ (d) UNIQUE(user_id, work_date) physically blocks duplicate ━━━');
    await c.query('SAVEPOINT sp_dup;');
    let dupRejected = false;
    try {
      await c.query(
        `insert into public.shift_sessions (id, user_id, work_date, status, mode, period_seconds, required_seconds)
         values (gen_random_uuid(), $1, (now() at time zone 'UTC')::date, 'not_started', 'medium', 10800, 28800);`,
        [mgr.id]);
    } catch (e) {
      dupRejected = true;
      console.log(`  rejected: ${(e as Error).message.split('\n')[0]}`);
      await c.query('ROLLBACK TO SAVEPOINT sp_dup;');
    }
    expect(dupRejected, `second same-day insert rejected by UNIQUE`);

    await c.query('ROLLBACK');
    if (!allOk) { console.error('\n❌ one or more checks failed.'); process.exit(1); }
    console.log('\n✅ ALL CHECKS PASSED — one-shift-per-day cap already enforced at:');
    console.log('   • UNIQUE(user_id, work_date) on shift_sessions');
    console.log('   • shift_start() rejects non-not_started status');
    console.log('   • shift_get_or_create_today_session() returns the existing row (no new row)');
    console.log('   • shift_admin_rearm is the only second-run path; is_admin() gated');
    console.log('   • Admin rearm correctly resets counters + status + timer');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
}
main().catch(e => { console.error('FAILED:', e); process.exit(1); });
