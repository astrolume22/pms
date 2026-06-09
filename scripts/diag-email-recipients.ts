import './loadEnv';
import { Client } from 'pg';
async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: cols } = await c.query(`
    select column_name, data_type, is_nullable
      from information_schema.columns
     where table_schema='public' and table_name='users' and column_name in ('email','role','is_super_admin','status','full_name','username')
     order by column_name`);
  console.log('users columns:', cols);
  const { rows: lockFn } = await c.query<{ d: string }>(`
    select pg_get_functiondef('public.shift_break_overstay_lock(uuid)'::regprocedure) as d`);
  console.log('\nLIVE shift_break_overstay_lock:\n', lockFn[0].d);
  // Also check: are any active admins set up with emails?
  const { rows: admins } = await c.query(`
    select id, username, email, role, is_super_admin
      from public.users
     where status='active' and (role='admin' or is_super_admin=true)
     order by created_at limit 3`);
  console.log('\nactive admin candidates (first 3):', admins);
  // Are there managers with email?
  const { rows: mgrEmails } = await c.query(`
    select count(*) as total, count(email) filter (where email is not null and email <> '') as with_email
      from public.users where role='manager' and status='active' and is_super_admin=false`);
  console.log('manager email coverage:', mgrEmails);
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
