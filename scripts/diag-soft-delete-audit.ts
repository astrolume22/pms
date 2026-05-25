/**
 * Audit every SELECT policy in `public.*` for the soft-delete trap:
 *   USING ((deleted_at IS NULL) AND ...)
 * That clause turns into an implicit WITH CHECK on the new row during
 * any UPDATE, so setting `deleted_at = now()` fails RLS even when the
 * caller is allowed to update the row. Fix is to drop the clause from
 * USING and rely on the app's `.is('deleted_at', null)` query filter
 * to hide soft-deleted rows (which it already does).
 */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    // Find every table that has a deleted_at column.
    const { rows: tables } = await c.query<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'deleted_at'
        order by table_name;`
    );
    console.log('Tables with a deleted_at column:');
    for (const t of tables) console.log(`  ${t.table_name}`);

    console.log('\nSELECT policies whose USING includes "deleted_at IS NULL":');
    const { rows: pol } = await c.query<{ tablename: string; policyname: string; qual: string }>(
      `select tablename, policyname, qual from pg_policies
        where schemaname = 'public' and cmd = 'SELECT'
          and qual ilike '%deleted_at is null%'
        order by tablename;`
    );
    if (!pol.length) {
      console.log('  (none)');
    } else {
      for (const p of pol) {
        console.log(`  ${p.tablename.padEnd(24)} ${p.policyname}`);
        console.log(`    ${p.qual.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    }
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
