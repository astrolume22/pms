/**
 * Apply migration 0064 + prove it works:
 *   - new columns on shift_configs (NOT NULL DEFAULT false for the bool)
 *   - shift_admin_set_account_lock RPC exists, admin-only, audits, upserts
 *   - shift_start() raises 'account locked' (42501) when the flag is true
 *   - shift_start() proceeds normally when the flag is false
 *   - shift_my_account_lock() returns the self-only jsonb
 *   - 16 existing configs all have account_locked=false after migration
 *
 * The lock/unlock + shift_start simulation runs inside a TRANSACTION that
 * ROLLS BACK so nothing persists.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260608_0064_account_lock.sql';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.');

  // ---- 1. Confirm new columns ----
  const { rows: newCols } = await c.query(
    `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema='public' and table_name='shift_configs'
        and column_name in ('account_locked','account_locked_at','account_locked_by')
      order by column_name`,
  );
  console.log('\n========== new columns ==========');
  for (const r of newCols) {
    console.log('  ' + r.column_name + '  ' + r.data_type + '  nullable=' + r.is_nullable + '  default=' + (r.column_default ?? '—'));
  }

  // ---- 2. Confirm RPC bodies ----
  console.log('\n========== shift_admin_set_account_lock BODY ==========');
  const { rows: [rpcA] } = await c.query<{ src: string }>(
    `select pg_get_functiondef(p.oid) as src
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='shift_admin_set_account_lock'`,
  );
  console.log(rpcA.src);

  console.log('\n========== shift_start (NEW account_locked guard) — relevant slice ==========');
  const { rows: [rpcStart] } = await c.query<{ src: string }>(
    `select pg_get_functiondef(p.oid) as src
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='shift_start'`,
  );
  // Show the first 35 lines so the guard is visible without flooding output.
  console.log(rpcStart.src.split('\n').slice(0, 35).join('\n'));
  const hasGuard = /raise exception 'account locked' using errcode='42501'/i.test(rpcStart.src);
  console.log('\n  ✓ account_locked guard present? ' + hasGuard);

  console.log('\n========== shift_my_account_lock BODY ==========');
  const { rows: [rpcMy] } = await c.query<{ src: string }>(
    `select pg_get_functiondef(p.oid) as src
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='shift_my_account_lock'`,
  );
  console.log(rpcMy.src);

  if (!hasGuard) { console.error('FAIL — new guard not detected.'); process.exit(1); }

  // ---- 3. Existing 16 configs unchanged ----
  console.log('\n========== EXISTING CONFIGS — account_locked backfill ==========');
  const { rows: [counts] } = await c.query<{ total: string; n_unlocked: string; n_locked: string }>(
    `select count(*)::text as total,
            count(*) filter (where account_locked = false)::text as n_unlocked,
            count(*) filter (where account_locked = true)::text  as n_locked
       from public.shift_configs`,
  );
  console.log('  total=' + counts.total + '  unlocked=' + counts.n_unlocked + '  locked=' + counts.n_locked);
  if (counts.n_locked !== '0') {
    console.error('  FAIL — some configs ended up locked. Backfill leaked.');
    process.exit(1);
  }
  console.log('  ✅ all configs remain unlocked (no retro backfill)');

  // ---- 4. Rollback simulation — lock, try start, unlock, try start ----
  console.log('\n========== ROLLBACK SIMULATION ==========');
  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where username='admin' and status='active' limit 1`,
  );
  if (!admin) { console.error('admin user not found'); process.exit(1); }
  console.log('Using admin as the test caller: ' + admin.id);

  await c.query('begin');
  try {
    // Authenticate as admin for the duration of the transaction.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);

    // Wipe today's session + config for admin so the start path is fresh.
    await c.query(
      `delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date`,
      [admin.id],
    );
    await c.query(`delete from public.shift_configs where user_id=$1`, [admin.id]);

    // ---- Case A: admin locks themselves via the new RPC; shift_start refuses ----
    console.log('\n  --- CASE A: lock self via shift_admin_set_account_lock, then start ---');
    const { rows: [lockA] } = await c.query<{ ok: unknown }>(
      `select public.shift_admin_set_account_lock($1, true) as ok`, [admin.id],
    );
    console.log('    set_account_lock(true) →', lockA.ok);

    // PG aborts the whole txn on any raise — use a SAVEPOINT so we can
    // recover and keep running the rest of the simulation.
    await c.query('savepoint expect_lock');
    let raisedA: string | null = null;
    try {
      await c.query(`select public.shift_start()`);
    } catch (e) {
      raisedA = (e as Error).message ?? String(e);
      await c.query('rollback to savepoint expect_lock');
    }
    await c.query('release savepoint expect_lock');
    console.log('    shift_start() →', raisedA ?? 'NO EXCEPTION (FAIL)');
    if (!raisedA || !/account locked/i.test(raisedA)) {
      throw new Error('Case A failed: expected account-locked exception');
    }
    console.log('    ✅ shift_start raised "account locked" (42501)');

    // ---- Confirm shift_my_account_lock returns the locked state ----
    const { rows: [myA] } = await c.query<{ res: { account_locked: boolean; account_locked_at: string | null } }>(
      `select public.shift_my_account_lock() as res`,
    );
    console.log('    shift_my_account_lock() →', myA.res);
    if (myA.res.account_locked !== true) throw new Error('Case A: shift_my_account_lock should report locked=true');

    // ---- Case B: unlock + retry shift_start → succeeds ----
    console.log('\n  --- CASE B: unlock, retry start ---');
    await c.query(`select public.shift_admin_set_account_lock($1, false)`, [admin.id]);
    // Wipe any session that snuck in (shouldn't have, but be defensive).
    await c.query(
      `delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date`,
      [admin.id],
    );
    const { rows: [startB] } = await c.query<{ ok: { session_id: string; started_at: string } }>(
      `select public.shift_start() as ok`,
    );
    console.log('    shift_start() →', startB.ok);
    if (!startB.ok?.session_id) throw new Error('Case B failed: shift_start did not produce a session');
    console.log('    ✅ shift_start proceeded normally after unlock');

    // ---- Verify shift_events captured both audit rows ----
    const { rows: events } = await c.query<{ type: string; meta: { action?: string } }>(
      `select type, meta from public.shift_events
        where user_id=$1 and type='admin_override'
        order by at desc
        limit 2`,
      [admin.id],
    );
    console.log('\n    Last 2 admin_override events for this user:');
    for (const e of events) console.log('      type=' + e.type + '  action=' + (e.meta?.action ?? '?'));
    const actions = events.map((e) => e.meta?.action ?? '');
    if (!actions.includes('account_lock') || !actions.includes('account_unlock')) {
      throw new Error('Audit failed: expected both account_lock and account_unlock events');
    }
    console.log('    ✅ both account_lock and account_unlock audit rows present');

    // ---- Case C: shift_admin_set_account_lock by a non-admin caller should refuse ----
    console.log('\n  --- CASE C: non-admin caller cannot lock ---');
    // Pick a non-admin active manager.
    const { rows: [mgr] } = await c.query<{ id: string }>(
      `select id from public.users where role='manager' and status='active' and is_super_admin=false limit 1`,
    );
    if (mgr) {
      // Re-set the jwt claim sub to the manager (within this transaction).
      await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
      await c.query('savepoint expect_admin_only');
      let raisedC: string | null = null;
      try {
        await c.query(`select public.shift_admin_set_account_lock($1, true)`, [admin.id]);
      } catch (e) {
        raisedC = (e as Error).message ?? String(e);
        await c.query('rollback to savepoint expect_admin_only');
      }
      await c.query('release savepoint expect_admin_only');
      console.log('    shift_admin_set_account_lock by manager →', raisedC ?? 'NO EXCEPTION (FAIL)');
      if (!raisedC || !/admin only/i.test(raisedC)) throw new Error('Case C failed: expected admin-only exception');
      console.log('    ✅ non-admin call refused with "admin only"');
    } else {
      console.log('    (no non-admin manager available to test — skipping)');
    }

  } finally {
    await c.query('rollback');
    console.log('\n(simulation transaction rolled back — no data persisted)');
  }

  // ---- 5. Confirm 16 existing configs STILL unlocked after rollback ----
  const { rows: [recheck] } = await c.query<{ total: string; n_locked: string }>(
    `select count(*)::text as total, count(*) filter (where account_locked=true)::text as n_locked
       from public.shift_configs`,
  );
  console.log('\nFinal state: total=' + recheck.total + '  locked=' + recheck.n_locked);
  if (recheck.n_locked !== '0') {
    console.error('  FAIL — a config row remained locked after rollback');
    process.exit(1);
  }

  console.log('\n✅ 0064 verified — migration safe, server guard works, RPCs operate as specified.');
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
