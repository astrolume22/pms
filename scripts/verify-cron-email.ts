/** Read-only checks: private.config lengths, cron job active, manager
 *  pool — so we can decide on a safe test recipient. Does NOT run the
 *  email test yet — just inspects.
 */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('=== private.config (lengths only — never log the secret) ===');
  const { rows: cfg } = await c.query<{ key: string; len: number; updated_at: string }>(`
    select key, length(value) as len, updated_at::text from private.config
     where key in ('cron_shared_secret','app_base_url')
     order by key`);
  for (const r of cfg) console.log('  ', r);
  if (cfg.length === 0) console.log('  (empty — secret not set DB-side)');

  console.log('\n=== cron.job active row ===');
  const { rows: jobs } = await c.query(
    `select jobid, jobname, schedule, active from cron.job where jobname='shift_break_sweep'`);
  for (const r of jobs) console.log('  ', r);

  console.log('\n=== latest cron.job_run_details (post-secret-set, sweep activity) ===');
  const { rows: runs } = await c.query<{ runid: number; status: string; return_message: string; start_time: string }>(`
    select runid, status, return_message, start_time::text
      from cron.job_run_details
     where jobid = (select jobid from cron.job where jobname='shift_break_sweep')
     order by start_time desc nulls last
     limit 5`);
  for (const r of runs) console.log('  ', r);

  console.log('\n=== candidate test recipients — list managers + email pattern ===');
  console.log('  (need user to choose one whose email is safe to send to)');
  const { rows: mgrs } = await c.query<{
    id: string; username: string; full_name: string | null; email: string; status: string;
  }>(`
    select id, username, full_name, email, status
      from public.users
     where role='manager' and status='active' and is_super_admin=false
     order by username`);
  for (const m of mgrs) {
    // Show masked email so the founder can identify but the log doesn't leak full addresses.
    const masked = m.email.replace(/^([a-z0-9])[^@]*(@.*)$/i, '$1***$2');
    console.log('  ', m.username, '(', m.full_name ?? '—', ') →', masked, ' status=' + m.status);
  }

  // Also check pg_net response inspection capability
  console.log('\n=== pg_net inspection schemas/tables ===');
  const { rows: netTbls } = await c.query<{ schemaname: string; tablename: string }>(`
    select schemaname, tablename from pg_tables
     where schemaname='net' order by tablename`);
  for (const t of netTbls) console.log('  ', t);

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
