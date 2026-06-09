import './loadEnv';
import { Client } from 'pg';
async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: [mgr] } = await c.query<{ id: string; email: string }>(
    `select id, email from public.users where username='rtester'`);
  const { rows: [sessChk] } = await c.query<{ n: string }>(
    `select count(*)::text as n from public.shift_sessions where user_id=$1
        and work_date=(now() at time zone 'UTC')::date`, [mgr.id]);
  const { rows: [cfgChk] } = await c.query<{ n: string }>(
    `select count(*)::text as n from public.shift_configs where user_id=$1`, [mgr.id]);
  console.log('rtester sessions today:', sessChk.n, ' (expect 0)');
  console.log('rtester shift_configs :', cfgChk.n, ' (expect 0)');
  // Also: any test-related shift_events for rtester today?
  const { rows: [evChk] } = await c.query<{ n: string }>(
    `select count(*)::text as n from public.shift_events
      where user_id=$1 and at::date = (now() at time zone 'UTC')::date`, [mgr.id]);
  console.log('rtester events today  :', evChk.n);
  await c.end();
}
main().catch(e=>{console.error(e); process.exit(1);});
