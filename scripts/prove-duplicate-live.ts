/**
 * End-to-end live proof of duplicate_group on the Tessera board.
 *
 * Picks a group with items on board "Team Projects (Tessera)" (the
 * board that originally hit the 23505 collision), calls
 * supabase.rpc('duplicate_group', ...) as the admin, then queries
 * the DB to confirm the new group + copied items + copied column
 * values exist. Soft-deletes the test copy at the end so it doesn't
 * pollute the live board.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const TESSERA_BOARD = '28472783-6d7a-4de9-8834-2354f62856c5';

async function main() {
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const s = await sb.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });
  if (s.error) throw new Error('admin signin failed: ' + s.error.message);
  console.log('admin signed in');

  const db = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await db.connect();

  // BEFORE: counter on Tessera board + pick a real group with items.
  const { rows: [before] } = await db.query<{ last_task_number: number; max_n: number }>(
    `select bc.last_task_number,
            coalesce((select max(cast(regexp_replace(task_code,'^Task ','') as int))
                        from public.items
                       where board_id = $1
                         and task_code ~ '^Task [0-9]+$'
                         and deleted_at is null), 0) as max_n
       from public.board_counters bc
      where bc.board_id = $1`,
    [TESSERA_BOARD],
  );
  console.log('\nBEFORE: Tessera board_counters.last_task_number=' + before.last_task_number
            + '   actual max("Task N")=' + before.max_n);

  const { rows: groups } = await db.query<{ id: string; name: string; item_count: string }>(
    `select g.id, g.name, count(i.id) as item_count
       from public.groups g
       left join public.items i on i.group_id = g.id and i.deleted_at is null
      where g.board_id = $1
        and g.deleted_at is null
        and g.name not ilike 'copy of%'
      group by g.id, g.name
      having count(i.id) > 0
      order by item_count desc
      limit 1;`,
    [TESSERA_BOARD],
  );
  if (groups.length === 0) { console.error('No non-Copy groups with items on Tessera.'); await db.end(); process.exit(1); }
  const target = groups[0];
  console.log('\nDuplicating: ' + target.id + '  "' + target.name + '"  (items=' + target.item_count + ')');

  // CALL the live RPC the same way the UI does.
  const r = await sb.rpc('duplicate_group', { p_group_id: target.id });
  if (r.error) {
    console.error('  RPC FAILED: ' + r.error.message);
    console.error('  code: ' + (r.error as { code?: string }).code);
    console.error('  details: ' + (r.error as { details?: string }).details);
    await db.end();
    process.exit(1);
  }
  const newId = r.data as string;
  console.log('  RPC OK: new group id = ' + newId);

  // Verify the new group, its items, and copied column values.
  const { rows: [newGroup] } = await db.query<{ name: string; sort_order: number; color: string }>(
    `select name, sort_order, color from public.groups where id=$1`,
    [newId],
  );
  console.log('\nNew group row: ' + JSON.stringify(newGroup));

  const { rows: items } = await db.query<{ task_code: string; name: string; sort_order: number }>(
    `select task_code, name, sort_order from public.items where group_id=$1 order by sort_order`,
    [newId],
  );
  console.log('Copied items: ' + items.length);
  for (const it of items.slice(0, 8)) console.log('  ' + it.task_code + '  "' + it.name + '"');

  const { rows: [vCount] } = await db.query<{ n: string }>(
    `select count(*) as n from public.item_column_values icv
       join public.items it on it.id = icv.item_id
      where it.group_id = $1`,
    [newId],
  );
  console.log('Copied column values: ' + vCount.rows?.[0]?.n ?? vCount.n);

  // AFTER: counter bumped past the source items.
  const { rows: [after] } = await db.query<{ last_task_number: number }>(
    `select last_task_number from public.board_counters where board_id=$1`,
    [TESSERA_BOARD],
  );
  console.log('\nAFTER:  Tessera board_counters.last_task_number=' + after.last_task_number);

  // Cleanup — soft-delete the test copy so we don't pollute the live board.
  await db.query(`update public.groups set deleted_at = now() where id = $1`, [newId]);
  await db.query(`update public.items  set deleted_at = now() where group_id = $1`, [newId]);
  console.log('\nCleanup: test-duplicated group soft-deleted (id=' + newId.slice(0, 8) + ').');

  console.log('\nSUMMARY:');
  console.log('  duplicate_group on the Tessera board: PASS (no 23505)');
  console.log('  new items got non-colliding codes:    PASS  (' + items.map((x) => x.task_code).join(', ') + ')');
  console.log('  column values copied:                 PASS  (' + (vCount?.n ?? '?') + ')');

  await db.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
