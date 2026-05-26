/** Apply 0044 — verify_current_password RPC. */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL!;
async function main() {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260526_0044_verify_current_password.sql'), 'utf8');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('OK: 0044 applied.');
    const { rows: [r] } = await c.query<{ exists: boolean; sd: boolean }>(
      `select exists (select 1 from pg_proc where proname='verify_current_password' and pronamespace='public'::regnamespace) as exists,
              (select prosecdef from pg_proc where proname='verify_current_password' and pronamespace='public'::regnamespace limit 1) as sd;`,
    );
    console.log('  verify_current_password exists?    ' + (r.exists ? 'YES' : 'NO'));
    console.log('  verify_current_password sec defin? ' + (r.sd ? 'YES' : 'NO'));
  } catch (e) { await c.query('rollback'); throw e; }
  finally { await c.end(); }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
