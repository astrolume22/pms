/** Check pg_cron availability + existing cron jobs + quote the live
 *  freeze/lock RPC bodies and the overstay math from shift_tick.
 */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // 1. pg_cron availability
  const { rows: exts } = await c.query<{ extname: string; extversion: string; nspname: string }>(`
    select e.extname, e.extversion, n.nspname
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname in ('pg_cron','pg_net')
     order by e.extname`);
  console.log('=== installed extensions (pg_cron, pg_net) ===');
  if (exts.length === 0) console.log('  none — pg_cron NOT installed');
  for (const e of exts) console.log('  ' + e.extname + ' ' + e.extversion + ' (schema=' + e.nspname + ')');

  // 2. Existing cron jobs
  if (exts.find((e) => e.extname === 'pg_cron')) {
    const { rows: jobs } = await c.query(`select jobid, schedule, command, jobname, active from cron.job order by jobid`);
    console.log('\n=== cron.job rows ===');
    if (jobs.length === 0) console.log('  (none)');
    for (const j of jobs) console.log(' ', j);
  } else {
    console.log('\n=== cron.job — N/A (pg_cron not installed) ===');
  }

  // 3. Live freeze + lock + tick bodies
  for (const fn of [
    'public.shift_break_freeze(uuid)',
    'public.shift_break_overstay_lock(uuid)',
    'public.shift_tick(uuid)',
  ]) {
    const { rows: [r] } = await c.query<{ d: string }>(
      `select pg_get_functiondef('${fn}'::regprocedure) as d`,
    );
    console.log('\n========================================');
    console.log('--- LIVE ' + fn);
    console.log('========================================');
    console.log(r.d);
  }

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
