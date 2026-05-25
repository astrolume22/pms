/**
 * Tessera Chunk 2 — additive seed.
 *
 * Creates a brand-new board named "Team Projects (Tessera)" in the
 * Main workspace, reproducing the Tessera_Work_Management.html mockup
 * exactly:
 *   • 7 columns left → right: Task, [Task Code synthetic], Status,
 *     Task Type, Co-Work Time, Priority, Files.
 *   • 2 groups: "Team Red Projects" (#E2445C) and "Task for Axel Rose"
 *     (#00C875).
 *   • 12 tasks with task_code + Status / Task Type / Co-Work Time /
 *     Priority cells resolved to the labels by name.
 *
 * Idempotent: re-running deletes the prior "Team Projects (Tessera)"
 * board (and all its cascading rows) then re-inserts cleanly.
 *
 * Does NOT touch any other board, any other column, any other data.
 *
 * Run: npm run seed -- this script (or `npx tsx scripts/seed-tessera-board.ts`)
 * Requires .env.local with VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * + MASTER_ADMIN_USERNAME.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const url        = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminUser  = process.env.MASTER_ADMIN_USERNAME;
if (!url || !serviceKey || !adminUser) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MASTER_ADMIN_USERNAME');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BOARD_NAME = 'Team Projects (Tessera)';

// =====================================================================
// Spec — every literal value the mockup needs lives here so the script
// reads like the brief.
// =====================================================================

interface LabelSpec { name: string; color: string; sort_order: number; is_default?: boolean }
interface ColumnSpec {
  name: string;
  column_type: 'task_name' | 'status' | 'priority' | 'people' | 'date' | 'text' | 'numbers' | 'checkbox' | 'dropdown' | 'link' | 'files';
  width: number;
  sort_order: number;
  labels?: LabelSpec[];
}

const COLUMNS: ColumnSpec[] = [
  { name: 'Task',          column_type: 'task_name', width: 320, sort_order: 0 },
  { name: 'Status',        column_type: 'status',    width: 160, sort_order: 1, labels: [
    { name: 'Working on it',                 color: '#FDAB3D', sort_order: 0 },
    { name: 'Not Started',                   color: '#C4C4C4', sort_order: 1, is_default: true },
    { name: 'Done',                          color: '#00C875', sort_order: 2 },
    { name: 'Stuck',                         color: '#E2445C', sort_order: 3 },
    { name: 'Paused until 11A&11B Co...',    color: '#FF7575', sort_order: 4 },
  ]},
  { name: 'Task Type',     column_type: 'status',    width: 200, sort_order: 2, labels: [
    { name: 'Human & Co-Work',               color: '#00C0EF', sort_order: 0 },
    { name: 'Task Requires AI Co-Work',      color: '#037F4C', sort_order: 1 },
    { name: 'By Human',                      color: '#A25DDC', sort_order: 2 },
    { name: 'Task by Mark Only',             color: '#0086C0', sort_order: 3 },
  ]},
  { name: 'Co-Work Time',  column_type: 'status',    width: 160, sort_order: 3, labels: [
    { name: '5 - 10 minutes',                color: '#FDAB3D', sort_order: 0 },
    { name: '60-90 Minutes',                 color: '#FFCB00', sort_order: 1 },
    { name: '30-45 minutes',                 color: '#9CD326', sort_order: 2 },
    { name: '1-2 Hours',                     color: '#66CCFF', sort_order: 3 },
    { name: '2-3 Hours',                     color: '#FF158A', sort_order: 4 },
    { name: '2 - 2.5 hours',                 color: '#FDAB3D', sort_order: 5 },
    { name: '75-100 Minutes',                color: '#E2445C', sort_order: 6 },
    { name: 'Task by Mark Only',             color: '#0086C0', sort_order: 7 },
  ]},
  { name: 'Priority',      column_type: 'priority',  width: 130, sort_order: 4, labels: [
    { name: 'High',                          color: '#784BD1', sort_order: 0 },
    { name: 'Medium',                        color: '#5559DF', sort_order: 1 },
    { name: 'Low',                           color: '#579BFC', sort_order: 2 },
  ]},
  { name: 'Files',         column_type: 'files',     width: 100, sort_order: 5 },
];

interface GroupSpec {
  name: string;
  color: string;
  sort_order: number;
  tasks: TaskSpec[];
}

interface TaskSpec {
  task_code: string;
  name: string;
  status: string;
  task_type: string;
  co_work_time: string;
  priority: string;
}

const GROUPS: GroupSpec[] = [
  {
    name: 'Team Red Projects', color: '#E2445C', sort_order: 0,
    tasks: [
      { task_code: 'Task 1',  name: 'Read This Instruction -2',      status: 'Working on it', task_type: 'Human & Co-Work',          co_work_time: '5 - 10 minutes',   priority: 'High'   },
      { task_code: 'Task 2',  name: 'Prompt For Co Work',            status: 'Not Started',   task_type: 'Task Requires AI Co-Work', co_work_time: '2-3 Hours',        priority: 'High'   },
      { task_code: 'Task 3',  name: 'Your Personal Computer',        status: 'Not Started',   task_type: 'By Human',                 co_work_time: '1-2 Hours',        priority: 'High'   },
      { task_code: 'Task 4',  name: 'AI development',                status: 'Not Started',   task_type: 'Task Requires AI Co-Work', co_work_time: '1-2 Hours',        priority: 'High'   },
      { task_code: 'Task 5',  name: 'Site Audit',                    status: 'Not Started',   task_type: 'Task Requires AI Co-Work', co_work_time: '1-2 Hours',        priority: 'High'   },
      { task_code: 'Task 11', name: 'Scrape Psychic Competitor Ads', status: 'Working on it', task_type: 'Task Requires AI Co-Work', co_work_time: '60-90 Minutes',    priority: 'High'   },
    ],
  },
  {
    name: 'Task for Axel Rose', color: '#00C875', sort_order: 1,
    tasks: [
      { task_code: 'Task 11-A', name: 'Scrape Winning Shopify Products',         status: 'Not Started',                  task_type: 'Task Requires AI Co-Work', co_work_time: '2 - 2.5 hours',     priority: 'High'   },
      { task_code: 'Task 11-B', name: 'Validate Gap on TikTok Shop',             status: 'Not Started',                  task_type: 'Task Requires AI Co-Work', co_work_time: '75-100 Minutes',    priority: 'High'   },
      { task_code: 'Task 10',   name: 'finish page pilot setup',                 status: 'Not Started',                  task_type: 'By Human',                 co_work_time: 'Task by Mark Only', priority: 'High'   },
      { task_code: 'Task 12',   name: 'Shopify Product Research (P...)',        status: 'Paused until 11A&11B Co...',   task_type: 'Task Requires AI Co-Work', co_work_time: '2-3 Hours',         priority: 'Medium' },
      { task_code: 'Task 13',   name: 'Schedule Overnight Claude Run',           status: 'Not Started',                  task_type: 'Task Requires AI Co-Work', co_work_time: '30-45 minutes',     priority: 'Medium' },
      { task_code: 'Task 14',   name: 'Install Facebook Pixel on Psy...',       status: 'Working on it',                task_type: 'Task by Mark Only',        co_work_time: 'Task by Mark Only', priority: 'Medium' },
    ],
  },
];

// =====================================================================
// Helpers
// =====================================================================
async function lookupAdminId(): Promise<string> {
  const { data, error } = await admin
    .from('users')
    .select('id')
    .eq('username', adminUser)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Master admin user "${adminUser}" not found in public.users`);
  return data.id as string;
}

async function lookupMainWorkspaceId(): Promise<string> {
  const { data, error } = await admin
    .from('workspaces')
    .select('id')
    .eq('is_main', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Main workspace not found');
  return data.id as string;
}

async function deletePriorBoard(boardName: string): Promise<void> {
  const { data: existing, error } = await admin
    .from('boards')
    .select('id')
    .eq('name', boardName);
  if (error) throw error;
  if (!existing || existing.length === 0) {
    console.log(`  prior board: none (clean slate)`);
    return;
  }
  for (const b of existing) {
    const { error: dErr } = await admin.from('boards').delete().eq('id', b.id);
    if (dErr) throw dErr;
    console.log(`  prior board: deleted (${b.id})`);
  }
}

async function main() {
  console.log(`Seeding Tessera board "${BOARD_NAME}"...`);

  const adminId = await lookupAdminId();
  const wsId    = await lookupMainWorkspaceId();
  console.log(`  admin: ${adminId}`);
  console.log(`  workspace: ${wsId}`);

  // 0. Idempotent: drop any prior copy of this board.
  await deletePriorBoard(BOARD_NAME);

  // 1. Insert the board — the after_board_insert trigger auto-seeds
  //    1 group + 5 columns (Task / Status / Owner / Date / Priority)
  //    + 4 status labels + 4 priority labels. We reconcile next.
  const { data: board, error: bErr } = await admin
    .from('boards')
    .insert({
      workspace_id: wsId,
      name:         BOARD_NAME,
      icon_emoji:   '🟦',
      board_type:   'main',
      owner_id:     adminId,
      created_by:   adminId,
    })
    .select('id')
    .single();
  if (bErr) throw bErr;
  const boardId = board.id as string;
  console.log(`  board: created (${boardId})`);

  // 2. Reconcile auto-seeded structure.
  //    a) drop the seeded "Group Title" group
  const { error: gDelErr } = await admin
    .from('groups')
    .delete()
    .eq('board_id', boardId);
  if (gDelErr) throw gDelErr;

  //    b) drop the seeded non-task_name columns (Status / Owner / Date /
  //       Priority). The task_name column "Task" stays — the guard
  //       trigger forbids deleting it, and it's our column #1 anyway.
  //       Their column_labels cascade with the column delete (FK).
  const { error: cDelErr } = await admin
    .from('columns')
    .delete()
    .eq('board_id', boardId)
    .neq('column_type', 'task_name');
  if (cDelErr) throw cDelErr;
  console.log(`  reconcile: dropped seeded group + non-task_name columns`);

  // 3. Update the surviving task_name column to our spec width.
  const { data: taskNameCol, error: tnErr } = await admin
    .from('columns')
    .select('id')
    .eq('board_id', boardId)
    .eq('column_type', 'task_name')
    .maybeSingle();
  if (tnErr) throw tnErr;
  if (!taskNameCol) throw new Error('task_name column missing after reconcile');
  const taskCol = COLUMNS.find((c) => c.column_type === 'task_name')!;
  await admin
    .from('columns')
    .update({ name: taskCol.name, width: taskCol.width, sort_order: taskCol.sort_order })
    .eq('id', taskNameCol.id);

  // 4. Insert the rest of the columns.
  const columnIdByName = new Map<string, string>();
  columnIdByName.set(taskCol.name, taskNameCol.id as string);
  for (const col of COLUMNS) {
    if (col.column_type === 'task_name') continue;
    const { data: row, error } = await admin
      .from('columns')
      .insert({
        board_id:    boardId,
        name:        col.name,
        column_type: col.column_type,
        sort_order:  col.sort_order,
        width:       col.width,
      })
      .select('id')
      .single();
    if (error) throw error;
    columnIdByName.set(col.name, row.id as string);
  }
  console.log(`  columns: inserted (${columnIdByName.size} total)`);

  // 5. Insert column_labels.
  const labelIdByColName = new Map<string, Map<string, string>>();
  for (const col of COLUMNS) {
    if (!col.labels) continue;
    const colId = columnIdByName.get(col.name)!;
    const labelMap = new Map<string, string>();
    for (const l of col.labels) {
      const { data: lr, error: lErr } = await admin
        .from('column_labels')
        .insert({
          column_id:  colId,
          name:       l.name,
          color:      l.color,
          sort_order: l.sort_order,
          is_default: !!l.is_default,
        })
        .select('id')
        .single();
      if (lErr) throw lErr;
      labelMap.set(l.name, lr.id as string);
    }
    labelIdByColName.set(col.name, labelMap);
    console.log(`  labels: ${col.name} → ${labelMap.size}`);
  }

  // 6. Insert groups.
  const groupIdByName = new Map<string, string>();
  for (const g of GROUPS) {
    const { data: gr, error } = await admin
      .from('groups')
      .insert({
        board_id:   boardId,
        name:       g.name,
        color:      g.color,
        sort_order: g.sort_order,
      })
      .select('id')
      .single();
    if (error) throw error;
    groupIdByName.set(g.name, gr.id as string);
  }
  console.log(`  groups: inserted (${groupIdByName.size})`);

  // 7. Insert items + their cell values.
  let itemCount = 0;
  let cellCount = 0;
  for (const g of GROUPS) {
    const groupId = groupIdByName.get(g.name)!;
    let sort = 0;
    for (const t of g.tasks) {
      const { data: ir, error: iErr } = await admin
        .from('items')
        .insert({
          board_id:   boardId,
          group_id:   groupId,
          name:       t.name,
          task_code:  t.task_code,
          sort_order: sort++,
          created_by: adminId,
        })
        .select('id')
        .single();
      if (iErr) throw iErr;
      itemCount += 1;
      const itemId = ir.id as string;

      // Resolve and insert the 4 single-select cells.
      const resolveCell = (colName: string, labelName: string): { column_id: string; value: { label_id: string } } => {
        const colId = columnIdByName.get(colName);
        if (!colId) throw new Error(`column ${colName} missing`);
        const labelId = labelIdByColName.get(colName)?.get(labelName);
        if (!labelId) throw new Error(`label "${labelName}" missing on column ${colName}`);
        return { column_id: colId, value: { label_id: labelId } };
      };

      const cells = [
        { item_id: itemId, ...resolveCell('Status',       t.status)       },
        { item_id: itemId, ...resolveCell('Task Type',    t.task_type)    },
        { item_id: itemId, ...resolveCell('Co-Work Time', t.co_work_time) },
        { item_id: itemId, ...resolveCell('Priority',     t.priority)     },
      ];
      const { error: vErr } = await admin.from('item_column_values').insert(cells);
      if (vErr) throw vErr;
      cellCount += cells.length;
    }
  }
  console.log(`  items: ${itemCount} | cells: ${cellCount}`);

  // ----- Verification -----
  console.log('\n==== VERIFY ====');
  console.log(`board id: ${boardId}`);

  const { data: colsVerify } = await admin
    .from('columns')
    .select('id, name, column_type, sort_order, width')
    .eq('board_id', boardId)
    .order('sort_order');
  console.log('\nColumns (sort_order):');
  for (const c of colsVerify ?? []) {
    console.log(`  ${c.sort_order}. ${c.name.padEnd(14)} ${c.column_type.padEnd(10)} w=${c.width}`);
  }

  console.log('\nLabels (name → hex):');
  for (const col of COLUMNS) {
    if (!col.labels) continue;
    const colId = columnIdByName.get(col.name)!;
    const { data: labs } = await admin
      .from('column_labels')
      .select('name, color, sort_order')
      .eq('column_id', colId)
      .order('sort_order');
    console.log(`  ${col.name}:`);
    for (const l of labs ?? []) console.log(`    ${l.name.padEnd(36)} ${l.color}`);
  }

  const { data: grVerify } = await admin
    .from('groups')
    .select('id, name, color')
    .eq('board_id', boardId)
    .order('sort_order');
  console.log('\nGroups (name → color):');
  for (const g of grVerify ?? []) console.log(`  ${g.name.padEnd(28)} ${g.color}`);

  // Sample 3 tasks: read cells back and resolve label names.
  const { data: sampleItems } = await admin
    .from('items')
    .select('id, name, task_code')
    .eq('board_id', boardId)
    .order('sort_order')
    .limit(3);
  console.log('\nSample tasks — resolved cell label names:');
  for (const it of sampleItems ?? []) {
    const { data: vals } = await admin
      .from('item_column_values')
      .select('column_id, value')
      .eq('item_id', it.id);
    const resolved: string[] = [];
    for (const v of vals ?? []) {
      const col = (colsVerify ?? []).find((c) => c.id === v.column_id);
      const labelId = (v.value as { label_id?: string })?.label_id;
      let labelName = '(no value)';
      if (labelId) {
        const { data: lbl } = await admin.from('column_labels').select('name').eq('id', labelId).maybeSingle();
        labelName = lbl?.name ?? '(label not found)';
      }
      resolved.push(`${col?.name ?? '?'}=${labelName}`);
    }
    console.log(`  [${it.task_code}] ${it.name}`);
    console.log(`     ${resolved.join(' | ')}`);
  }

  console.log(`\n✅ Tessera board seeded.`);
  console.log(`   Open: ${url!.replace('.supabase.co', '')} → /w/main/b/${boardId}`);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
