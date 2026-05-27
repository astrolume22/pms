/** User-requested verification queries after restructure. Read-only. */
import './loadEnv';
import { Client } from 'pg';

const BOARD   = '28472783-6d7a-4de9-8834-2354f62856c5';
const LEGACY  = '3f222c05-fde9-40c6-8480-877c9d2b6623';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('--- SELECT id, name, color, sort_order, deleted_at FROM groups WHERE board_id = $1 ORDER BY sort_order;');
  const g = await c.query(
    `select id, name, color, sort_order, deleted_at
       from public.groups
      where board_id = $1
      order by sort_order, deleted_at nulls first, name`,
    [BOARD],
  );
  for (const r of g.rows) {
    console.log(
      '  sort=' + r.sort_order +
      '  ' + r.id +
      '  color=' + r.color +
      '  deleted=' + (r.deleted_at ? r.deleted_at : 'NULL') +
      '  "' + r.name + '"',
    );
  }
  const ai = await c.query<{ n: string }>(
    `select count(*) as n from public.items where board_id = $1 and deleted_at is null`,
    [BOARD],
  );
  console.log('\nSELECT count(*) FROM items WHERE board_id = ... AND deleted_at IS NULL;  →  ' + ai.rows[0].n);
  const il = await c.query<{ n: string }>(
    `select count(*) as n from public.items where group_id = $1 and deleted_at is null`,
    [LEGACY],
  );
  console.log('SELECT count(*) FROM items WHERE group_id = ' + LEGACY + ' AND deleted_at IS NULL;  →  ' + il.rows[0].n);
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
