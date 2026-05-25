/**
 * Chunk 5C — additive label seed for the EXISTING "Team Projects"
 * board.
 *
 * Adds the labels listed in the spec to its existing Status / Task
 * Type / Co-Work Time / Priority columns. Add-to-existing only —
 * NEVER deletes existing labels, NEVER creates new columns. If any
 * required column is missing, the script ABORTS and reports.
 *
 * Idempotent:
 *   • If a label with the exact name already exists on the column,
 *     its `color` is updated to match the spec hex (re-align).
 *   • If it doesn't, a new label row is inserted at the next
 *     sort_order with is_default=false.
 *
 * Single-row writes by id; never touches answers; no CASCADE.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const url        = process.env.VITE_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const BOARD_NAME = 'Team Projects';

interface LabelSpec { name: string; color: string }
const SPEC: Record<string, LabelSpec[]> = {
  Status: [
    { name: 'Done',                       color: '#00C875' },
    { name: 'New update',                 color: '#FF158A' },
    { name: 'Working on it',              color: '#FDAB3D' },
    { name: 'Stuck',                      color: '#E2445C' },
    { name: 'Requires John PC',           color: '#579BFC' },
    { name: 'Not Started',                color: '#808080' },
    { name: 'On Hold / Don\'t do t...',   color: '#C26175' },
    { name: 'Need Help',                  color: '#00A9D7' },
    { name: 'Daily Task',                 color: '#A25DDC' },
    { name: 'Paused until 11A&11...',     color: '#F68A5C' },
  ],
  'Task Type': [
    { name: 'Human & Co-Work',            color: '#00C0EF' },
    { name: 'Task by Mark Only',          color: '#0086C0' },
    { name: 'By Human',                   color: '#A25DDC' },
    { name: 'Task Requires AI Co-Work',   color: '#037F4C' },
  ],
  'Co-Work Time': [
    { name: '60-90 Minutes',              color: '#FDAB3D' },
    { name: '5 - 10 minutes',             color: '#FF7575' },
    { name: '75-100 Minutes',             color: '#E16E7F' },
    { name: '1-2 Hours',                  color: '#66CCFF' },
    { name: 'On Hold / Don\'t do t...',   color: '#C26175' },
    { name: '2 - 2.5 hours',              color: '#00A9D7' },
    { name: 'Task by Mark Only',          color: '#0073EA' },
    { name: '30-45 minutes',              color: '#B280DF' },
    { name: 'Task Requires Co-W...',      color: '#037F4C' },
    { name: '2-3 Hours',                  color: '#FF158A' },
  ],
  Priority: [
    { name: 'Critical',                   color: '#777E91' },
    { name: 'Very Important',             color: '#00C875' },
    { name: 'High',                       color: '#784BD1' },
    { name: 'Top Urgent',                 color: '#A25DDC' },
    { name: 'Medium',                     color: '#5559DF' },
    { name: 'Highest Priority',           color: '#E2445C' },
    { name: 'Low',                        color: '#579BFC' },
  ],
};

async function main() {
  console.log(`Seeding labels onto existing "${BOARD_NAME}" board…`);

  // 1. Find the board.
  const { data: boards, error: bErr } = await admin
    .from('boards')
    .select('id, name')
    .eq('name', BOARD_NAME)
    .is('deleted_at', null);
  if (bErr) throw bErr;
  if (!boards || boards.length === 0) {
    console.error(`❌ No board named "${BOARD_NAME}" found. ABORTING — refusing to create.`);
    process.exit(1);
  }
  if (boards.length > 1) {
    console.error(`⚠️  Multiple boards named "${BOARD_NAME}" (${boards.length}). Using first: ${boards[0].id}`);
  }
  const boardId = boards[0].id as string;
  console.log(`  board: ${boardId}`);

  // 2. Resolve every required column by board + name. ABORT if any missing.
  const { data: cols, error: cErr } = await admin
    .from('columns')
    .select('id, name, column_type')
    .eq('board_id', boardId)
    .is('archived_at', null);
  if (cErr) throw cErr;
  const colByName = new Map<string, { id: string; column_type: string }>();
  for (const c of cols ?? []) colByName.set(c.name as string, { id: c.id as string, column_type: c.column_type as string });

  const REQUIRED = Object.keys(SPEC);
  const missing = REQUIRED.filter((name) => !colByName.has(name));
  if (missing.length > 0) {
    console.error(`❌ "${BOARD_NAME}" is MISSING required columns: ${missing.join(', ')}.`);
    console.error(`   ABORTING per chunk-5 discipline ("do not silently add a column").`);
    process.exit(1);
  }
  console.log(`  columns confirmed present: ${REQUIRED.join(', ')}`);

  // 3. For each required column, fetch existing labels, then upsert
  //    label-by-label: update color if name matches, insert if not.
  let totalUpdated = 0;
  let totalInserted = 0;
  for (const [colName, labels] of Object.entries(SPEC)) {
    const col = colByName.get(colName)!;
    const { data: existing, error: lErr } = await admin
      .from('column_labels')
      .select('id, name, color, sort_order')
      .eq('column_id', col.id);
    if (lErr) throw lErr;
    const byName = new Map<string, { id: string; color: string }>(
      (existing ?? []).map((l) => [l.name as string, { id: l.id as string, color: l.color as string }])
    );
    const maxSort = Math.max(-1, ...(existing ?? []).map((l) => Number(l.sort_order ?? 0)));
    let nextSort = maxSort + 1;

    const colUpdated: string[] = [];
    const colInserted: string[] = [];
    for (const spec of labels) {
      const cur = byName.get(spec.name);
      if (cur) {
        if (cur.color.toUpperCase() !== spec.color.toUpperCase()) {
          const { error } = await admin
            .from('column_labels')
            .update({ color: spec.color } as never)
            .eq('id', cur.id);
          if (error) throw error;
          colUpdated.push(spec.name);
          totalUpdated += 1;
        }
      } else {
        const { error } = await admin
          .from('column_labels')
          .insert({
            column_id:  col.id,
            name:       spec.name,
            color:      spec.color,
            sort_order: nextSort++,
            is_default: false,
          } as never);
        if (error) throw error;
        colInserted.push(spec.name);
        totalInserted += 1;
      }
    }
    console.log(`  ${colName.padEnd(14)}  inserted=${colInserted.length}  recolored=${colUpdated.length}`);
    if (colInserted.length) console.log(`    + ${colInserted.join(' / ')}`);
    if (colUpdated.length)  console.log(`    ~ ${colUpdated.join(' / ')}`);
  }
  console.log(`\nTotals: inserted=${totalInserted}  recolored=${totalUpdated}`);

  // 4. Verification dump.
  console.log('\n==== VERIFY: "Team Projects" labels by column ====');
  for (const colName of REQUIRED) {
    const col = colByName.get(colName)!;
    const { data: labs } = await admin
      .from('column_labels')
      .select('name, color, sort_order, is_default')
      .eq('column_id', col.id)
      .order('sort_order');
    console.log(`\n  ${colName}:`);
    for (const l of labs ?? []) {
      console.log(`    ${(l.name as string).padEnd(36)} ${l.color}${l.is_default ? '  (default)' : ''}`);
    }
  }
  console.log(`\n✅ Seed complete.`);
}
main().catch((e) => { console.error('❌ FAILED:', e); process.exit(1); });
