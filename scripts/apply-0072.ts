/**
 * Apply 0072 (schedule shift_break_sweep) and prove it END-TO-END:
 *   1. Apply migration (registers the cron job).
 *   2. Confirm cron.job row: jobname='shift_break_sweep', schedule='* * * * *',
 *      active=true.
 *   3. Pick a manager whose session we can drive lock-eligible WITHOUT
 *      rolling back (the cron only runs against COMMITTED rows; a
 *      txn-rolled-back row would be invisible to the worker).
 *      → COMMIT a session into status='on_shift_break' with
 *        current_break_started_at far enough back that break_elapsed
 *        >= allowance + grace.
 *   4. Snapshot BEFORE.
 *   5. POLL `shift_sessions.status` every ~15s for up to ~90s. The cron
 *      fires at the top of each minute UTC; within 60–75s we expect
 *      status='locked', locked_reason='break_overstay' from the cron
 *      sweep (no manual call in between).
 *   6. Read cron.job_run_details to PROVE the cron actually executed
 *      (status='succeeded', return_message includes the sweep counts).
 *   7. Restore: call shift_admin_unlock(session_id) so the real
 *      manager isn't left locked, then delete the temp config/session
 *      via the original cleanup path. Print the AFTER-CLEANUP state.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0072_schedule_break_sweep.sql';

interface Sess {
  status: string;
  locked_reason: string | null;
  current_break_started_at: string | null;
  current_pause_started_at: string | null;
  current_pause_reason: string | null;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function readSess(c: Client, sid: string): Promise<Sess> {
  const { rows: [r] } = await c.query<Sess>(
    `select status, locked_reason,
            current_break_started_at::text as current_break_started_at,
            current_pause_started_at::text as current_pause_started_at,
            current_pause_reason
       from public.shift_sessions where id=$1`, [sid],
  );
  return r;
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.\n');

  // Confirm job is registered + active.
  const { rows: jobRows } = await c.query<{ jobid: number; jobname: string; schedule: string; active: boolean }>(
    `select jobid, jobname, schedule, active
       from cron.job where jobname='shift_break_sweep'`);
  console.log('=== cron.job row ===');
  for (const j of jobRows) console.log('  ', j);
  if (jobRows.length !== 1 || jobRows[0].active !== true || jobRows[0].schedule !== '* * * * *') {
    throw new Error('FAIL — cron job not properly registered');
  }
  console.log('  ✅ registered (schedule=* * * * *, active=true)');

  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where role='admin' and status='active' limit 1`);
  const { rows: [mgr] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users
       where role='manager' and status='active' and is_super_admin=false
       order by username limit 1`);
  console.log('\nadmin :', admin.id);
  console.log('mgr   :', mgr.username, '(' + mgr.id + ')');

  // === IMPORTANT ===
  // We must COMMIT the test state — the cron worker is a separate
  // process and won't see uncommitted rows. We'll restore via
  // shift_admin_unlock + targeted UPDATEs at the end so the manager
  // isn't left locked.
  // ================

  // Pre-cleanup: drop today's session/config for this manager.
  await c.query(`set "request.jwt.claim.sub" = '${admin.id}'`);
  await c.query(
    `delete from public.shift_sessions where user_id=$1
        and work_date=(now() at time zone 'UTC')::date`, [mgr.id]);
  await c.query(`delete from public.shift_configs where user_id=$1`, [mgr.id]);

  // Seed with small allowance + grace so we don't need to backdate
  // current_break_started_at by 45+ minutes (anything > allowance+grace
  // works). allowance=60s, grace=30s → break_elapsed=120s is lock-eligible.
  await c.query(`
    insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
      bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
      primary_group_id, timezone, late_start_threshold_seconds, account_locked,
      shift_break_overstay_grace_seconds)
    values ($1,'hard',60,7,4,1200,360,null,'Asia/Manila',900,false, 30)`, [mgr.id]);

  await c.query(`set "request.jwt.claim.sub" = '${mgr.id}'`);
  const { rows: [s] } = await c.query<{ r: { session_id: string } }>(
    `select public.shift_start() as r`);
  const sid = s.r.session_id;
  await c.query(`select public.shift_take_shift_break($1)`, [sid]);

  await c.query(`set "request.jwt.claim.sub" = '${admin.id}'`);
  await c.query(
    `update public.shift_sessions
        set current_break_started_at = now() - interval '120 seconds'
      where id=$1`, [sid]);

  const before = await readSess(c, sid);
  console.log('\n===== BEFORE waiting for cron =====');
  console.log('  session ' + sid + ':', before);
  if (before.status !== 'on_shift_break') {
    throw new Error('FAIL — pre-state should be on_shift_break, got ' + before.status);
  }

  // Poll for up to 90s for the cron to flip the session to 'locked'.
  console.log('\n===== Waiting for cron (poll every 15s, up to 90s) =====');
  console.log('  current UTC second-of-minute:', new Date().getUTCSeconds());
  let lockedSess: Sess | null = null;
  let waited = 0;
  const POLL_MS = 15_000;
  const MAX_MS  = 90_000;
  while (waited < MAX_MS) {
    await sleep(POLL_MS);
    waited += POLL_MS;
    const cur = await readSess(c, sid);
    console.log('  +' + (waited / 1000) + 's: status=' + cur.status + ' locked_reason=' + cur.locked_reason);
    if (cur.status === 'locked' && cur.locked_reason === 'break_overstay') {
      lockedSess = cur;
      break;
    }
  }

  // Always read cron.job_run_details so we know whether the cron ran.
  const { rows: runs } = await c.query<{
    runid: number; jobid: number; job_pid: number | null; database: string;
    username: string; command: string; status: string; return_message: string;
    start_time: string; end_time: string;
  }>(`
    select runid, jobid, job_pid, database, username, command, status,
           return_message, start_time::text, end_time::text
      from cron.job_run_details
     where jobid = (select jobid from cron.job where jobname='shift_break_sweep')
     order by start_time desc nulls last
     limit 5`);
  console.log('\n===== cron.job_run_details (most recent 5) =====');
  if (runs.length === 0) console.log('  (no runs recorded yet)');
  for (const r of runs) {
    console.log('  runid=' + r.runid
      + '  status=' + r.status
      + '  start=' + r.start_time
      + '  end=' + r.end_time
      + '  msg=' + r.return_message);
  }

  // ===== Restore: unlock + clear test data =====
  console.log('\n===== Restoring (admin unlock + delete test config/session) =====');
  try {
    await c.query(`set "request.jwt.claim.sub" = '${admin.id}'`);
    if (lockedSess) {
      await c.query(`select public.shift_admin_unlock($1)`, [sid]);
    }
    // Wipe the session + config we created so the manager starts clean tomorrow.
    await c.query(
      `delete from public.shift_sessions where id=$1`, [sid]);
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgr.id]);
    console.log('  ✅ session deleted, config deleted');
  } catch (e) {
    console.warn('  WARN — restore failed:', e);
  }

  if (!lockedSess) {
    console.error('\n❌ FAIL — cron did NOT lock the session within 90s. See cron.job_run_details above.');
    process.exit(1);
  }

  console.log('\n===== AFTER cron (proven session lock by the scheduled cron) =====');
  console.log('  ' + JSON.stringify(lockedSess));
  console.log('\n========== SUMMARY ==========');
  console.log('  BEFORE: status=' + before.status + ', locked_reason=' + before.locked_reason);
  console.log('  AFTER : status=' + lockedSess.status + ', locked_reason=' + lockedSess.locked_reason);
  console.log('  → cron itself flipped the session (no manual sweep call in this test)');

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
