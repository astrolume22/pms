import './loadEnv';
import { Client } from 'pg';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl:{rejectUnauthorized:false} });
  await c.connect();
  const id = process.argv[2];
  if (!id) { console.error('usage: inspect-dup-group <group_id>'); process.exit(1); }
  const g = await c.query('select id, board_id, name, color, sort_order from public.groups where id=$1', [id]);
  console.log('group:', g.rows[0]);
  const items = await c.query('select id, name, task_code, sort_order, created_by, parent_item_id from public.items where group_id=$1 order by sort_order', [id]);
  console.log('items: ' + items.rows.length);
  for (const r of items.rows.slice(0, 5)) console.log('  ' + r.id.slice(0,8) + '  code=' + r.task_code + '  name="' + r.name + '"  sort=' + r.sort_order);
  const vals = await c.query('select count(*) as n from public.item_column_values icv join public.items it on it.id=icv.item_id where it.group_id=$1', [id]);
  console.log('column values: ' + vals.rows[0].n);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
