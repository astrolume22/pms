import './loadEnv';
import { Client } from 'pg';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl:{rejectUnauthorized:false} });
  await c.connect();
  const target = '28472783-6d7a-4de9-8834-2354f62856c5';
  const counters = await c.query('select * from public.board_counters where board_id=$1', [target]);
  console.log('board_counters for failing board:');
  console.log(counters.rows);
  const maxTask = await c.query(
    `select max(cast(regexp_replace(task_code, '^Task ', '') as int)) as max_n,
            count(*) as item_count
       from public.items
      where board_id=$1
        and task_code ~ '^Task [0-9]+$'
        and deleted_at is null`,
    [target],
  );
  console.log('max Task N on this board:');
  console.log(maxTask.rows[0]);

  console.log('\nAll board_counters vs actual max task code:');
  const summary = await c.query(
    `select b.id, b.name, bc.last_task_number,
            (select max(cast(regexp_replace(task_code,'^Task ','') as int))
               from public.items
              where board_id = b.id
                and task_code ~ '^Task [0-9]+$'
                and deleted_at is null) as actual_max
       from public.boards b
       left join public.board_counters bc on bc.board_id = b.id
      order by b.name`,
  );
  for (const r of summary.rows) {
    const mismatch = r.actual_max !== null && r.last_task_number !== null && r.last_task_number < r.actual_max;
    console.log('  ' + (mismatch ? '[!]' : '   ') + ' counter=' + r.last_task_number + '  max_in_items=' + r.actual_max + '  ' + r.name);
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
