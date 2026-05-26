/**
 * One-shot applier for 0039 — widen create_invite roles.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260524_0039_invite_allow_all_roles.sql'), 'utf8');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('✅ 0039 applied.');
    // Sanity — assert the manager-only gate is gone + the INSERT uses p_role.
    const { rows: [r] } = await c.query<{ def: string }>(
      `select pg_get_functiondef(oid) as def from pg_proc where proname = 'create_invite' and pronamespace = 'public'::regnamespace;`
    );
    const def = r.def;
    const hasOldGate = /if\s+p_role\s*<>\s*'manager'/i.test(def);
    const hasOldInsert = /values\s*\(\s*v_token\s*,\s*'manager'\s*,/i.test(def);
    const hasNewValidation = /p_role\s+not\s+in\s*\(\s*'admin'\s*,\s*'manager'\s*,\s*'viewer'\s*\)/i.test(def);
    const hasNewInsert = /values\s*\(\s*v_token\s*,\s*p_role\s*,/i.test(def);
    console.log(`  manager-only gate gone?      ${hasOldGate ? 'NO (FAIL)' : 'YES'}`);
    console.log(`  hardcoded 'manager' INSERT?  ${hasOldInsert ? 'YES (FAIL)' : 'NO'}`);
    console.log(`  three-role validation?       ${hasNewValidation ? 'YES' : 'NO (FAIL)'}`);
    console.log(`  INSERT uses p_role?          ${hasNewInsert ? 'YES' : 'NO (FAIL)'}`);
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
