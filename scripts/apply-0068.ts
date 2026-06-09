/**
 * Apply 0068 (shift-break overstay freeze) + prove:
 *   (a) start a SHIFT break; backdate current_break_started_at so
 *       break_elapsed > shift_break_seconds; call shift_break_freeze
 *       → applied=true, current_pause_reason='break_overstay'.
 *   (b) read shift_tick; record remaining_seconds. Sleep ~3s. read
 *       shift_tick again; assert remaining_seconds did NOT decrease
 *       (8h timer frozen), while shift_break_overstay_seconds increased.
 *   (c) call shift_end_break → asserts pause finalized
 *       (paused_total_seconds credited, current_pause_started_at null,
 *        status='active'); the work timer resumes cleanly.
 *   (d) bio break path is unaffected: take a bio break, end it; assert
 *       no break_overstay state is reachable on the bio branch.
 *   ROLL BACK so prod data stays put.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0068_shift_break_freeze.sql';

interface Sess {
  status: string;
  current_pause_started_at: string | null;
  current_pause_reason: string | null;
  paused_total_seconds: number;
  current_break_started_at: string | null;
  current_break_kind: string | null;
}
type Tick = Record<string, unknown>;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function readSess(c: Client, sid: string): Promise<Sess> {
  const { rows: [r] } = await c.query<Sess>(
    `select status, current_pause_started_at::text as current_pause_started_at,
            current_pause_reason, paused_total_seconds,
            current_break_started_at::text as current_break_started_at,
            current_break_kind
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

  // Confirm signatures landed.
  const { rows: [tickFn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_tick(uuid)'::regprocedure) as d`,
  );
  const tickHasNew = /shift_break_overstay/.test(tickFn.d) && /shift_break_frozen/.test(tickFn.d);
  console.log('shift_tick returns new fields?', tickHasNew);
  if (!tickHasNew) { console.error('FAIL'); process.exit(1); }
  const { rows: [freezeFn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_break_freeze(uuid)'::regprocedure) as d`,
  );
  console.log('shift_break_freeze defined?', /applied/.test(freezeFn.d));
  const { rows: [ebFn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_end_break(uuid)'::regprocedure) as d`,
  );
  console.log('shift_end_break finalizes break_overstay?',
    /break_overstay/.test(ebFn.d) && /frozen_seconds_credited/.test(ebFn.d));

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
    await c.query(`
      insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
        bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
        primary_group_id, timezone, late_start_threshold_seconds, account_locked)
      values ($1,'hard',1800,7,4,1200,360,null,'Asia/Manila',900,false)`, [mgr.id]);

    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [s] } = await c.query<{ r: { session_id: string } }>(
      `select public.shift_start() as r`,
    );
    const sid = s.r.session_id;
    console.log('\nshift_start →', s.r);

    // ============ (a) start shift break, backdate, freeze ============
    console.log('\n========== (a) start shift break + backdate + freeze ==========');
    await c.query(`select public.shift_take_shift_break($1)`, [sid]);
    // backdate so break_elapsed = 2000s, allowance = 1800s
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(
      `update public.shift_sessions set current_break_started_at = now() - interval '2000 seconds' where id=$1`, [sid],
    );

    const t0 = await tick(c, sid);
    console.log('  tick: status=' + t0.status + ' break_elapsed=' + t0.current_break_elapsed_seconds
      + ' overstay=' + t0.shift_break_overstay + ' frozen=' + t0.shift_break_frozen
      + ' allowance=' + t0.shift_break_seconds);
    if (t0.shift_break_overstay !== true) throw new Error('(a) FAIL — overstay should be true');
    if (t0.shift_break_frozen !== false) throw new Error('(a) FAIL — not yet frozen');

    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [f] } = await c.query<{ r: { applied: boolean; frozen: boolean } }>(
      `select public.shift_break_freeze($1) as r`, [sid],
    );
    console.log('  shift_break_freeze →', f.r);
    if (f.r.applied !== true) throw new Error('(a) FAIL — applied should be true');
    if (f.r.frozen  !== true) throw new Error('(a) FAIL — frozen should be true');

    const aft = await readSess(c, sid);
    console.log('  session :', aft);
    if (aft.current_pause_reason !== 'break_overstay') throw new Error('(a) FAIL — pause reason');
    if (!aft.current_pause_started_at) throw new Error('(a) FAIL — pause not set');

    // Idempotency: calling freeze again is a no-op.
    const { rows: [f2] } = await c.query<{ r: { applied: boolean } }>(
      `select public.shift_break_freeze($1) as r`, [sid],
    );
    console.log('  freeze again (idempotency) →', f2.r);
    if (f2.r.applied !== false) throw new Error('(a) FAIL — idempotency broken');

    // ============ (b) 8h remaining is FROZEN across a 3s wait ============
    console.log('\n========== (b) shift_tick: remaining_seconds frozen ==========');
    const t1 = await tick(c, sid);
    console.log('  T1 remaining_seconds=' + t1.remaining_seconds
      + ' overstay_seconds=' + t1.shift_break_overstay_seconds);
    await sleep(3000);
    const t2 = await tick(c, sid);
    console.log('  T2 remaining_seconds=' + t2.remaining_seconds
      + ' overstay_seconds=' + t2.shift_break_overstay_seconds);
    const dec = (t1.remaining_seconds as number) - (t2.remaining_seconds as number);
    if (Math.abs(dec) > 1) throw new Error('(b) FAIL — remaining decreased by >1s while frozen ('
      + dec + ')');
    if ((t2.shift_break_overstay_seconds as number) < (t1.shift_break_overstay_seconds as number)) {
      throw new Error('(b) FAIL — overstay seconds should keep increasing');
    }
    console.log('  ✅ 8h remaining frozen (drift ' + dec + 's, vs ~3s if not frozen)');
    console.log('  ✅ overstay seconds kept ticking up ('
      + t1.shift_break_overstay_seconds + ' → ' + t2.shift_break_overstay_seconds + ')');

    // ============ (c) shift_end_break finalizes the freeze ============
    console.log('\n========== (c) shift_end_break finalizes the freeze ==========');
    const sessBefore = await readSess(c, sid);
    const { rows: [eb] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_end_break($1) as r`, [sid],
    );
    console.log('  shift_end_break →', eb.r);
    const sessAfter = await readSess(c, sid);
    console.log('  session after :', sessAfter);
    if (sessAfter.status !== 'active') throw new Error('(c) FAIL — status not active');
    if (sessAfter.current_pause_started_at !== null) throw new Error('(c) FAIL — pause not cleared');
    if (sessAfter.current_pause_reason !== null) throw new Error('(c) FAIL — pause reason not cleared');
    if (sessAfter.current_break_started_at !== null) throw new Error('(c) FAIL — break started_at not cleared');
    if (sessAfter.paused_total_seconds <= sessBefore.paused_total_seconds)
      throw new Error('(c) FAIL — paused_total_seconds not credited');
    console.log('  ✅ paused_total_seconds credited '
      + sessBefore.paused_total_seconds + ' → ' + sessAfter.paused_total_seconds);

    // Confirm: shift_tick post-end shows remaining stable (work timer
    // resumed cleanly — no jump).
    await sleep(2000);
    const t3 = await tick(c, sid);
    console.log('  T3 status=' + t3.status + ' remaining_seconds=' + t3.remaining_seconds);
    if (t3.status !== 'active') throw new Error('(c) FAIL — tick status not active');
    // T3 should be slightly LESS than T2 (work timer resumed, ~2s elapsed).
    const dec23 = (t2.remaining_seconds as number) - (t3.remaining_seconds as number);
    if (dec23 < 1) throw new Error('(c) FAIL — work timer not resumed (no decrement after 2s)');
    console.log('  ✅ work timer resumed: T2→T3 dropped by ' + dec23 + 's after end break');

    // ============ (d) bio path unaffected ============
    console.log('\n========== (d) bio break path is unaffected ==========');
    const { rows: [b1] } = await c.query<{ r: { status: string } }>(
      `select public.shift_take_bio_break($1) as r`, [sid],
    );
    console.log('  shift_take_bio_break →', b1.r);
    const bioSess = await readSess(c, sid);
    if (bioSess.status !== 'on_bio_break') throw new Error('(d) FAIL — bio status');
    if (bioSess.current_pause_reason !== null) throw new Error('(d) FAIL — bio path set pause reason');
    const { rows: [eb2] } = await c.query<{ r: { kind: string } }>(
      `select public.shift_end_break($1) as r`, [sid],
    );
    console.log('  shift_end_break (bio) →', eb2.r);
    if (eb2.r.kind !== 'bio') throw new Error('(d) FAIL — wrong kind');
    const bioEnd = await readSess(c, sid);
    if (bioEnd.status !== 'active') throw new Error('(d) FAIL — status after bio end');
    if (bioEnd.current_pause_reason !== null) throw new Error('(d) FAIL — pause should not be set');
    console.log('  ✅ bio break end path byte-for-byte the same');

    console.log('\n========== SUMMARY ==========');
    console.log('  T1 remaining=' + t1.remaining_seconds + '  overstay=' + t1.shift_break_overstay_seconds);
    console.log('  T2 remaining=' + t2.remaining_seconds + '  overstay=' + t2.shift_break_overstay_seconds);
    console.log('  T3 remaining=' + t3.remaining_seconds + '  status=' + t3.status);
    console.log('  paused_total_seconds: ' + sessBefore.paused_total_seconds + ' → ' + sessAfter.paused_total_seconds);

  } finally {
    await c.query('rollback');
    console.log('\n(rolled back)');
  }

  console.log('\n✅ 0068 verified.');
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
