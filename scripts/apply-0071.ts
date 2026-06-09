/**
 * Apply 0071 + prove the sweep:
 *   • Session X: 1 manager, on shift break, break_elapsed between
 *                allowance and allowance+grace → FREEZE-eligible only.
 *   • Session Y: 1 manager, on shift break, break_elapsed past
 *                allowance+grace → LOCK-eligible.
 *   • Session Z: 1 manager, active (no break) → SHOULD BE UNTOUCHED.
 *   • Bio_break_count_today / shift_break_count_today / started_at must
 *     stay unchanged on every session.
 *   • Run shift_break_sweep() ONCE → expect frozen_count=1, locked_count=1;
 *     assert X frozen, Y locked, Z unchanged. Bio/shift counts preserved.
 *   • Run AGAIN → expect frozen_count=0, locked_count=0 (idempotent), no
 *     state changes.
 *   • Roll back.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0071_server_break_sweep.sql';

interface Sess {
  user_id: string;
  status: string;
  current_break_kind: string | null;
  current_break_started_at: string | null;
  current_pause_started_at: string | null;
  current_pause_reason: string | null;
  paused_total_seconds: number;
  locked_reason: string | null;
  bio_break_count_today: number;
  shift_break_count_today: number;
  started_at: string;
}

async function readSess(c: Client, sid: string): Promise<Sess> {
  const { rows: [r] } = await c.query<Sess>(
    `select user_id, status, current_break_kind,
            current_break_started_at::text as current_break_started_at,
            current_pause_started_at::text as current_pause_started_at,
            current_pause_reason, paused_total_seconds, locked_reason,
            bio_break_count_today, shift_break_count_today,
            started_at::text as started_at
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

  // Verify the function landed
  const { rows: [fnRow] } = await c.query<{ exists: boolean }>(`
    select exists(
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='shift_break_sweep'
    ) as exists`);
  console.log('shift_break_sweep() exists?', fnRow.exists);
  if (!fnRow.exists) { console.error('FAIL'); process.exit(1); }

  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where role='admin' and status='active' limit 1`);
  const { rows: mgrs } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users
       where role='manager' and status='active' and is_super_admin=false
       order by username limit 3`);
  if (mgrs.length < 3) { console.error('FAIL — need 3 managers'); process.exit(1); }
  console.log('managers:', mgrs.map(m => m.username).join(', '));

  await c.query('begin');
  try {
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);

    // Wipe + reseed configs/sessions for all 3 managers.
    for (const m of mgrs) {
      await c.query(`delete from public.shift_sessions where user_id=$1
                      and work_date=(now() at time zone 'UTC')::date`, [m.id]);
      await c.query(`delete from public.shift_configs where user_id=$1`, [m.id]);
      // allowance = 1800 (30 min), grace = 900 (15 min)
      await c.query(`
        insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
          bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
          primary_group_id, timezone, late_start_threshold_seconds, account_locked,
          shift_break_overstay_grace_seconds)
        values ($1,'hard',1800,7,4,1200,360,null,'Asia/Manila',900,false, 900)`, [m.id]);
    }

    // Start sessions for all 3.
    const sids: { x: string; y: string; z: string } = { x: '', y: '', z: '' };
    for (const [tag, m] of [['x', mgrs[0]], ['y', mgrs[1]], ['z', mgrs[2]]] as const) {
      await c.query(`set local "request.jwt.claim.sub" = '${m.id}'`);
      const { rows: [s] } = await c.query<{ r: { session_id: string } }>(
        `select public.shift_start() as r`);
      sids[tag] = s.r.session_id;
    }
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);

    // Set non-zero bio/shift break counts on all 3 to prove the sweep
    // does NOT zero them out.
    await c.query(`update public.shift_sessions
                      set bio_break_count_today=2, shift_break_count_today=0
                    where id = any($1)`, [[sids.x, sids.y, sids.z]]);

    // Drive X into shift break, backdate so break_elapsed = 2000s
    // (allowance=1800, allowance+grace=2700; X is in [1800, 2700) → FREEZE).
    await c.query(`set local "request.jwt.claim.sub" = '${mgrs[0].id}'`);
    await c.query(`select public.shift_take_shift_break($1)`, [sids.x]);
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`update public.shift_sessions
                      set current_break_started_at = now() - interval '2000 seconds'
                    where id=$1`, [sids.x]);

    // Drive Y into shift break, backdate so break_elapsed = 2800s → LOCK.
    await c.query(`set local "request.jwt.claim.sub" = '${mgrs[1].id}'`);
    await c.query(`select public.shift_take_shift_break($1)`, [sids.y]);
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`update public.shift_sessions
                      set current_break_started_at = now() - interval '2800 seconds'
                    where id=$1`, [sids.y]);

    // Z stays active (no break).

    const xBefore = await readSess(c, sids.x);
    const yBefore = await readSess(c, sids.y);
    const zBefore = await readSess(c, sids.z);
    console.log('\n===== BEFORE SWEEP =====');
    console.log('  X (freeze-eligible):', summarize(xBefore));
    console.log('  Y (lock-eligible)  :', summarize(yBefore));
    console.log('  Z (active control) :', summarize(zBefore));

    // ===== First sweep =====
    const { rows: [r1] } = await c.query<{ r: { frozen_count: number; locked_count: number } }>(
      `select public.shift_break_sweep() as r`);
    console.log('\n===== shift_break_sweep() 1st call =====');
    console.log('  returned:', r1.r);
    if (r1.r.frozen_count !== 1) throw new Error('FAIL — expected frozen_count=1, got ' + r1.r.frozen_count);
    if (r1.r.locked_count !== 1) throw new Error('FAIL — expected locked_count=1, got ' + r1.r.locked_count);

    const xAfter = await readSess(c, sids.x);
    const yAfter = await readSess(c, sids.y);
    const zAfter = await readSess(c, sids.z);
    console.log('\n===== AFTER FIRST SWEEP =====');
    console.log('  X:', summarize(xAfter));
    console.log('  Y:', summarize(yAfter));
    console.log('  Z:', summarize(zAfter));

    // X assertions: frozen but still on_shift_break.
    if (xAfter.status !== 'on_shift_break') throw new Error('X FAIL — should still be on shift break');
    if (xAfter.current_pause_reason !== 'break_overstay') throw new Error('X FAIL — pause reason');
    if (!xAfter.current_pause_started_at) throw new Error('X FAIL — pause should be open');
    if (xAfter.current_break_started_at !== xBefore.current_break_started_at)
      throw new Error('X FAIL — break_started should not have changed');
    if (xAfter.bio_break_count_today !== xBefore.bio_break_count_today)
      throw new Error('X FAIL — bio_break_count changed');
    if (xAfter.shift_break_count_today !== xBefore.shift_break_count_today)
      throw new Error('X FAIL — shift_break_count changed');
    if (xAfter.started_at !== xBefore.started_at) throw new Error('X FAIL — started_at changed');
    console.log('  ✅ X is FROZEN (status=on_shift_break, pause_reason=break_overstay), break counts + started_at preserved');

    // Y assertions: locked.
    if (yAfter.status !== 'locked') throw new Error('Y FAIL — should be locked');
    if (yAfter.locked_reason !== 'break_overstay') throw new Error('Y FAIL — locked_reason');
    if (yAfter.current_break_started_at !== null) throw new Error('Y FAIL — break_started not cleared');
    if (yAfter.current_break_kind !== null) throw new Error('Y FAIL — break_kind not cleared');
    if (yAfter.current_pause_reason !== 'break_overstay') throw new Error('Y FAIL — fresh pause not opened');
    if (!yAfter.current_pause_started_at) throw new Error('Y FAIL — fresh pause has no start time');
    if (yAfter.bio_break_count_today !== yBefore.bio_break_count_today)
      throw new Error('Y FAIL — bio_break_count changed');
    if (yAfter.shift_break_count_today !== yBefore.shift_break_count_today)
      throw new Error('Y FAIL — shift_break_count changed');
    if (yAfter.started_at !== yBefore.started_at) throw new Error('Y FAIL — started_at changed');
    console.log('  ✅ Y is LOCKED (status=locked, locked_reason=break_overstay, fresh pause open), counts + started_at preserved');

    // Z assertions: completely untouched.
    if (JSON.stringify(zAfter) !== JSON.stringify(zBefore)) {
      console.log('  Z BEFORE:', zBefore);
      console.log('  Z AFTER :', zAfter);
      throw new Error('Z FAIL — non-eligible session was changed');
    }
    console.log('  ✅ Z (active, no break) UNCHANGED');

    // ===== Second sweep — idempotency =====
    const { rows: [r2] } = await c.query<{ r: { frozen_count: number; locked_count: number } }>(
      `select public.shift_break_sweep() as r`);
    console.log('\n===== shift_break_sweep() 2nd call (idempotency) =====');
    console.log('  returned:', r2.r);
    if (r2.r.frozen_count !== 0) throw new Error('FAIL — second sweep should freeze 0');
    if (r2.r.locked_count !== 0) throw new Error('FAIL — second sweep should lock 0');

    const x2 = await readSess(c, sids.x);
    const y2 = await readSess(c, sids.y);
    const z2 = await readSess(c, sids.z);
    if (x2.current_pause_started_at !== xAfter.current_pause_started_at)
      throw new Error('FAIL — X pause start moved on 2nd sweep');
    if (x2.status !== 'on_shift_break') throw new Error('FAIL — X status changed on 2nd sweep');
    if (y2.status !== 'locked') throw new Error('FAIL — Y status changed on 2nd sweep');
    if (JSON.stringify(z2) !== JSON.stringify(zAfter)) throw new Error('FAIL — Z changed on 2nd sweep');
    console.log('  ✅ idempotent — no state changes on the second call');

    console.log('\n========== SUMMARY ==========');
    console.log('  X: ' + xBefore.status + ' / no pause' + ' → ' + xAfter.status + ' / pause=' + xAfter.current_pause_reason);
    console.log('  Y: ' + yBefore.status + ' / no pause' + ' → ' + yAfter.status + ' / locked_reason=' + yAfter.locked_reason);
    console.log('  Z: ' + zBefore.status + ' → ' + zAfter.status + ' (unchanged)');
    console.log('  1st sweep: frozen=' + r1.r.frozen_count + ' locked=' + r1.r.locked_count);
    console.log('  2nd sweep: frozen=' + r2.r.frozen_count + ' locked=' + r2.r.locked_count);

  } finally {
    await c.query('rollback');
    console.log('\n(rolled back)');
  }

  console.log('\n✅ 0071 verified — sweep freezes / locks correctly, idempotent, leaves unrelated sessions alone.');
  await c.end();
}

function summarize(s: Sess): string {
  return 'status=' + s.status
    + ' break_kind=' + s.current_break_kind
    + ' pause_reason=' + s.current_pause_reason
    + ' locked_reason=' + s.locked_reason
    + ' bio=' + s.bio_break_count_today
    + ' sb=' + s.shift_break_count_today;
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
