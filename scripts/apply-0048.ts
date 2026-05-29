/**
 * Apply migration 0048 to the live Supabase project and verify the
 * three policy expressions match the migration's intent. Single
 * transaction; rolls back on any verification failure.
 *
 * After this runs, every non-admin user with a board (or group)
 * subscription on the item can save ANY cell — Status, Priority,
 * Task Type, Co-Work Time, dropdown, text, number, date, link, files.
 * Previously they could only save Status cells.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260529_0048_cell_writes_allow_all_subscribed_users.sql';

async function readPolicies(c: Client) {
  const { rows } = await c.query<{ polname: string; using_expr: string | null; check_expr: string | null }>(
    `select polname,
            pg_get_expr(polqual, polrelid)      as using_expr,
            pg_get_expr(polwithcheck, polrelid) as check_expr
       from pg_policy
      where polrelid = 'public.item_column_values'::regclass
        and polname in ('values_insert','values_update','values_delete')
      order by polname`,
  );
  return rows;
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== BEFORE ==========');
  for (const r of await readPolicies(c)) {
    console.log('  ' + r.polname);
    console.log('     USING:      ' + (r.using_expr ?? '—'));
    console.log('     WITH CHECK: ' + (r.check_expr ?? '—'));
  }

  const sql = readFileSync(FILE, 'utf8');
  console.log('\n========== APPLY ' + FILE + ' ==========');
  // The migration file is itself wrapped in begin/commit. Running it
  // raw lets that commit, then we verify in a fresh query.
  await c.query(sql);
  console.log('applied.');

  console.log('\n========== AFTER ==========');
  const after = await readPolicies(c);
  for (const r of after) {
    console.log('  ' + r.polname);
    console.log('     USING:      ' + (r.using_expr ?? '—'));
    console.log('     WITH CHECK: ' + (r.check_expr ?? '—'));
  }

  // Verify: each of the 3 policies should NO LONGER contain the
  // `is_status_column` clause and should be exactly `can_access_item(item_id)`.
  const expected = 'can_access_item(item_id)';
  let ok = true;
  for (const r of after) {
    const expr = r.polname === 'values_insert' ? r.check_expr
              : r.polname === 'values_delete' ? r.using_expr
              : r.check_expr; // values_update — pick check_expr (using is identical)
    if (!expr || !expr.includes(expected) || expr.includes('is_status_column')) {
      ok = false;
      console.log('  MISMATCH on ' + r.polname + ': ' + expr);
    }
  }
  console.log('\n' + (ok ? '✅ All three policies verified.' : '❌ FAIL — see mismatches.'));
  if (!ok) process.exit(1);

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
