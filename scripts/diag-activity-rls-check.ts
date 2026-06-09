import './loadEnv';
import { Client } from 'pg';
async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  // Find a user who has events
  const { rows: [eu] } = await c.query<{ user_id: string }>(`
    select user_id from public.shift_events group by user_id order by count(*) desc limit 1`);
  console.log('user with most events:', eu.user_id);
  const { rows: [admin] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users where role='admin' and status='active' limit 1`);
  console.log('admin actor:', admin);

  // Verify cross-user read as admin under RLS
  await c.query('begin');
  try {
    await c.query(`set local role authenticated`);
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    const { rows: [n] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.shift_events where user_id = $1`, [eu.user_id]);
    console.log('  admin sees ' + n.n + ' shift_events for user ' + eu.user_id);
  } finally {
    await c.query('rollback');
  }
  await c.end();
}
main().catch(e=>{console.error(e); process.exit(1);});
