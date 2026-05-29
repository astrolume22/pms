/** Apply migration 0050 + verify board_sync_pings is set up correctly. */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260529_0050_board_sync_pings.sql';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied ' + FILE);

  // Verify table exists.
  const { rows: cols } = await c.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='board_sync_pings' order by ordinal_position`,
  );
  console.log('Columns: ' + cols.map((r) => r.column_name).join(', '));

  // Verify in realtime publication.
  const { rows: pub } = await c.query(
    `select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='board_sync_pings'`,
  );
  console.log('In supabase_realtime publication: ' + (pub.length > 0 ? 'YES' : 'NO'));

  // Verify RLS.
  const { rows: pol } = await c.query(
    `select polname, polcmd from pg_policy where polrelid='public.board_sync_pings'::regclass order by polname`,
  );
  console.log('RLS policies: ' + pol.map((r) => r.polname + ' (' + r.polcmd + ')').join(', '));

  const ok = cols.length === 4 && pub.length === 1 && pol.length === 2;
  console.log(ok ? '\n✅ 0050 verified.' : '\n❌ FAIL — investigate above.');
  if (!ok) process.exit(1);

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
