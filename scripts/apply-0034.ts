/**
 * One-shot: apply the 0034 ai_runs.feature widening directly.
 *
 * The full migrate.ts replays every migration on every invocation and
 * re-applies 0032's narrow CHECK before 0033 widens it again — that
 * narrow form conflicts with rows written between runs, so the
 * playback fails. 0034 itself is idempotent (drops the current CHECK
 * by introspecting pg_constraint, then re-adds it) so running it
 * alone is safe.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const file = join(process.cwd(), 'supabase/migrations/20260524_0034_ai_runs_feature_3d.sql');
  const sql = readFileSync(file, 'utf8');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('✅ 0034 applied.');
    // Verify by reading the constraint def back.
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
