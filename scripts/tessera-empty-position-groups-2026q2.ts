/**
 * One-off: hard-empty the 3 Tessera position groups so they go back to
 * zero tasks, ready for quality tasks later. KEEP the 3 group rows
 * themselves — only their items are deleted.
 *
 * Targets ONLY:
 *   - Team Marketing & E-Com   (7b124043-…)
 *   - Team Stock Market        (25e424e3-…)
 *   - Team Real Estate         (5fd5ca28-…)
 *
 * Does NOT touch:
 *   - Legacy / To Be Sorted    (3f222c05-…)  ← read-verified untouched
 *   - Team Expert Advisor      (914de165-…)  ← already empty
 *   - Any other board, column, label, RLS, user, workspace, or table
 *
 * Delete order (same single transaction):
 *   1. item_column_values for the target items   (explicit, for logs;
 *      the FK is ON DELETE CASCADE so this is also implicit)
 *   2. items rows themselves
 *
 * The CASCADE chain on items also cleans files, item_subscribers,
 * notifications, updates, and any sub-items (parent_item_id) — none of
 * which exist on Tessera position groups today but is the safe thing.
 *
 * Founder confirmed: hard delete is fine, no recovery needed.
 */
import './loadEnv';
import { Client } from 'pg';

const BOARD = '28472783-6d7a-4de9-8834-2354f62856c5';

const POSITION_GROUPS = [
  '7b124043-5cc4-468a-8a39-2d59b13cdeec', // Team Marketing & E-Com
  '25e424e3-d44d-4c91-97a2-b30f3ed2a5f3', // Team Stock Market
  '5fd5ca28-6854-47b8-ac96-c61bb994aad0', // Team Real Estate
];
const LEGACY_GROUP = '3f222c05-fde9-40c6-8480-877c9d2b6623';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // ============== PRE-SNAPSHOT (read-only) ==============
  console.log('========== PRE-DELETE SNAPSHOT ==========\n');

  const { rows: targetItems } = await c.query<{ id: string; group_id: string; name: string }>(
    `select id, group_id, name
       from public.items
      where group_id = any($1)
        and deleted_at is null
      order by group_id, name`,
    [POSITION_GROUPS],
  );
  console.log('Alive items in the 3 position groups: ' + targetItems.length + '   (expected ~90)');
  const byGroup = new Map<string, number>();
  for (const r of targetItems) byGroup.set(r.group_id, (byGroup.get(r.group_id) ?? 0) + 1);
  for (const gid of POSITION_GROUPS) console.log('  ' + gid + '  →  ' + (byGroup.get(gid) ?? 0));

  const { rows: [legacyPre] } = await c.query<{ n: string }>(
    `select count(*) as n from public.items where group_id = $1 and deleted_at is null`,
    [LEGACY_GROUP],
  );
  console.log('Alive items in Legacy / To Be Sorted: ' + legacyPre.n + '   (must NOT change)');

  const itemIds = targetItems.map((r) => r.id);
  if (itemIds.length === 0) {
    console.log('\nNothing to delete — the 3 position groups are already empty.');
    await c.end();
    return;
  }

  // ============== TRANSACTIONAL DELETE ==============
  console.log('\n========== DELETE ==========\n');

  try {
    await c.query('begin');

    // 1) Cells first — explicit for visibility. CASCADE would also
    //    handle this when we delete the items, but doing it directly
    //    gives us a clean count in the log.
    const delCells = await c.query(
      `delete from public.item_column_values where item_id = any($1)`,
      [itemIds],
    );
    console.log('deleted ' + delCells.rowCount + ' cells (item_column_values)');

    // 2) Items themselves — hard delete. CASCADE cleans files /
    //    subscribers / notifications / updates / sub-items if any.
    const delItems = await c.query(
      `delete from public.items where id = any($1)`,
      [itemIds],
    );
    console.log('deleted ' + delItems.rowCount + ' items');

    await c.query('commit');
    console.log('\ncommitted.');
  } catch (e) {
    await c.query('rollback');
    console.error('ROLLED BACK:', e);
    process.exit(1);
  }

  // ============== POST-VERIFICATION ==============
  console.log('\n========== POST-VERIFICATION ==========\n');

  const { rows: [{ n: aliveInTargets }] } = await c.query<{ n: string }>(
    `select count(*) as n from public.items
      where group_id = any($1) and deleted_at is null`,
    [POSITION_GROUPS],
  );
  console.log('SELECT count(*) FROM items WHERE group_id IN (3 position group ids) AND deleted_at IS NULL  →  ' +
    aliveInTargets + '   (expected 0)');

  const { rows: [{ n: legacyPost }] } = await c.query<{ n: string }>(
    `select count(*) as n from public.items where group_id = $1 and deleted_at is null`,
    [LEGACY_GROUP],
  );
  console.log("SELECT count(*) FROM items WHERE group_id = '" + LEGACY_GROUP + "' AND deleted_at IS NULL  →  " +
    legacyPost + '   (must equal ' + legacyPre.n + ' — Legacy unchanged)');

  const { rows: groupsAfter } = await c.query<{ id: string; name: string; sort_order: number }>(
    `select id, name, sort_order
       from public.groups
      where board_id = $1 and deleted_at is null
      order by sort_order, name`,
    [BOARD],
  );
  console.log('\nSELECT id, name FROM groups WHERE board_id = ' + BOARD + ' AND deleted_at IS NULL ORDER BY sort_order:');
  for (const g of groupsAfter) {
    console.log('  sort=' + g.sort_order + '  ' + g.id + '  "' + g.name + '"');
  }
  console.log('  → ' + groupsAfter.length + ' alive groups   (expected 5: 4 position + Legacy)');

  // ============== FINAL VERDICT LINE ==============
  const ok =
    Number(aliveInTargets) === 0 &&
    legacyPost === legacyPre.n &&
    groupsAfter.length === 5;
  console.log('\n' + (ok ? '✅ All three verify clauses pass.' : '❌ FAIL — verify failed, investigate above.'));
  if (!ok) process.exit(1);

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
