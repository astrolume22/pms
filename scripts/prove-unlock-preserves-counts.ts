/**
 * Prove the fix: with the toggle OFF now calling ONLY shift_admin_unlock
 * (no shift_admin_rearm), a period-locked session resumes with break
 * counts + worked time PRESERVED, and the "Re-arm" path STILL resets
 * deliberately.
 *
 * Wrapped in a transaction that rolls back.
 */
import './loadEnv';
import { Client } from 'pg';

interface Row {
  bio: number; bio_total: number; sb: number; status: string;
  started: string; ppt: number; cpi: number;
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

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
    await c.query(
      `delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date`,
      [mgr.id],
    );
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgr.id]);
    await c.query(`
      insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
        bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
        primary_group_id, timezone, late_start_threshold_seconds, account_locked)
      values ($1,'hard',1800,7,4,1200,360,null,'Asia/Manila',900,false)`, [mgr.id]);

    // Start as the manager.
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [s] } = await c.query<{ r: { session_id: string } }>(
      `select public.shift_start() as r`,
    );
    const sid = s.r.session_id;

    // Seed: bio=3, bio_total=600s, sb=1, drive into period lock. Push
    // elapsed past the period boundary by setting started_at backwards
    // and current_period_index=0 so period_end = 1*period_seconds, and
    // shift_tick would naturally compute period_lock_due=true if we
    // were still in period 0.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    const { rows: [seedCfg] } = await c.query<{ period_seconds: number; required_seconds: number }>(
      `select period_seconds, required_seconds from public.shift_sessions where id=$1`, [sid],
    );
    await c.query(
      `update public.shift_sessions
         set bio_break_count_today          = 3,
             bio_break_total_seconds_today  = 600,
             shift_break_count_today        = 1,
             status                         = 'locked',
             current_period_index           = 0,
             started_at                     = now() - ($2::int + 5 || ' seconds')::interval,
             current_pause_started_at       = now(),
             current_pause_reason           = 'period_lock',
             locked_at                      = now(),
             locked_reason                  = 'period_lock',
             locked_by                      = null
       where id=$1`,
      [sid, seedCfg.period_seconds],
    );

    const before = await readRow(c, sid);
    console.log('===== BEFORE UNLOCK =====');
    console.log(before);

    // ----- NEW PATH (toggle OFF after the fix): only shift_admin_unlock -----
    await c.query(`select public.shift_admin_unlock($1)`, [sid]);

    const after = await readRow(c, sid);
    console.log('\n===== AFTER UNLOCK (new toggle path: unlock only) =====');
    console.log(after);

    // ----- Assertions -----
    if (after.bio !== before.bio) throw new Error('FAIL — bio_break_count_today changed: ' + before.bio + ' → ' + after.bio);
    if (after.sb  !== before.sb)  throw new Error('FAIL — shift_break_count_today changed: ' + before.sb + ' → ' + after.sb);
    if (after.bio_total !== before.bio_total) throw new Error('FAIL — bio_break_total_seconds_today changed');
    if (after.started !== before.started) throw new Error('FAIL — started_at changed');
    if (after.status !== 'active') throw new Error('FAIL — status not active');
    if (after.cpi !== before.cpi + 1) throw new Error('FAIL — current_period_index should have advanced by 1');
    console.log('\n  ✅ bio_break_count_today preserved (3)');
    console.log('  ✅ shift_break_count_today preserved (1)');
    console.log('  ✅ bio_break_total_seconds_today preserved (600)');
    console.log('  ✅ started_at preserved');
    console.log('  ✅ status = active');
    console.log('  ✅ current_period_index advanced ' + before.cpi + ' → ' + after.cpi);

    // ----- Verify shift_tick does NOT instantly re-lock -----
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [tickRow] } = await c.query<{ t: { status: string; period_lock_due: boolean; current_period_index: number } }>(
      `select public.shift_tick($1) as t`, [sid],
    );
    console.log('\n===== shift_tick post-unlock =====');
    console.log('  status            =', tickRow.t.status);
    console.log('  period_lock_due   =', tickRow.t.period_lock_due);
    console.log('  current_period_index =', tickRow.t.current_period_index);
    if (tickRow.t.status !== 'active') throw new Error('FAIL — tick status not active');
    if (tickRow.t.period_lock_due !== false) throw new Error('FAIL — tick period_lock_due should be false (advanced)');
    console.log('  ✅ tick does NOT immediately re-lock');

    // ----- Verify the Re-arm button STILL resets deliberately -----
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`select public.shift_admin_rearm($1)`, [sid]);
    const afterRearm = await readRow(c, sid);
    console.log('\n===== AFTER REARM (deliberate, the Re-arm button) =====');
    console.log(afterRearm);
    if (afterRearm.bio !== 0) throw new Error('FAIL — rearm should zero bio_break_count_today');
    if (afterRearm.bio_total !== 0) throw new Error('FAIL — rearm should zero bio_break_total_seconds_today');
    if (afterRearm.cpi !== 0) throw new Error('FAIL — rearm should reset current_period_index');
    if (afterRearm.ppt !== 0) throw new Error('FAIL — rearm should reset paused_total_seconds');
    console.log('\n  ✅ Re-arm path STILL resets counts/timer (deliberate behavior preserved)');

    console.log('\n========== SUMMARY ==========');
    console.log('  BEFORE     : bio=' + before.bio + ', sb=' + before.sb + ', bio_total=' + before.bio_total + ', cpi=' + before.cpi);
    console.log('  AFTER UNLOCK: bio=' + after.bio + ', sb=' + after.sb + ', bio_total=' + after.bio_total + ', cpi=' + after.cpi);
    console.log('  AFTER REARM : bio=' + afterRearm.bio + ', sb=' + afterRearm.sb + ', bio_total=' + afterRearm.bio_total + ', cpi=' + afterRearm.cpi);
  } finally {
    await c.query('rollback');
    console.log('\n(rolled back)');
  }

  console.log('\n✅ Fix verified.');
  await c.end();
}

async function readRow(c: Client, sid: string): Promise<Row> {
  const { rows: [r] } = await c.query<Row>(
    `select bio_break_count_today as bio,
            bio_break_total_seconds_today as bio_total,
            shift_break_count_today as sb,
            status,
            started_at::text as started,
            paused_total_seconds as ppt,
            current_period_index as cpi
       from public.shift_sessions where id=$1`, [sid],
  );
  return r;
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
