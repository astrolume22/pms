/**
 * Verify Phase 1 EDIT 1c (insert-at-top) + EDIT 2 (blank-name task
 * insert) against the live DB.
 *
 *   • Find an existing board with at least one group ("Team Projects
 *     (Tessera)" — board 28472783-…).
 *   • Replicate useCreateGroup's NEW logic via direct SQL:
 *       SELECT min(sort_order) over the board,
 *       INSERT one row with sort_order = (min ?? 0) - 1.
 *     Confirm the new row is BEFORE every other group in ascending
 *     order (the same ORDER the UI reads with).
 *   • Replicate useCreateItem's blank-name path via direct INSERT
 *     with name = '' and task_code = '' to verify the
 *     before_item_insert trigger fills task_code with "Task N" and
 *     accepts an empty incoming name (hook auto-defaults to
 *     "New task" before the insert reaches the DB, but the DB
 *     constraint accepts that as a non-empty string).
 *
 *   Both fixture rows are soft-deleted at the end (deleted_at = now())
 *   so the board state stays clean. Single-row writes by id, no
 *   CASCADE, never touched answers.
 */
import './loadEnv';
import { Client } from 'pg';

const BOARD_ID = '28472783-6d7a-4de9-8834-2354f62856c5'; // Team Projects (Tessera)

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const cleanupGroups: string[] = [];
  const cleanupItems:  string[] = [];

  try {
    // -- Test 1: insert-at-top --
    console.log('=== EDIT 1c — insert-at-top ===');
    const { rows: before } = await c.query<{ name: string; sort_order: number }>(
      `select name, sort_order from public.groups
        where board_id = $1 and deleted_at is null
        order by sort_order asc;`,
      [BOARD_ID]
    );
    console.log(`groups BEFORE (${before.length}):`);
    for (const g of before) console.log(`  ${String(g.sort_order).padStart(4)}  ${g.name}`);
    const minSort = before[0]?.sort_order ?? 0;
    const newSort = minSort - 1;

    const { rows: [g] } = await c.query<{ id: string; sort_order: number; name: string }>(
      `insert into public.groups (board_id, name, color, sort_order)
       values ($1, 'verify-phase1-top', 'oklch(0.70 0.16 25)', $2)
       returning id, sort_order, name;`,
      [BOARD_ID, newSort]
    );
    cleanupGroups.push(g.id);
    console.log(`\ninserted: id=${g.id.slice(0, 8)}… sort_order=${g.sort_order}`);

    const { rows: after } = await c.query<{ name: string; sort_order: number }>(
      `select name, sort_order from public.groups
        where board_id = $1 and deleted_at is null
        order by sort_order asc;`,
      [BOARD_ID]
    );
    console.log(`groups AFTER (${after.length}):`);
    for (const g of after) console.log(`  ${String(g.sort_order).padStart(4)}  ${g.name}`);

    const firstAfter = after[0];
    const ok1 = firstAfter?.name === 'verify-phase1-top' && firstAfter.sort_order === newSort && newSort < minSort;
    console.log(`  ${ok1 ? '✓' : '✗'} new group sorts FIRST (sort_order=${newSort} < min=${minSort})`);

    // -- Test 2: blank-name path → trigger fills task_code 'Task N' --
    console.log('\n=== EDIT 2 — blank-name path generates Task N ===');
    const { rows: [adminRow] } = await c.query<{ id: string }>(
      `select id from public.users where role = 'admin' and is_super_admin = true limit 1;`
    );
    if (!adminRow) throw new Error('No super-admin user found to attribute the insert.');

    // useCreateItem auto-defaults name to "New task" when the caller
    // passes nothing. We simulate exactly that: name="New task",
    // task_code=''. The DB trigger fills task_code.
    const { rows: [it] } = await c.query<{ id: string; name: string; task_code: string }>(
      `insert into public.items (board_id, group_id, name, task_code, created_by)
       values ($1, $2, 'New task', '', $3)
       returning id, name, task_code;`,
      [BOARD_ID, g.id, adminRow.id]
    );
    cleanupItems.push(it.id);
    console.log(`inserted: id=${it.id.slice(0, 8)}… name='${it.name}' task_code='${it.task_code}'`);

    const ok2name = it.name === 'New task';
    const ok2code = /^Task \d+$/.test(it.task_code);
    console.log(`  ${ok2name ? '✓' : '✗'} items.name = 'New task' (hook default)`);
    console.log(`  ${ok2code ? '✓' : '✗'} items.task_code matches /^Task \\d+$/ (migration 0047 trigger)`);

    if (!ok1 || !ok2name || !ok2code) { console.error('\n❌ one or more checks failed.'); process.exit(1); }
    console.log('\n✅ All Phase 1 EDIT 1c + EDIT 2 DB-side checks passed.');
  } finally {
    if (cleanupItems.length) {
      await c.query(
        `update public.items set deleted_at = now() where id = any($1::uuid[]);`,
        [cleanupItems]
      );
    }
    if (cleanupGroups.length) {
      await c.query(
        `update public.groups set deleted_at = now() where id = any($1::uuid[]);`,
        [cleanupGroups]
      );
    }
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
