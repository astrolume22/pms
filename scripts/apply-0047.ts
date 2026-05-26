/** Apply 0047 + verify backfill. */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main() {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260526_0047_task_code_counter_self_healing.sql'), 'utf8');
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin'); await c.query(sql); await c.query('commit');
    console.log('OK: 0047 applied.');

    const r = await c.query<{ board_id: string; last_task_number: number; actual_max: number | null }>(
      `select bc.board_id, bc.last_task_number,
              (select max(cast(regexp_replace(task_code,'^Task ','') as int))
                 from public.items
                where board_id = bc.board_id
                  and task_code ~ '^Task [0-9]+$'
                  and deleted_at is null) as actual_max
         from public.board_counters bc
        order by board_id`,
    );
    let lag = 0;
    for (const row of r.rows) {
      if (row.actual_max !== null && row.last_task_number < row.actual_max) {
        lag++;
        console.log('  LAG: counter=' + row.last_task_number + ' actual=' + row.actual_max + ' board=' + row.board_id.slice(0, 8));
      }
    }
    console.log('counters lagging max after backfill: ' + lag);

    const missing = await c.query<{ n: string }>(
      `select count(distinct i.board_id) as n
         from public.items i
        where i.task_code ~ '^Task [0-9]+$'
          and i.deleted_at is null
          and not exists (select 1 from public.board_counters bc where bc.board_id = i.board_id)`,
    );
    console.log('boards with items but no counter row: ' + missing.rows[0].n);
  } catch (e) { await c.query('rollback'); throw e; }
  finally { await c.end(); }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
