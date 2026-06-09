/**
 * Apply 0069 (shift-break overstay lock) + prove the 3-step flow:
 *   Step 1: freeze applied (0068 RPC)
 *   Step 2: shift_break_overstay_lock → status='locked', locked_reason='break_overstay',
 *           current_break_* cleared, an open lock pause exists;
 *           two shift_tick calls across 3s → remaining_seconds frozen.
 *   Step 3: shift_admin_unlock → status='active', lock+pause cleared,
 *           current_period_index NOT advanced, counts/started_at unchanged;
 *           a follow-up tick shows the timer RESUMING.
 *   Everything inside a transaction that rolls back.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0069_shift_break_overstay_lock.sql';

interface Sess {
  status: string;
  current_pause_started_at: string | null;
  current_pause_reason: string | null;
  paused_total_seconds: number;
  current_break_started_at: string | null;
  current_break_kind: string | null;
  current_period_index: number;
  locked_reason: string | null;
  bio_break_count_today: number;
  shift_break_count_today: number;
  started_at: string;
}
type Tick = Record<string, unknown>;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function readSess(c: Client, sid: string): Promise<Sess> {
  const { rows: [r] } = await c.query<Sess>(
    `select status, current_pause_started_at::text as current_pause_started_at,
            current_pause_reason, paused_total_seconds,
            current_break_started_at::text as current_break_started_at,
            current_break_kind, current_period_index, locked_reason,
            bio_break_count_today, shift_break_count_today,
            started_at::text as started_at
       from public.shift_sessions where id=$1`, [sid],
  );
  return r;
}
async function tick(c: Client, sid: string): Promise<Tick> {
  const { rows: [r] } = await c.query<{ t: Tick }>(
    `select public.shift_tick($1) as t`, [sid],
  );
  return r.t;
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.\n');

  // Confirm signatures.
  const { rows: [tFn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_tick(uuid)'::regprocedure) as d`,
  );
  console.log('shift_tick returns shift_break_overstay_grace_seconds?',
    /shift_break_overstay_grace_seconds/.test(tFn.d));
  const { rows: [lkFn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_break_overstay_lock(uuid)'::regprocedure) as d`,
  );
  console.log('shift_break_overstay_lock defined?', /v_applied/.test(lkFn.d));
  const { rows: [chk] } = await c.query<{ def: string }>(`
    select pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname='public' and cl.relname='shift_sessions'
       and c.conname='shift_sessions_locked_reason_check'
  `);
  console.log('locked_reason CHECK after:', chk.def);

  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where role='admin' and status='active' limit 1`,
  );
  const { rows: [mgr] } = await c.query<{ id: string }>(
    `select id from public.users
       where role='manager' and status='active' and is_super_admin=false limit 1`,
  );

  await c.query('begin');
  try {
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`delete from public.shift_sessions where user_id=$1
                    and work_date=(now() at time zone 'UTC')::date`, [mgr.id]);
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgr.id]);
    // grace = 60 (short, for the test); allowance = 1800.
    await c.query(`
      insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
        bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
        primary_group_id, timezone, late_start_threshold_seconds, account_locked,
        shift_break_overstay_grace_seconds)
      values ($1,'hard',1800,7,4,1200,360,null,'Asia/Manila',900,false, 60)`, [mgr.id]);

    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [s] } = await c.query<{ r: { session_id: string } }>(
      `select public.shift_start() as r`,
    );
    const sid = s.r.session_id;

    // Start a shift break, backdate so break_elapsed = 1900s (allowance 1800 + grace 60 = 1860, so we're past).
    await c.query(`select public.shift_take_shift_break($1)`, [sid]);
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    // Set bio_break_count_today=2 + shift_break_count_today=1 (after the
    // take above sb=1; bump bio so we can verify it survives unlock).
    await c.query(
      `update public.shift_sessions
          set current_break_started_at = now() - interval '1900 seconds',
              bio_break_count_today = 2,
              bio_break_total_seconds_today = 300
        where id=$1`, [sid],
    );

    const sStart = await readSess(c, sid);
    console.log('\n===== INITIAL STATE =====');
    console.log(sStart);

    // ========== Step 1: freeze (0068) ==========
    console.log('\n========== STEP 1 — shift_break_freeze ==========');
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [f] } = await c.query<{ r: { applied: boolean; frozen: boolean } }>(
      `select public.shift_break_freeze($1) as r`, [sid],
    );
    console.log('  shift_break_freeze →', f.r);
    if (f.r.applied !== true) throw new Error('Step 1 FAIL — should apply');
    const sFroze = await readSess(c, sid);
    console.log('  session:', sFroze);
    if (sFroze.current_pause_reason !== 'break_overstay') throw new Error('Step 1 FAIL — pause reason');
    if (sFroze.status !== 'on_shift_break') throw new Error('Step 1 FAIL — should still be on break');
    console.log('  ✅ frozen (current_pause_reason=break_overstay) but still on shift break');

    // Sleep so the freeze pause has a non-zero duration when lock
    // finalizes it (int rounding eats <1s windows).
    await sleep(2500);

    // ========== Step 2: shift_break_overstay_lock + freeze continuity ==========
    console.log('\n========== STEP 2 — shift_break_overstay_lock + freeze continuity ==========');
    const { rows: [lk] } = await c.query<{ r: { applied: boolean; locked: boolean; status: string } }>(
      `select public.shift_break_overstay_lock($1) as r`, [sid],
    );
    console.log('  shift_break_overstay_lock →', lk.r);
    if (lk.r.applied !== true) throw new Error('Step 2 FAIL — should apply');
    const sLocked = await readSess(c, sid);
    console.log('  session:', sLocked);
    if (sLocked.status !== 'locked') throw new Error('Step 2 FAIL — should be locked');
    if (sLocked.locked_reason !== 'break_overstay') throw new Error('Step 2 FAIL — locked_reason');
    if (sLocked.current_break_started_at !== null) throw new Error('Step 2 FAIL — break_started not cleared');
    if (sLocked.current_break_kind !== null) throw new Error('Step 2 FAIL — break_kind not cleared');
    if (sLocked.current_pause_reason !== 'break_overstay') throw new Error('Step 2 FAIL — new pause not opened');
    if (!sLocked.current_pause_started_at) throw new Error('Step 2 FAIL — new pause has no start time');
    if (sLocked.paused_total_seconds <= sFroze.paused_total_seconds) {
      throw new Error('Step 2 FAIL — paused_total not credited (freeze pause should have been finalized)');
    }
    console.log('  ✅ status=locked, locked_reason=break_overstay');
    console.log('  ✅ break fields cleared; fresh lock pause opened');
    console.log('  ✅ paused_total credited ' + sFroze.paused_total_seconds + ' → ' + sLocked.paused_total_seconds);

    // Freeze CONTINUITY: tick + sleep + tick → remaining_seconds doesn't drop.
    const t1 = await tick(c, sid);
    console.log('  T1 remaining_seconds=' + t1.remaining_seconds);
    await sleep(3000);
    const t2 = await tick(c, sid);
    console.log('  T2 remaining_seconds=' + t2.remaining_seconds);
    const drop = (t1.remaining_seconds as number) - (t2.remaining_seconds as number);
    if (Math.abs(drop) > 1) {
      throw new Error('Step 2 FAIL — remaining decreased >1s while locked (drop=' + drop + ')');
    }
    console.log('  ✅ 8h remaining frozen across 3s wait (drop=' + drop + 's, vs ~3s if not frozen)');

    // ========== Step 3: shift_admin_unlock + resume ==========
    console.log('\n========== STEP 3 — shift_admin_unlock + resume ==========');
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    const { rows: [un] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_admin_unlock($1) as r`, [sid],
    );
    console.log('  shift_admin_unlock →', un.r);
    const sUn = await readSess(c, sid);
    console.log('  session:', sUn);
    if (sUn.status !== 'active') throw new Error('Step 3 FAIL — status should be active');
    if (sUn.locked_reason !== null) throw new Error('Step 3 FAIL — locked_reason not cleared');
    if (sUn.current_pause_started_at !== null) throw new Error('Step 3 FAIL — pause not closed');
    if (sUn.current_pause_reason !== null) throw new Error('Step 3 FAIL — pause reason not cleared');
    if (sUn.current_period_index !== sStart.current_period_index) {
      throw new Error('Step 3 FAIL — current_period_index should NOT have been advanced (was '
        + sStart.current_period_index + ' → ' + sUn.current_period_index + ')');
    }
    if (sUn.bio_break_count_today !== sStart.bio_break_count_today) {
      throw new Error('Step 3 FAIL — bio_break_count_today changed: '
        + sStart.bio_break_count_today + ' → ' + sUn.bio_break_count_today);
    }
    if (sUn.shift_break_count_today !== sStart.shift_break_count_today) {
      throw new Error('Step 3 FAIL — shift_break_count_today changed: '
        + sStart.shift_break_count_today + ' → ' + sUn.shift_break_count_today);
    }
    if (sUn.started_at !== sStart.started_at) {
      throw new Error('Step 3 FAIL — started_at changed: ' + sStart.started_at + ' → ' + sUn.started_at);
    }
    console.log('  ✅ status=active, lock+pause cleared');
    console.log('  ✅ current_period_index unchanged ('+sStart.current_period_index+')');
    console.log('  ✅ bio_break_count_today unchanged (' + sStart.bio_break_count_today + ')');
    console.log('  ✅ shift_break_count_today unchanged (' + sStart.shift_break_count_today + ')');
    console.log('  ✅ started_at unchanged');

    // Timer should resume (T3 remaining < T2 remaining after a wait).
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    await sleep(2000);
    const t3 = await tick(c, sid);
    console.log('  T3 remaining_seconds=' + t3.remaining_seconds + ' status=' + t3.status);
    if (t3.status !== 'active') throw new Error('Step 3 FAIL — tick status not active');
    const drop23 = (t2.remaining_seconds as number) - (t3.remaining_seconds as number);
    if (drop23 < 1) {
      throw new Error('Step 3 FAIL — timer did not resume (T2→T3 dropped by ' + drop23 + 's)');
    }
    console.log('  ✅ work timer RESUMED: T2→T3 dropped by ' + drop23 + 's');

    console.log('\n========== SUMMARY ==========');
    console.log('  initial      : paused_total=' + sStart.paused_total_seconds + '  cpi=' + sStart.current_period_index);
    console.log('  after freeze : paused_total=' + sFroze.paused_total_seconds + '  cpi=' + sFroze.current_period_index);
    console.log('  after lock   : paused_total=' + sLocked.paused_total_seconds + '  cpi=' + sLocked.current_period_index + '  status=locked locked_reason=' + sLocked.locked_reason);
    console.log('  T1 remaining=' + t1.remaining_seconds + '  T2 remaining=' + t2.remaining_seconds);
    console.log('  after unlock : paused_total=' + sUn.paused_total_seconds + '  cpi=' + sUn.current_period_index + '  status=' + sUn.status);
    console.log('  T3 remaining=' + t3.remaining_seconds);

  } finally {
    await c.query('rollback');
    console.log('\n(rolled back)');
  }

  console.log('\n✅ 0069 verified.');
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
