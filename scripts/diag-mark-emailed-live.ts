import './loadEnv';
import { Client } from 'pg';
async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows: [fn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_mark_overstay_lock_emailed(uuid)'::regprocedure) as d`);
  console.log('=== LIVE shift_mark_overstay_lock_emailed ===');
  console.log(fn.d);

  const { rows: jr } = await c.query<{ runid: number; status: string; return_message: string; start_time: string }>(`
    select runid, status, return_message, start_time::text
      from cron.job_run_details
     where jobid = (select jobid from cron.job where jobname='shift_break_sweep')
     order by start_time desc limit 5`);
  console.log('\n=== latest 5 cron.job_run_details ===');
  for (const r of jr) console.log('  runid=' + r.runid + ' status=' + r.status + ' start=' + r.start_time + '\n    msg=' + r.return_message);

  await c.end();
}
main().catch(e => { console.error('FAILED:', e); process.exit(1); });
