/** Apply 0045 — set_my_password RPC + smoke test. */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const url = process.env.DATABASE_URL!;

async function main() {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260526_0045_set_my_password.sql'),
    'utf8',
  );
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('OK: 0045 applied.');

    const { rows: [r] } = await c.query<{ exists: boolean; sd: boolean }>(
      `select exists (select 1 from pg_proc where proname='set_my_password' and pronamespace='public'::regnamespace) as exists,
              (select prosecdef from pg_proc where proname='set_my_password' and pronamespace='public'::regnamespace limit 1) as sd;`,
    );
    console.log('  set_my_password exists?     ' + (r.exists ? 'YES' : 'NO'));
    console.log('  set_my_password sec defin?  ' + (r.sd ? 'YES' : 'NO'));

    // Smoke test: sign in as admin, set password to admin1234 (no-op), verify still works.
    const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const s1 = await sb.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });
    console.log('  signin admin1234 -> ' + (s1.data?.session ? 'OK' : 'FAIL'));

    const setResp = await sb.rpc('set_my_password', { p_new_password: 'admin1234' });
    console.log('  set_my_password(admin1234) -> err=' + (setResp.error?.message ?? 'none'));

    const sb2 = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const s2 = await sb2.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });
    console.log('  re-signin admin1234 -> ' + (s2.data?.session ? 'OK' : 'FAIL'));
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
