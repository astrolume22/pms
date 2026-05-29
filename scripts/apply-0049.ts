/**
 * Apply migration 0049 + verify the 4 tables are now in the
 * supabase_realtime publication.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260529_0049_enable_realtime_on_board_tables.sql';
const EXPECTED = ['items', 'item_column_values', 'groups', 'columns'];

async function listPub(c: Client) {
  const { rows } = await c.query<{ tablename: string }>(
    `select tablename from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
      order by tablename`,
  );
  return rows.map((r) => r.tablename);
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('BEFORE: ' + (await listPub(c)).join(', ') || '(empty)');

  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied ' + FILE);

  const after = await listPub(c);
  console.log('AFTER:  ' + after.join(', '));

  const missing = EXPECTED.filter((t) => !after.includes(t));
  if (missing.length > 0) {
    console.log('❌ MISSING: ' + missing.join(', '));
    process.exit(1);
  }
  console.log('✅ All 4 board tables in supabase_realtime publication.');
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
