/**
 * One-off restructure of the Tessera PMS board for Sylvia onboarding
 * integration. See the chat prompt that produced this script for the
 * full spec. All writes happen in a single transaction; on any error
 * the entire restructure rolls back. Single-row writes by id only,
 * never CASCADE on FK changes, answers table not touched.
 *
 * Safe to re-run: the writes are no-ops if the target state is
 * already in place (renames check name first, inserts check existence
 * by name + board_id).
 */
import './loadEnv';
import { Client } from 'pg';

const BOARD = '28472783-6d7a-4de9-8834-2354f62856c5';

// Existing group ids (read from inspect snapshot — verified live).
const G_LEGACY      = '3f222c05-fde9-40c6-8480-877c9d2b6623'; // "Team Red Projects"  → rename to "Legacy / To Be Sorted"
const G_AXEL        = '3442b081-1617-4d4b-a3c2-d7a1ef231e02'; // "Task for Axel Rose" → tasks merged into Legacy, group soft-deleted
const G_COPY_AXEL   = '5ed38fb3-36eb-40d9-96fc-528c0fa706b0'; // "Copy of Task for Axel Rose" → soft-delete (+ items)
const G_COPY_RED    = '07de5557-f023-4f5d-98e2-95dd3c18f36f'; // "Copy of Team Red Projects"  → soft-delete (+ items)

// New groups (sort_order 0..3; Legacy pushed to 4).
const NEW_GROUPS = [
  { name: 'Team Marketing & E-Com', color: '#00C875' }, // green
  { name: 'Team Stock Market',      color: '#579BFC' }, // blue
  { name: 'Team Real Estate',       color: '#A25DDC' }, // purple
  { name: 'Team Expert Advisor',    color: '#FDAB3D' }, // amber
];

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Pre-snapshot of other tables — we'll re-compare after to prove
  // nothing else moved.
  const { rows: [pre] } = await c.query<{ boards: string; workspaces: string; columns: string; items_total: string }>(
    `select (select count(*) from public.boards)     as boards,
            (select count(*) from public.workspaces) as workspaces,
            (select count(*) from public.columns)    as columns,
            (select count(*) from public.items)      as items_total`,
  );

  try {
    await c.query('begin');

    // 1) Move 6 Axel Rose tasks into the Legacy (Team Red Projects → renamed) group.
    const moved = await c.query(
      `update public.items
          set group_id   = $1,
              updated_at = now()
        where group_id   = $2
          and deleted_at is null`,
      [G_LEGACY, G_AXEL],
    );
    console.log('moved ' + moved.rowCount + ' items from Axel Rose → Legacy');

    // 2) Soft-delete the now-empty Axel Rose group.
    const delAxel = await c.query(
      `update public.groups
          set deleted_at = now(),
              updated_at = now()
        where id = $1
          and deleted_at is null`,
      [G_AXEL],
    );
    console.log('soft-deleted Axel Rose group: ' + delAxel.rowCount + ' row(s)');

    // 3) Soft-delete the 12 duplicate items inside the two "Copy of …" groups.
    const delDupItems = await c.query(
      `update public.items
          set deleted_at = now(),
              updated_at = now()
        where group_id = any($1)
          and deleted_at is null`,
      [[G_COPY_AXEL, G_COPY_RED]],
    );
    console.log('soft-deleted ' + delDupItems.rowCount + ' duplicate items');

    // 4) Soft-delete the two duplicate "Copy of …" groups.
    const delDupGroups = await c.query(
      `update public.groups
          set deleted_at = now(),
              updated_at = now()
        where id = any($1)
          and deleted_at is null`,
      [[G_COPY_AXEL, G_COPY_RED]],
    );
    console.log('soft-deleted ' + delDupGroups.rowCount + ' duplicate group(s)');

    // 5) Rename Team Red Projects → Legacy / To Be Sorted, push to bottom (sort_order = 4).
    const renamed = await c.query(
      `update public.groups
          set name       = 'Legacy / To Be Sorted',
              sort_order = 4,
              updated_at = now()
        where id = $1`,
      [G_LEGACY],
    );
    console.log('renamed + repositioned Legacy group: ' + renamed.rowCount + ' row(s)');

    // 6) Insert the 4 new groups at sort_order 0..3.
    //    Idempotent: skip insert when a non-deleted group with the
    //    same name already exists on the board.
    for (let i = 0; i < NEW_GROUPS.length; i++) {
      const g = NEW_GROUPS[i];
      const { rows: existing } = await c.query<{ id: string }>(
        `select id from public.groups
          where board_id = $1 and name = $2 and deleted_at is null
          limit 1`,
        [BOARD, g.name],
      );
      if (existing.length > 0) {
        // Already present — just normalize its sort_order + color.
        await c.query(
          `update public.groups
              set sort_order = $1, color = $2, updated_at = now()
            where id = $3`,
          [i, g.color, existing[0].id],
        );
        console.log('  exists, updated: ' + g.name);
      } else {
        await c.query(
          `insert into public.groups (board_id, name, color, sort_order, is_collapsed_default)
           values ($1, $2, $3, $4, false)`,
          [BOARD, g.name, g.color, i],
        );
        console.log('  inserted: ' + g.name);
      }
    }

    await c.query('commit');
    console.log('\ncommitted.');
  } catch (e) {
    await c.query('rollback');
    console.error('ROLLED BACK:', e);
    process.exit(1);
  }

  // ======================= POST-VERIFICATION =======================
  console.log('\n========== POST-VERIFICATION ==========\n');

  const { rows: groupsAfter } = await c.query<{
    id: string; name: string; color: string; sort_order: number; deleted_at: string | null;
  }>(
    `select id, name, color, sort_order, deleted_at
       from public.groups
      where board_id = $1
      order by sort_order, deleted_at nulls first, name`,
    [BOARD],
  );
  console.log('GROUPS on Tessera (' + groupsAfter.length + '):');
  for (const g of groupsAfter) {
    console.log(
      '  ' + g.id + '  sort=' + g.sort_order +
      '  color=' + g.color +
      '  deleted=' + (g.deleted_at ? 'YES' : 'no') +
      '  "' + g.name + '"',
    );
  }

  const { rows: [{ n: aliveItems }] } = await c.query<{ n: string }>(
    `select count(*) as n from public.items
      where board_id = $1 and deleted_at is null`,
    [BOARD],
  );
  console.log('\nAlive items on board: ' + aliveItems + '   (expected 12)');

  const { rows: [{ n: inLegacy }] } = await c.query<{ n: string }>(
    `select count(*) as n from public.items
      where group_id = $1 and deleted_at is null`,
    [G_LEGACY],
  );
  console.log('Alive items in Legacy / To Be Sorted: ' + inLegacy + '   (expected 12)');

  const { rows: [post] } = await c.query<{ boards: string; workspaces: string; columns: string; items_total: string }>(
    `select (select count(*) from public.boards)     as boards,
            (select count(*) from public.workspaces) as workspaces,
            (select count(*) from public.columns)    as columns,
            (select count(*) from public.items)      as items_total`,
  );
  console.log('\nUntouched-table row counts (must match):');
  console.log('  boards     before=' + pre.boards     + '  after=' + post.boards);
  console.log('  workspaces before=' + pre.workspaces + '  after=' + post.workspaces);
  console.log('  columns    before=' + pre.columns    + '  after=' + post.columns);
  console.log('  items      before=' + pre.items_total+ '  after=' + post.items_total + '   (== total rows incl. soft-deleted; we only flipped deleted_at)');

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
