/**
 * READ-ONLY diagnostic — board 22fc9ed0-9070-439a-8aff-71cf53065718
 * ("New Employee Onboarding"). Dumps the raw stored value of every
 * cell in the Date column and the "Time Window" text column so we
 * can see the exact shape ({value:...} vs {date:...} vs {text:...}).
 *
 * Does NOT modify anything.
 */
import './loadEnv';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

const BOARD_ID = '22fc9ed0-9070-439a-8aff-71cf53065718';

async function main() {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    // 1. Find columns on this board, especially Date + Time Window.
    const { rows: cols } = await c.query<{ id: string; name: string; column_type: string }>(
      `select id, name, column_type
       from public.columns
       where board_id = $1
         and archived_at is null
       order by sort_order;`,
      [BOARD_ID]
    );
    console.log('Columns on this board:');
    for (const c of cols) {
      console.log(`  ${c.column_type.padEnd(12)} ${c.name.padEnd(20)} id=${c.id.slice(0, 8)}…`);
    }
    console.log('');

    const dateCol = cols.find((c) => c.column_type === 'date');
    const timeWindowCol = cols.find((c) => c.name.toLowerCase().includes('time window'));

    if (!dateCol)        { console.warn('No date column found.'); }
    if (!timeWindowCol)  { console.warn('No "Time Window" column found.'); }

    // 2. List items on the board.
    const { rows: items } = await c.query<{ id: string; name: string }>(
      `select id, name from public.items
       where board_id = $1 and deleted_at is null
       order by sort_order;`,
      [BOARD_ID]
    );
    console.log(`Tasks on this board: ${items.length}`);

    // 3. For Date col + Time Window col, pull raw stored values.
    const dump = async (col: { id: string; name: string; column_type: string } | undefined) => {
      if (!col) return;
      console.log(`\n--- ${col.name} (${col.column_type}, id=${col.id.slice(0, 8)}…) ---`);
      const { rows } = await c.query<{ item_id: string; value: unknown }>(
        `select item_id, value
         from public.item_column_values
         where column_id = $1;`,
        [col.id]
      );
      const byItem = new Map(rows.map((r) => [r.item_id, r.value]));
      for (const it of items) {
        const v = byItem.get(it.id);
        console.log(`  ${it.name.padEnd(36)} → ${v === undefined ? '(no row)' : JSON.stringify(v)}`);
      }
    };

    await dump(dateCol);
    await dump(timeWindowCol);

    // 4. For comparison, also dump a status / priority col so we see
    //    the "working" shape.
    const statusCol   = cols.find((c) => c.column_type === 'status');
    const priorityCol = cols.find((c) => c.column_type === 'priority');
    console.log('\n=== Reference: cell shapes for columns that DO render ===');
    if (statusCol) {
      const { rows } = await c.query<{ value: unknown }>(
        `select value from public.item_column_values where column_id = $1 limit 3;`,
        [statusCol.id]
      );
      console.log(`status   sample shape: ${rows.map((r) => JSON.stringify(r.value)).join(' / ')}`);
    }
    if (priorityCol) {
      const { rows } = await c.query<{ value: unknown }>(
        `select value from public.item_column_values where column_id = $1 limit 3;`,
        [priorityCol.id]
      );
      console.log(`priority sample shape: ${rows.map((r) => JSON.stringify(r.value)).join(' / ')}`);
    }
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
