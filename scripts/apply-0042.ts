/**
 * One-shot applier for 0042 — auto-username on accept_invite +
 * admin_set_username + companion fix for Issue B (returned email).
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260526_0042_auto_username_and_admin_rename.sql'),
    'utf8',
  );
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('OK: 0042 applied.');

    // Sanity: accept_invite signature is 3-arg now.
    const { rows: acceptRows } = await c.query<{ argtypes: string }>(
      `select pg_get_function_identity_arguments(oid) as argtypes
         from pg_proc
        where proname = 'accept_invite'
          and pronamespace = 'public'::regnamespace
        order by 1;`,
    );
    console.log('  accept_invite signatures present:');
    for (const r of acceptRows) console.log('    - (' + r.argtypes + ')');

    const { rows: adminRows } = await c.query<{ exists: boolean; sd: boolean }>(
      `select exists (select 1 from pg_proc
                       where proname='admin_set_username'
                         and pronamespace='public'::regnamespace) as exists,
              (select prosecdef from pg_proc
                where proname='admin_set_username'
                  and pronamespace='public'::regnamespace
                limit 1) as sd;`,
    );
    console.log('  admin_set_username exists?    ' + (adminRows[0].exists ? 'YES' : 'NO'));
    console.log('  admin_set_username sec defin? ' + (adminRows[0].sd ? 'YES' : 'NO'));

    const { rows: helperRows } = await c.query<{ exists: boolean }>(
      `select exists (select 1 from pg_proc
                       where proname='_generate_unique_username'
                         and pronamespace='public'::regnamespace) as exists;`,
    );
    console.log('  _generate_unique_username?    ' + (helperRows[0].exists ? 'YES' : 'NO'));

    // Probe the helper: ensure it produces sane outputs for several inputs.
    for (const base of ['delivered', 'Some Person', 'admin', '', '!!!', 'a', 'verylongnamethatshouldnotbreakthelimit12345']) {
      const { rows: [r] } = await c.query<{ u: string }>(
        `select public._generate_unique_username($1) as u;`, [base],
      );
      console.log("  generate_unique_username(" + JSON.stringify(base) + ") = " + JSON.stringify(r.u));
    }
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
