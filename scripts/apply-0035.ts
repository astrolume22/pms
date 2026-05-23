/**
 * One-shot applier for 0035 — same pattern as apply-0034.ts. The full
 * migrate.ts replays from scratch and chokes on the 0032/0033 narrow
 * vs widen sequence; this script applies 0035 in isolation.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260524_0035_ai_runs_feature_3d_more.sql'), 'utf8');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('✅ 0035 applied.');
    const { rows } = await c.query(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.ai_runs'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%feature%';
    `);
    console.log('Active feature CHECK:\n  ' + (rows[0]?.def ?? '(none)'));
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
