/**
 * Apply migration 0063 + prove the lazy mode resolution works:
 *
 *   1. Apply the migration (column add + 2 function replacements).
 *   2. Show the new shift_get_or_create_today_session() body so the
 *      CASE + v_effective_mode wiring is auditable.
 *   3. Simulate a brand-new manager inside a TRANSACTION that ROLLS
 *      BACK — first with hard_until in the future (expect HARD +
 *      period_seconds=3600), then with hard_until in the past (expect
 *      stored mode, period_seconds=10800). Nothing persists.
 *   4. Confirm the 16 pre-existing configs still have hard_until = NULL
 *      (no retro backfill).
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260608_0063_shift_hard_until_ramp.sql';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.');

  // ---------- 2. Show the new function body so the CASE wiring is auditable ----------
  console.log('\n========== shift_get_or_create_today_session() NEW BODY ==========');
  const { rows: [fn] } = await c.query<{ src: string }>(
    `select pg_get_functiondef(p.oid) as src
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='shift_get_or_create_today_session'`,
  );
  console.log(fn.src);

  // Quick sanity grep: v_effective_mode appears in both
  // _shift_period_seconds() and the INSERT, AND a CASE/hard_until appears.
  const hasCase = /hard_until\s+is\s+not\s+null\s+and[^;]*hard_until\s*>\s*now\(\)/i.test(fn.src);
  const usesEffectiveInPeriod = /_shift_period_seconds\(v_effective_mode\)/.test(fn.src);
  const usesEffectiveInInsert = /'not_started',\s+v_effective_mode,/.test(fn.src);
  console.log('\n  CASE on hard_until present?              ' + hasCase);
  console.log('  v_effective_mode → _shift_period_seconds?  ' + usesEffectiveInPeriod);
  console.log('  v_effective_mode → INSERT into snapshot?   ' + usesEffectiveInInsert);
  if (!hasCase || !usesEffectiveInPeriod || !usesEffectiveInInsert) {
    console.error('FAIL — new function body is missing expected lazy-resolution wiring.');
    process.exit(1);
  }

  // ---------- 3. Simulate (transaction that ROLLS BACK) ----------
  console.log('\n========== SIMULATION (transaction will be rolled back) ==========');
  // We need a real authenticated context for shift_get_or_create_today_session()
  // because it reads auth.uid(). Inside a transaction we can set the
  // request.jwt.claim.sub setting to fake an authenticated session.
  // We use the admin user as the simulated caller (already in users
  // table with status='active' — the function requires is_active_user()).
  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where username='admin' and status='active' limit 1`,
  );
  if (!admin) { console.log('admin user not found, cannot simulate'); process.exit(1); }
  console.log('Using admin user_id for simulation: ' + admin.id);

  await c.query('begin');
  try {
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);

    // Wipe any existing shift_config + today's session for admin INSIDE the
    // transaction so we start clean. Both will be rolled back.
    await c.query(`delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date`, [admin.id]);
    await c.query(`delete from public.shift_configs where user_id=$1`, [admin.id]);

    // ---- Case A: hard_until in the future → seed → expect HARD + 3600 ----
    console.log('\n  --- CASE A: hard_until = now() + interval \'14 days\' ---');
    await c.query(
      `insert into public.shift_configs (user_id, mode, hard_until)
         values ($1, 'medium', now() + interval '14 days')`,
      [admin.id],
    );
    const { rows: [seedA] } = await c.query<{ mode: string; period_seconds: number }>(
      `select mode, period_seconds from public.shift_get_or_create_today_session()`,
    );
    console.log('    snapshot → mode=' + seedA.mode + '  period_seconds=' + seedA.period_seconds);
    if (seedA.mode !== 'hard' || seedA.period_seconds !== 3600) {
      console.error('    FAIL — expected mode=hard, period_seconds=3600');
      throw new Error('Case A failed');
    }
    console.log('    ✅ HARD ramp honoured (period=3600)');

    // Wipe today's row + reset config for case B.
    await c.query(`delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date`, [admin.id]);
    await c.query(`update public.shift_configs set hard_until = now() - interval '1 day' where user_id=$1`, [admin.id]);

    // ---- Case B: hard_until in the past → seed → expect stored mode (medium) + 10800 ----
    console.log('\n  --- CASE B: hard_until = now() - interval \'1 day\' (ramp already over) ---');
    const { rows: [seedB] } = await c.query<{ mode: string; period_seconds: number }>(
      `select mode, period_seconds from public.shift_get_or_create_today_session()`,
    );
    console.log('    snapshot → mode=' + seedB.mode + '  period_seconds=' + seedB.period_seconds);
    if (seedB.mode !== 'medium' || seedB.period_seconds !== 10800) {
      console.error('    FAIL — expected mode=medium, period_seconds=10800');
      throw new Error('Case B failed');
    }
    console.log('    ✅ ramp expired → reverts to stored mode (medium, period=10800)');

    // ---- Case C: hard_until = null + stored mode = easy → expect easy + 14400 ----
    await c.query(`delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date`, [admin.id]);
    await c.query(`update public.shift_configs set mode='easy', hard_until=null where user_id=$1`, [admin.id]);
    console.log('\n  --- CASE C: hard_until = NULL, stored mode = easy ---');
    const { rows: [seedC] } = await c.query<{ mode: string; period_seconds: number }>(
      `select mode, period_seconds from public.shift_get_or_create_today_session()`,
    );
    console.log('    snapshot → mode=' + seedC.mode + '  period_seconds=' + seedC.period_seconds);
    if (seedC.mode !== 'easy' || seedC.period_seconds !== 14400) {
      console.error('    FAIL — expected mode=easy, period_seconds=14400');
      throw new Error('Case C failed');
    }
    console.log('    ✅ null ramp → reverts to stored mode (easy, period=14400)');
  } finally {
    await c.query('rollback');
    console.log('\n(simulation transaction rolled back — no data persisted)');
  }

  // ---------- 4. Existing rows still have hard_until = NULL ----------
  console.log('\n========== EXISTING 16 CONFIGS — hard_until BACKFILL CHECK ==========');
  const { rows: [counts] } = await c.query<{ total: string; null_ramp: string; with_ramp: string }>(
    `select
       count(*)::text as total,
       count(*) filter (where hard_until is null)::text as null_ramp,
       count(*) filter (where hard_until is not null)::text as with_ramp
       from public.shift_configs`,
  );
  console.log('  total rows: ' + counts.total + '  with hard_until=NULL: ' + counts.null_ramp + '  with ramp set: ' + counts.with_ramp);
  if (counts.with_ramp !== '0') {
    console.error('  FAIL — existing configs unexpectedly have hard_until set. Backfill leaked.');
    process.exit(1);
  }
  console.log('  ✅ all 16 existing rows still have hard_until = NULL (no retro backfill).');

  console.log('\n✅ 0063 verified.');
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
