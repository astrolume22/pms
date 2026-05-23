/**
 * One-shot applier for 0036 — same pattern as apply-0034/0035.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260524_0036_label_color_fix.sql'), 'utf8');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('✅ 0036 applied.');
    // Verify: no oklch rows left
    const { rows } = await c.query(`
      select count(*)::int as n from public.column_labels where color like 'oklch(%';
    `);
    console.log(`column_labels rows with oklch(...) remaining: ${rows[0].n}`);
    // Constraint sanity
    const { rows: cc } = await c.query(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.ai_runs'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%feature%';
    `);
    console.log(`ai_runs.feature CHECK now: ${cc[0]?.def ?? '(none)'}`);
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
