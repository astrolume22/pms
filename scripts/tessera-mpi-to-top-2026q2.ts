/**
 * One-off: move the "Marketing & Planning Intelligence" group to the
 * top of the Tessera board (sort_order = 0) and shift the four groups
 * that used to sit above it down by one slot. Team Expert Advisor
 * stays at sort_order = 5 (unchanged).
 *
 * Why: the founder asked for MPI at the top of the board.
 *
 * Convention: single transaction, single-row writes by id only. One
 * CASE-based UPDATE statement covers the 5 moving rows in one shot so
 * no intermediate (board_id, sort_order) collision is possible even
 * if a unique constraint exists. Tessera's "answers" table is not
 * touched. Idempotent: re-running is a no-op once the final state is
 * already in place.
 *
 * Final order:
 *   0 — Marketing & Planning Intelligence  (was 4)
 *   1 — Team Stock Market                  (was 0)
 *   2 — Team Real Estate                   (was 1)
 *   3 — Team Green - For Review Only       (was 2)
 *   4 — Legacy / To Be Sorted              (was 3)
 *   5 — Team Expert Advisor                (unchanged)
 */
import './loadEnv';
import { Client } from 'pg';

const BOARD = '28472783-6d7a-4de9-8834-2354f62856c5';

const G_MPI       = '2d3a5b87-40de-4433-83aa-a59732b5c8f7'; // → 0
const G_STOCK     = '25e424e3-d44d-4c91-97a2-b30f3ed2a5f3'; // → 1
const G_REAL      = '5fd5ca28-6854-47b8-ac96-c61bb994aad0'; // → 2
const G_GREEN     = '7b124043-5cc4-468a-8a39-2d59b13cdeec'; // → 3
const G_LEGACY    = '3f222c05-fde9-40c6-8480-877c9d2b6623'; // → 4
const G_EXPERT    = '914de165-232c-4357-9756-48f6be2d15be'; // stays at 5

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // ============== PRE-SNAPSHOT ==============
  console.log('========== BEFORE ==========');
  const { rows: before } = await c.query<{ id: string; name: string; sort_order: number }>(
    `select id, name, sort_order from public.groups
      where board_id = $1 and deleted_at is null
      order by sort_order`,
    [BOARD],
  );
  for (const g of before) console.log('  sort=' + g.sort_order + '  ' + g.id + '  "' + g.name + '"');

  // ============== TRANSACTION ==============
  try {
    await c.query('begin');
    const res = await c.query(
      `update public.groups
          set sort_order = case id
                when $1::uuid then 0
                when $2::uuid then 1
                when $3::uuid then 2
                when $4::uuid then 3
                when $5::uuid then 4
              end,
              updated_at = now()
        where board_id = $6
          and id = any(array[$1, $2, $3, $4, $5]::uuid[])`,
      [G_MPI, G_STOCK, G_REAL, G_GREEN, G_LEGACY, BOARD],
    );
    console.log('\nupdated ' + res.rowCount + ' group rows (expected 5)');
    await c.query('commit');
    console.log('committed.');
  } catch (e) {
    await c.query('rollback');
    console.error('ROLLED BACK:', e);
    process.exit(1);
  }

  // ============== POST-VERIFY ==============
  console.log('\n========== AFTER ==========');
  const { rows: after } = await c.query<{ id: string; name: string; sort_order: number }>(
    `select id, name, sort_order from public.groups
      where board_id = $1 and deleted_at is null
      order by sort_order`,
    [BOARD],
  );
  for (const g of after) console.log('  sort=' + g.sort_order + '  ' + g.id + '  "' + g.name + '"');

  // Strict verify
  const expected: Record<string, number> = {
    [G_MPI]: 0,
    [G_STOCK]: 1,
    [G_REAL]: 2,
    [G_GREEN]: 3,
    [G_LEGACY]: 4,
    [G_EXPERT]: 5,
  };
  const got = Object.fromEntries(after.map((g) => [g.id, g.sort_order])) as Record<string, number>;
  let ok = true;
  for (const [id, exp] of Object.entries(expected)) {
    if (got[id] !== exp) { ok = false; console.log('  MISMATCH ' + id + ' expected=' + exp + ' got=' + got[id]); }
  }
  if (after.length !== 6) { ok = false; console.log('  WRONG GROUP COUNT — got ' + after.length + ', expected 6'); }
  console.log('\n' + (ok ? '✅ Final order verified.' : '❌ FAIL — verify failed, investigate above.'));
  if (!ok) process.exit(1);

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
