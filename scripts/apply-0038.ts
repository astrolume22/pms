/**
 * One-shot applier for migration 0038 — items_select soft-delete fix.
 * Same pattern as apply-0034 .. apply-0037.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260524_0038_items_select_soft_delete_fix.sql'), 'utf8');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('✅ 0038 applied.');
    // Confirm — items_select USING no longer mentions deleted_at.
    const { rows } = await c.query<{ qual: string }>(
      `select qual from pg_policies where tablename='items' and policyname='items_select';`
    );
    const usingsHasDeletedAt = (rows[0]?.qual ?? '').toLowerCase().includes('deleted_at');
    console.log(`items_select USING references deleted_at? ${usingsHasDeletedAt ? 'YES (FAIL)' : 'NO (PASS)'}`);
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
