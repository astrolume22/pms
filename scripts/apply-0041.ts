/**
 * One-shot applier for 0041 — resolve_login_email RPC.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260526_0041_resolve_login_email.sql'),
    'utf8',
  );
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('OK: 0041 applied.');

    // Sanity: function exists, security definer, grants to anon+authenticated.
    const { rows: [fn] } = await c.query<{ def: string }>(
      `select pg_get_functiondef(oid) as def from pg_proc
        where proname = 'resolve_login_email' and pronamespace = 'public'::regnamespace;`,
    );
    console.log('  function defined? ' + (fn ? 'YES' : 'NO'));
    console.log('  SECURITY DEFINER?  ' + (/SECURITY DEFINER/i.test(fn?.def ?? '') ? 'YES' : 'NO'));

    const { rows: acls } = await c.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.routine_privileges
        where routine_schema='public' and routine_name='resolve_login_email';`,
    );
    console.log('  grants:');
    for (const a of acls) console.log('   - ' + a.grantee + ' / ' + a.privilege_type);

    // Live smoke: known admin user.
    const { rows: [r1] } = await c.query<{ email: string | null }>(
      `select public.resolve_login_email('admin') as email;`,
    );
    console.log("  resolve_login_email('admin')             = " + JSON.stringify(r1.email));

    const { rows: [r2] } = await c.query<{ email: string | null }>(
      `select public.resolve_login_email('admin@pms.internal') as email;`,
    );
    console.log("  resolve_login_email('admin@pms.internal')= " + JSON.stringify(r2.email));

    const { rows: [r3] } = await c.query<{ email: string | null }>(
      `select public.resolve_login_email('nope_definitely_not_a_user_xyz') as email;`,
    );
    console.log("  resolve_login_email('nope...')           = " + JSON.stringify(r3.email));

    const { rows: [r4] } = await c.query<{ email: string | null }>(
      `select public.resolve_login_email('') as email;`,
    );
    console.log("  resolve_login_email('')                  = " + JSON.stringify(r4.email));
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
