/**
 * Verify every expected foreign key from Phase 1 physically exists.
 * Uses pg_catalog (not information_schema) because information_schema's
 * constraint_column_usage view doesn't reliably surface cross-schema FKs.
 */
import './loadEnv';
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL in .env.local');
  process.exit(1);
}

interface ExpectedFk {
  table: string;            // local table (always in public)
  column: string;           // local column
  references: string;       // "<schema>.<table>(<column>)"
}

const expected: ExpectedFk[] = [
  { table: 'users',             column: 'id',           references: 'auth.users(id)' },
  { table: 'workspace_members', column: 'workspace_id', references: 'public.workspaces(id)' },
  { table: 'workspace_members', column: 'user_id',      references: 'public.users(id)' },
  { table: 'activity_log',      column: 'actor_id',     references: 'public.users(id)' },
];

const QUERY = `
  select
    c.conname            as constraint_name,
    nsp_src.nspname      as src_schema,
    cls_src.relname      as src_table,
    att_src.attname      as src_column,
    nsp_ref.nspname      as ref_schema,
    cls_ref.relname      as ref_table,
    att_ref.attname      as ref_column
  from pg_constraint c
  join pg_class      cls_src on cls_src.oid = c.conrelid
  join pg_namespace  nsp_src on nsp_src.oid = cls_src.relnamespace
  join pg_class      cls_ref on cls_ref.oid = c.confrelid
  join pg_namespace  nsp_ref on nsp_ref.oid = cls_ref.relnamespace
  join unnest(c.conkey)  with ordinality as src_keys(attnum, ord) on true
  join pg_attribute  att_src on att_src.attrelid = c.conrelid  and att_src.attnum = src_keys.attnum
  join unnest(c.confkey) with ordinality as ref_keys(attnum, ord) on ref_keys.ord = src_keys.ord
  join pg_attribute  att_ref on att_ref.attrelid = c.confrelid and att_ref.attnum = ref_keys.attnum
  where c.contype = 'f'
    and nsp_src.nspname = 'public'
    and cls_src.relname in ('users','workspace_members','activity_log')
  order by cls_src.relname, att_src.attname;
`;

async function run() {
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(QUERY);
    const found = rows.map((r) => ({
      table: r.src_table as string,
      column: r.src_column as string,
      references: `${r.ref_schema}.${r.ref_table}(${r.ref_column})`,
    }));

    console.log('\nForeign keys found in DB:');
    for (const fk of found) console.log(`  ✓ ${fk.table}.${fk.column} → ${fk.references}`);

    const missing = expected.filter(
      (e) => !found.some((f) => f.table === e.table && f.column === e.column && f.references === e.references),
    );

    if (missing.length === 0) {
      console.log('\n✅ All expected FKs are physically present.');
      return;
    }
    console.log('\n❌ Missing FKs:');
    for (const m of missing) console.log(`  ✗ ${m.table}.${m.column} → ${m.references}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('\nVerify failed:', err.message ?? err);
  process.exit(1);
});
