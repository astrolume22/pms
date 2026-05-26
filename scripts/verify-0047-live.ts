/**
 * READ-ONLY live check: is migration 0047 in effect on the database?
 *
 *   - pg_get_functiondef(generate_task_code) — does it contain the
 *     self-healing seed logic ("max(cast(regexp_replace(task_code,
 *     '^Task '...") OR the comment "0047: self-healing"?
 *   - Are any boards with "Task N" items still missing a
 *     board_counters row, or have a counter that lags max actual?
 *
 * Prints a clear OK / NOT LIVE verdict so the caller can decide
 * whether to re-apply 0047.
 */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await db.connect();

  // 1) Function source.
  const { rows: [fn] } = await db.query<{ def: string; comment: string | null }>(
    `select pg_get_functiondef(p.oid) as def,
            obj_description(p.oid, 'pg_proc') as comment
       from pg_proc p
      where proname = 'generate_task_code'
        and pronamespace = 'public'::regnamespace
      limit 1;`,
  );
  const def = fn?.def ?? '';
  const comment = fn?.comment ?? '';
  const hasSeedRegexp = /regexp_replace\(\s*task_code\s*,\s*'\^Task '/i.test(def);
  const hasSelfHealComment = /0047:?\s*self-?healing/i.test(comment);
  const hasGreatestBump  = /greatest\(\s*public\.board_counters\.last_task_number\s*\+\s*1/i.test(def);

  console.log('=== generate_task_code() source check ===');
  console.log('  contains self-healing seed (max regexp_replace …)? ' + (hasSeedRegexp     ? 'YES' : 'NO'));
  console.log('  contains GREATEST(counter+1, excluded.seed) bump?  ' + (hasGreatestBump   ? 'YES' : 'NO'));
  console.log('  function comment marks 0047?                       ' + (hasSelfHealComment? 'YES' : 'NO'));
  console.log('');

  // 2) Counter state.
  const { rows: counters } = await db.query<{
    board_id: string; last_task_number: number | null; actual_max: number | null; name: string;
  }>(
    `select b.id as board_id, bc.last_task_number,
            (select max(cast(regexp_replace(task_code,'^Task ','') as int))
               from public.items
              where board_id = b.id
                and task_code ~ '^Task [0-9]+$'
                and deleted_at is null) as actual_max,
            b.name
       from public.boards b
       left join public.board_counters bc on bc.board_id = b.id
      where exists (select 1 from public.items i
                     where i.board_id = b.id
                       and i.task_code ~ '^Task [0-9]+$'
                       and i.deleted_at is null)
      order by b.name;`,
  );

  let missing = 0, lag = 0, total = counters.length;
  for (const r of counters) {
    if (r.last_task_number === null) {
      missing++;
      console.log('  MISSING counter for board: ' + r.name + '  (max items=' + r.actual_max + ')');
    } else if (r.actual_max !== null && r.last_task_number < r.actual_max) {
      lag++;
      console.log('  LAG counter=' + r.last_task_number + ' < actual=' + r.actual_max + ' on board: ' + r.name);
    }
  }

  console.log('=== board_counters reconciliation ===');
  console.log('  boards with Task-N items:         ' + total);
  console.log('  boards missing counter row:       ' + missing);
  console.log('  counters lagging actual max:      ' + lag);
  console.log('');

  const live = hasSeedRegexp && hasGreatestBump && missing === 0 && lag === 0;
  console.log('=== VERDICT ===');
  console.log('  0047 LIVE? ' + (live ? 'YES' : 'NO'));
  if (!live) {
    console.log('  -> re-apply scripts/apply-0047.ts');
  }
  await db.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
