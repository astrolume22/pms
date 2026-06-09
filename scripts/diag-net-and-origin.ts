import './loadEnv';
import { Client } from 'pg';
async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('=== net.http_post signatures ===');
  const { rows } = await c.query(`
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='net' and p.proname='http_post'`);
  for (const r of rows) console.log('  net.http_post(' + r.args + ')  →  ' + r.result);
  await c.end();
}
main().catch(e=>{console.error(e); process.exit(1);});
