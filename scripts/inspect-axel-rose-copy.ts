import './loadEnv';
import { Client } from 'pg';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query<{ id: string; name: string; sort_order: number }>(
    `select id, name, sort_order from public.groups
      where name like 'Copy of Task for Axel Rose%'
      order by created_at desc limit 1`,
  );
  console.log('latest copy:', r.rows[0]);
  if (r.rows[0]) {
    const items = await c.query<{ task_code: string; name: string }>(
      `select task_code, name from public.items where group_id=$1 order by sort_order`,
      [r.rows[0].id],
    );
    console.log('items: ' + items.rows.length);
    for (const it of items.rows.slice(0, 10)) console.log('  ' + it.task_code + '  "' + it.name + '"');
    const v = await c.query<{ n: string }>(
      `select count(*) as n from public.item_column_values icv
         join public.items it on it.id = icv.item_id
        where it.group_id = $1`,
      [r.rows[0].id],
    );
    console.log('column values copied: ' + v.rows[0].n);
  }
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
