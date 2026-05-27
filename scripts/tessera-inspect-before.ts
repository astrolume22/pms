/** Read-only snapshot of the Tessera board before any restructure. */
import './loadEnv';
import { Client } from 'pg';

const BOARD = '28472783-6d7a-4de9-8834-2354f62856c5';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: groups } = await c.query<{
    id: string; name: string; color: string; sort_order: number; deleted_at: string | null;
  }>(
    `select id, name, color, sort_order, deleted_at
       from public.groups
      where board_id = $1
      order by sort_order, name`,
    [BOARD],
  );
  console.log('GROUPS on Tessera (' + groups.length + '):');
  for (const g of groups) {
    console.log(
      '  ' + g.id + '  sort=' + g.sort_order +
      '  color=' + g.color +
      '  deleted=' + (g.deleted_at ? 'YES' : 'no') +
      '  "' + g.name + '"',
    );
  }

  const { rows: itemCounts } = await c.query<{ group_id: string; n: string; deleted_n: string }>(
    `select i.group_id,
            count(*) filter (where i.deleted_at is null) as n,
            count(*) filter (where i.deleted_at is not null) as deleted_n
       from public.items i
      where i.board_id = $1
      group by i.group_id`,
    [BOARD],
  );
  console.log('\nITEM COUNTS:');
  for (const r of itemCounts) console.log('  group=' + r.group_id + '  alive=' + r.n + '  deleted=' + r.deleted_n);

  const { rows: [{ total }] } = await c.query<{ total: string }>(
    `select count(*) as total from public.items where board_id = $1 and deleted_at is null`,
    [BOARD],
  );
  console.log('\nTotal alive items on board: ' + total);
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
