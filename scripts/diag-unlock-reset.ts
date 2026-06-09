/**
 * Dump live defs + reproduce the founder's bug:
 *   manager has bio_break_count_today=3, shift_break_count_today=1,
 *   session is period-locked. Toggle OFF runs exactly:
 *       shift_admin_unlock(session_id)
 *       shift_admin_rearm(session_id)
 *   (the OFF branch in AdminShiftControlSection.runLockToggle).
 *   PROVE counts get reset (= rearm zeroing) and roll back.
 */
import './loadEnv';
import { Client } from 'pg';

interface Row { bio: number; sb: number; status: string; started: string; ppt: number; cpi: number }

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  for (const fn of [
    'public.shift_admin_unlock(uuid)',
    'public.shift_admin_rearm(uuid)',
    'public.shift_self_period_lock(uuid)',
    'public.shift_admin_set_account_lock(uuid, boolean)',
  ]) {
    const { rows: [r] } = await c.query<{ d: string }>(
      `select pg_get_functiondef('${fn}'::regprocedure) as d`,
    );
    console.log('========================================');
    console.log('--- LIVE ' + fn);
    console.log('========================================');
    console.log(r.d);
    console.log('');
  }

  // ---- REPRO ----
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

    // start shift as the manager
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [s] } = await c.query<{ r: { session_id: string } }>(
      `select public.shift_start() as r`,
    );
    const sid = s.r.session_id;

    // seed: bio_count=3, shift_break_count=1; drive into period lock
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(
      `update public.shift_sessions
         set bio_break_count_today = 3,
             bio_break_total_seconds_today = 600,
             shift_break_count_today = 1,
             status='locked',
             current_pause_started_at = now(),
             current_pause_reason = 'period_lock',
             locked_at = now(),
             locked_reason = 'period_lock',
             locked_by = null
       where id=$1`,
      [sid],
    );

    const { rows: [b] } = await c.query<Row>(
      `select bio_break_count_today as bio, shift_break_count_today as sb,
              status, started_at::text as started, paused_total_seconds as ppt,
              current_period_index as cpi
         from public.shift_sessions where id=$1`, [sid],
    );
    console.log('\n===== BEFORE UNLOCK =====');
    console.log(b);

    // Run EXACTLY what runLockToggle OFF runs for a period-locked session:
    //   shift_admin_unlock(sid) → shift_admin_rearm(sid)
    await c.query(`select public.shift_admin_unlock($1)`, [sid]);
    await c.query(`select public.shift_admin_rearm($1)`,  [sid]);

    const { rows: [a] } = await c.query<Row>(
      `select bio_break_count_today as bio, shift_break_count_today as sb,
              status, started_at::text as started, paused_total_seconds as ppt,
              current_period_index as cpi
         from public.shift_sessions where id=$1`, [sid],
    );
    console.log('\n===== AFTER UNLOCK + REARM (current toggle path) =====');
    console.log(a);
    console.log('\nbio reset?    ' + (b.bio !== a.bio));
    console.log('shift reset?  ' + (b.sb !== a.sb));
    console.log('started_at reset? ' + (b.started !== a.started));
    console.log('paused_total reset? ' + (b.ppt !== a.ppt));
    console.log('period_index reset? ' + (b.cpi !== a.cpi));
  } finally {
    await c.query('rollback');
    console.log('\n(rolled back)');
  }

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
