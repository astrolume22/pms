import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('=== pg_cron extension row ===');
  const { rows: ext } = await c.query(
    `select extname, extversion from pg_extension where extname='pg_cron'`);
  for (const r of ext) console.log(' ', r);
  if (ext.length === 0) { console.log('  (NOT installed — STOP)'); await c.end(); return; }

  console.log('\n=== existing cron.job rows ===');
  const { rows: jobs } = await c.query(
    `select jobid, jobname, schedule, command, active from cron.job order by jobid`);
  if (jobs.length === 0) console.log('  (none)');
  for (const j of jobs) console.log(' ', j);

  console.log('\n=== shift_break_sweep RPC ===');
  const { rows: fns } = await c.query(
    `select proname, prosecdef from pg_proc where proname='shift_break_sweep'`);
  for (const r of fns) console.log(' ', r);

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
