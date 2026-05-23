/**
 * One-shot applier for 0037 — invite "Never expires" support.
 * Same pattern as apply-0034 .. apply-0036.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260524_0037_invite_never_expires.sql'), 'utf8');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('✅ 0037 applied.');

    // Verify column is nullable.
    const { rows: col } = await c.query(`
      select is_nullable
      from information_schema.columns
      where table_schema='public' and table_name='invites' and column_name='expires_at';
    `);
    console.log(`invites.expires_at is_nullable: ${col[0]?.is_nullable ?? '(unknown)'}`);

    // Verify create_invite signature still works.
    const { rows: fn } = await c.query(`
      select pg_get_functiondef(oid) as def
      from pg_proc
      where proname = 'create_invite' and pronamespace = 'public'::regnamespace;
    `);
    const def = (fn[0]?.def ?? '') as string;
    console.log(`create_invite handles null/<=0 → never: ${
      /p_expires_in_hours is null or p_expires_in_hours <= 0/i.test(def) ? 'YES' : 'NO'
    }`);
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
