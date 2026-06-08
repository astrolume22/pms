/**
 * READ-ONLY schema introspection for boards / items / groups / columns
 * / item_column_values / column_labels. Lists table columns + the key
 * indexes + FKs so an external consumer can build a read path.
 *
 * Runs SELECTs only — no DDL, no DML.
 */
import './loadEnv';
import { Client } from 'pg';

const TARGETS = [
  'boards',
  'groups',
  'items',
  'columns',
  'column_labels',
  'item_column_values',
  'workspaces',
];

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  for (const t of TARGETS) {
    const cols = await c.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = $1
        order by ordinal_position`,
      [t],
    );
    if (cols.rows.length === 0) {
      console.log('=== public.' + t + ' === (not found)');
      console.log('');
      continue;
    }
    console.log('=== public.' + t + ' ===');
    for (const r of cols.rows) {
      console.log('  ' + r.column_name.padEnd(24) + r.data_type + (r.is_nullable === 'NO' ? '  NOT NULL' : ''));
    }
    // FKs FROM this table → other tables
    const fks = await c.query<{ column_name: string; foreign_table: string; foreign_column: string; on_delete: string }>(
      `select kcu.column_name,
              ccu.table_schema || '.' || ccu.table_name as foreign_table,
              ccu.column_name as foreign_column,
              rc.delete_rule as on_delete
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on tc.constraint_name = kcu.constraint_name
          and tc.table_schema   = kcu.table_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
         join information_schema.referential_constraints rc
           on rc.constraint_name = tc.constraint_name
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'public'
          and tc.table_name = $1
        order by kcu.ordinal_position`,
      [t],
    );
    if (fks.rows.length > 0) {
      console.log('  FOREIGN KEYS:');
      for (const fk of fks.rows) {
        console.log('    ' + fk.column_name + ' -> ' + fk.foreign_table + '.' + fk.foreign_column + ' ON DELETE ' + fk.on_delete);
      }
    }
    // Unique indexes
    const idx = await c.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef
         from pg_indexes
        where schemaname = 'public' and tablename = $1
          and indexdef ilike '%unique%'`,
      [t],
    );
    if (idx.rows.length > 0) {
      console.log('  UNIQUE INDEXES:');
      for (const i of idx.rows) console.log('    ' + i.indexname + '  ' + i.indexdef.split('USING')[1]?.trim());
    }
    console.log('');
  }

  // Row counts for sanity.
  console.log('=== row counts (live) ===');
  for (const t of TARGETS) {
    try {
      const r = await c.query<{ n: string }>(`select count(*) as n from public.${t}`);
      console.log('  ' + t.padEnd(24) + r.rows[0].n);
    } catch (e) {
      console.log('  ' + t.padEnd(24) + '(skip: ' + (e as Error).message.slice(0, 60) + ')');
    }
  }

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
