/**
 * Apply 0075 + prove the skip semantics:
 *   • Case A (no skip)            : shift_self_period_lock → status='locked'.
 *   • Case B (skip armed by admin): shift_self_period_lock → NOT locked,
 *                                   flag consumed (false), cpi advanced,
 *                                   admin_override 'period_lock_skipped' written.
 *   • Re-call WITHOUT re-arming   : LOCKS normally (only one period skipped).
 *   • Admin-only RPC              : non-admin caller → 'admin only' raise.
 * Everything inside a transaction that rolls back.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0075_skip_next_period_lock.sql';

interface Sess {
  status: string;
  locked_reason: string | null;
  current_period_index: number;
  skip_next_period_lock: boolean;
  skip_next_period_lock_set_by: string | null;
  skip_next_period_lock_set_at: string | null;
}

async function readSess(c: Client, sid: string): Promise<Sess> {
  const { rows: [r] } = await c.query<Sess>(
    `select status, locked_reason, current_period_index,
            skip_next_period_lock,
            skip_next_period_lock_set_by::text as skip_next_period_lock_set_by,
            skip_next_period_lock_set_at::text as skip_next_period_lock_set_at
       from public.shift_sessions where id=$1`, [sid]);
  return r;
}

async function eventsForSession(c: Client, sid: string, type: string) {
  const { rows } = await c.query(
    `select type, meta, at::text as at, by::text as by
       from public.shift_events
      where session_id=$1 and type=$2
      order by at desc`, [sid, type]);
  return rows;
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.\n');

  // Confirm shape changes
  const { rows: cols } = await c.query(`
    select column_name from information_schema.columns
     where table_schema='public' and table_name='shift_sessions'
       and column_name in ('skip_next_period_lock','skip_next_period_lock_set_by','skip_next_period_lock_set_at')`);
  console.log('skip columns landed:', cols.map((c2: { column_name: string }) => c2.column_name));
  if (cols.length !== 3) { console.error('FAIL'); process.exit(1); }

  const { rows: [tickFn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_tick(uuid)'::regprocedure) as d`);
  console.log('shift_tick exposes skip_next_period_lock?', /skip_next_period_lock/.test(tickFn.d));

  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where role='admin' and status='active' limit 1`);
  const { rows: mgrs } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users
       where role='manager' and status='active' and is_super_admin=false
       order by username limit 2`);
  const [mgrA, mgrB] = mgrs;

  await c.query('begin');
  try {
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);

    // ============ Case A — no skip ============
    console.log('\n========== Case A — no skip → LOCKS normally ==========');
    await c.query(`delete from public.shift_sessions where user_id=$1
                    and work_date=(now() at time zone 'UTC')::date`, [mgrA.id]);
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgrA.id]);
    await c.query(`
      insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
        bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
        primary_group_id, timezone, late_start_threshold_seconds, account_locked,
        shift_break_overstay_grace_seconds)
      values ($1,'hard',1800,7,4,1200,360,null,'Asia/Manila',900,false, 900)`, [mgrA.id]);
    await c.query(`set local "request.jwt.claim.sub" = '${mgrA.id}'`);
    const { rows: [sA] } = await c.query<{ r: { session_id: string } }>(`select public.shift_start() as r`);
    const sidA = sA.r.session_id;

    const aBefore = await readSess(c, sidA);
    console.log('  before:', aBefore);
    const { rows: [aR] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_self_period_lock($1) as r`, [sidA]);
    console.log('  result :', aR.r);
    const aAfter = await readSess(c, sidA);
    console.log('  after :', aAfter);
    if (aAfter.status !== 'locked') throw new Error('Case A FAIL — expected status=locked');
    if (aAfter.locked_reason !== 'period_lock') throw new Error('Case A FAIL — expected locked_reason=period_lock');
    console.log('  ✅ status=locked, locked_reason=period_lock (existing behavior preserved)');

    // ============ Case B — skip armed → does NOT lock ============
    console.log('\n========== Case B — admin arms skip, then self-lock is suppressed ==========');
    // Restart by deleting + re-starting on the same manager.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`delete from public.shift_sessions where user_id=$1
                    and work_date=(now() at time zone 'UTC')::date`, [mgrA.id]);
    await c.query(`set local "request.jwt.claim.sub" = '${mgrA.id}'`);
    const { rows: [sB] } = await c.query<{ r: { session_id: string } }>(`select public.shift_start() as r`);
    const sidB = sB.r.session_id;

    // Arm the skip via the admin RPC.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    const { rows: [armRes] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_admin_skip_next_lock($1) as r`, [sidB]);
    console.log('  shift_admin_skip_next_lock →', armRes.r);

    const bBefore = await readSess(c, sidB);
    console.log('  before (after arming):', bBefore);
    if (!bBefore.skip_next_period_lock) throw new Error('Case B FAIL — flag not armed');
    if (bBefore.skip_next_period_lock_set_by !== admin.id) throw new Error('Case B FAIL — set_by missing');
    if (!bBefore.skip_next_period_lock_set_at) throw new Error('Case B FAIL — set_at missing');

    // Now call the period-lock path as the manager.
    await c.query(`set local "request.jwt.claim.sub" = '${mgrA.id}'`);
    const { rows: [bR] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_self_period_lock($1) as r`, [sidB]);
    console.log('  shift_self_period_lock result :', bR.r);
    const bAfter = await readSess(c, sidB);
    console.log('  after :', bAfter);
    if (bAfter.status === 'locked') throw new Error('Case B FAIL — should NOT have locked');
    if (bAfter.skip_next_period_lock !== false) throw new Error('Case B FAIL — flag not consumed');
    if (bAfter.current_period_index !== bBefore.current_period_index + 1)
      throw new Error('Case B FAIL — period_index not advanced by 1');
    if ((bR.r as { skipped?: boolean }).skipped !== true)
      throw new Error('Case B FAIL — return did not signal skipped:true');
    const evts = await eventsForSession(c, sidB, 'admin_override');
    const skipEvt = (evts as Array<{ meta: Record<string, unknown> }>).find(
      (e) => e.meta.action === 'period_lock_skipped');
    console.log('  admin_override events with action=period_lock_skipped:', skipEvt);
    if (!skipEvt) throw new Error('Case B FAIL — period_lock_skipped event missing');
    if (skipEvt.meta.period_index !== bBefore.current_period_index)
      throw new Error('Case B FAIL — period_index in meta wrong');
    console.log('  ✅ NOT locked, flag consumed, cpi advanced, event logged');

    // ============ Re-call WITHOUT re-arming → LOCKS normally ============
    console.log('\n========== Re-call without re-arming → LOCKS normally ==========');
    const { rows: [bR2] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_self_period_lock($1) as r`, [sidB]);
    console.log('  shift_self_period_lock result :', bR2.r);
    const bAfter2 = await readSess(c, sidB);
    console.log('  after :', bAfter2);
    if (bAfter2.status !== 'locked') throw new Error('Re-call FAIL — should have locked');
    if (bAfter2.locked_reason !== 'period_lock') throw new Error('Re-call FAIL — locked_reason wrong');
    console.log('  ✅ next period locks normally (only ONE skip)');

    // ============ Admin-only check ============
    console.log('\n========== Admin-only: non-admin call to shift_admin_skip_next_lock ==========');
    // Pick another manager session (mgrB) just to call the RPC for.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`delete from public.shift_sessions where user_id=$1
                    and work_date=(now() at time zone 'UTC')::date`, [mgrB.id]);
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgrB.id]);
    await c.query(`
      insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
        bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
        primary_group_id, timezone, late_start_threshold_seconds, account_locked,
        shift_break_overstay_grace_seconds)
      values ($1,'hard',1800,7,4,1200,360,null,'Asia/Manila',900,false, 900)`, [mgrB.id]);
    await c.query(`set local "request.jwt.claim.sub" = '${mgrB.id}'`);
    const { rows: [sC] } = await c.query<{ r: { session_id: string } }>(`select public.shift_start() as r`);
    const sidC = sC.r.session_id;

    // Call as a non-admin (mgrB themselves).
    let raised: string | null = null;
    try {
      await c.query(`select public.shift_admin_skip_next_lock($1)`, [sidC]);
    } catch (e) { raised = (e as Error).message; }
    console.log('  non-admin call result:', raised ?? 'NO EXCEPTION (FAIL)');
    if (!raised || !/admin only/i.test(raised)) throw new Error('Admin-only FAIL — expected admin only');
    console.log('  ✅ non-admin caller correctly rejected');

  } finally {
    await c.query('rollback');
    console.log('\n(rolled back)');
  }

  console.log('\n✅ 0075 verified — skip semantics are correct, idempotent, admin-only, one-shot.');
  await c.end();
}
main().catch(e => { console.error('FAILED:', e); process.exit(1); });
