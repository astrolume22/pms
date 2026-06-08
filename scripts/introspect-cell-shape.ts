import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  for (const ct of ['status', 'priority', 'text', 'numbers', 'date', 'checkbox', 'people']) {
    const r = await c.query<{ name: string; value: unknown }>(
      `select col.name, icv.value
         from public.item_column_values icv
         join public.columns col on col.id = icv.column_id
        where col.column_type = $1
        limit 3`,
      [ct],
    );
    console.log('column_type = ' + ct + '  (' + r.rows.length + ' samples)');
    for (const row of r.rows) console.log('  ' + row.name + '  →  ' + JSON.stringify(row.value));
    console.log('');
  }

  // Sample a status label to show how label_id → label name resolves.
  console.log('=== resolving label_id → name ===');
  const j = await c.query<{ item: string; col: string; value: unknown; label_name: string | null; label_color: string | null }>(
    `select it.name as item, col.name as col, icv.value, cl.name as label_name, cl.color as label_color
       from public.item_column_values icv
       join public.items   it on it.id = icv.item_id
       join public.columns col on col.id = icv.column_id
       left join public.column_labels cl
              on cl.id = (icv.value ->> 'label_id')::uuid
      where col.column_type = 'status'
      limit 5`,
  );
  for (const r of j.rows) {
    console.log('  ' + r.item + '  / ' + r.col + '  raw=' + JSON.stringify(r.value) + '  → label="' + r.label_name + '" (' + r.label_color + ')');
  }
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
