/**
 * Live JSON-RPC verification for the 3 new column tools + the
 * "QA Test" cleanup the user asked for.
 *
 * Tools tested (every call is a real tools/call JSON-RPC POST):
 *   add_column_label  — happy path (Leave) + non-labelable type refusal
 *   delete_column     — refuse w/o confirm_delete, refuse on task_name,
 *                       then succeed on the duplicate Status column
 *   rename_column     — happy path (renames a throw-away column we made
 *                       earlier on the QA Test board)
 *
 * Cleanup sequence on QA Test board (25d1a287-…):
 *   1. get_board BEFORE — show 2 Status columns
 *   2. delete_column on bf7ed40b-…  (duplicate)
 *   3. add_column_label on 7ff1273f-…  (original) → "Leave" (teal)
 *   4. update_task_cell on Regression testing → Status: "Leave" (by name)
 *   5. get_board AFTER — show exactly one Status column with 11 labels
 *      (10 originals + Leave), Regression testing.cells[status] points
 *      at the Leave label
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

const QA_BOARD            = '25d1a287-6634-4ab5-92da-386bac80aca6';
const ORIGINAL_STATUS_COL = '7ff1273f-635d-4882-9f39-eed2d34c8ae6';
const DUPLICATE_STATUS_COL = 'bf7ed40b-31b9-477d-ab0f-613f10ea33ed';
const TASK_NAME_COL       = '7e4846fa-7ea4-4b70-8a48-9e99128fa7eb';
const INSTRUCTIONS_COL    = 'c1e44add-e87b-4d74-b365-7f8d4de291de';

const SB = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } });

interface RpcResp {
  result?: { structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
}

async function callTool<T>(name: string, args: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = JSON.parse(await r.text()) as RpcResp;
  if (body.error)           return { ok: false, error: body.error.message };
  if (body.result?.isError) return { ok: false, error: JSON.stringify(body.result) };
  return { ok: true, data: body.result?.structuredContent as T };
}
function banner(t: string) { console.log('\n────────────────────────────────────────────────────────────\n' + t + '\n────────────────────────────────────────────────────────────'); }
function assert(c: unknown, m: string): asserts c { if (!c) { console.error(`✗ FAIL: ${m}`); process.exit(1); } }

interface BoardSnap {
  board: { id: string; name: string; workspace_id: string };
  columns: Array<{ id: string; name: string; column_type: string; sort_order: number; labels: { id: string; name: string; color: string }[] }>;
  tasks: Array<{ id: string; name: string; cells: Record<string, unknown> }>;
  task_count: number;
}

async function getBoard(): Promise<BoardSnap> {
  const r = await callTool<BoardSnap>('get_board', { board_id: QA_BOARD });
  if (!r.ok) throw new Error(`get_board: ${r.error}`);
  return r.data!;
}

function printColumns(label: string, snap: BoardSnap) {
  const statusCols = snap.columns.filter((c) => c.column_type === 'status' && /^status$/i.test(c.name));
  console.log(`  ${label}: ${snap.columns.length} columns total; ${statusCols.length} named "Status"`);
  for (const c of snap.columns.sort((a, b) => a.sort_order - b.sort_order)) {
    console.log(`    sort=${c.sort_order}  ${c.id}  type=${c.column_type}  name="${c.name}"  labels=${c.labels.length}`);
  }
}

async function main() {
  // ===== BEFORE snapshot ===========================================
  banner('[0/8] get_board BEFORE — should show 2 Status columns');
  const before = await getBoard();
  printColumns('BEFORE', before);
  assert(before.columns.filter((c) => c.column_type === 'status' && c.name === 'Status').length === 2,
    'BEFORE: expected exactly 2 columns named "Status"');

  // ===== [1] add_column_label — refusal on non-labelable column ====
  banner('[1/8] add_column_label on INSTRUCTIONS (text column) → must refuse');
  const r1 = await callTool('add_column_label', {
    column_id: INSTRUCTIONS_COL,
    labels: [{ name: 'should-not-land' }],
  });
  console.log(`  ok=${r1.ok}  error=${r1.error}`);
  assert(!r1.ok, 'must refuse — labels only apply to status/priority/dropdown');
  assert(/status\/priority\/dropdown|only apply/i.test(r1.error ?? ''), 'refusal explains');

  // ===== [2] delete_column — refusal without confirm_delete ========
  banner('[2/8] delete_column on duplicate Status WITHOUT confirm_delete → must refuse');
  const r2 = await callTool('delete_column', { column_id: DUPLICATE_STATUS_COL });
  console.log(`  ok=${r2.ok}  error=${r2.error}`);
  assert(!r2.ok, 'must refuse without confirm_delete');
  assert(/confirm_delete/i.test(r2.error ?? ''), 'refusal mentions confirm_delete');

  // ===== [3] delete_column on task_name → must refuse even with flag
  banner('[3/8] delete_column on task_name column WITH confirm_delete → must STILL refuse');
  const r3 = await callTool('delete_column', { column_id: TASK_NAME_COL, confirm_delete: true });
  console.log(`  ok=${r3.ok}  error=${r3.error}`);
  assert(!r3.ok, 'must refuse task_name column');
  assert(/task_name|required per board/i.test(r3.error ?? ''), 'refusal explains task_name guard');

  // ===== [4] delete_column on duplicate WITH confirm_delete → SUCCESS
  banner('[4/8] delete_column on duplicate Status WITH confirm_delete → SUCCESS (soft)');
  const r4 = await callTool<{ archived_at: string; column_name: string }>('delete_column', {
    column_id: DUPLICATE_STATUS_COL, confirm_delete: true,
  });
  if (!r4.ok) throw new Error(`delete_column: ${r4.error}`);
  console.log(`  archived_at = ${r4.data!.archived_at}`);
  const { data: dupRow } = await SB
    .from('columns').select('archived_at, name').eq('id', DUPLICATE_STATUS_COL).maybeSingle();
  console.log(`  DB row:`, dupRow);
  assert(!!(dupRow as { archived_at?: string } | null)?.archived_at, 'archived_at set in DB');

  // ===== [5] add_column_label on ORIGINAL Status — Leave (teal) ====
  banner('[5/8] add_column_label on ORIGINAL Status → "Leave" (teal-ish)');
  const r5 = await callTool<{ inserted: { id: string; name: string; color: string; sort_order: number }[] }>('add_column_label', {
    column_id: ORIGINAL_STATUS_COL,
    labels: [{ name: 'Leave', color: '#55A8A8' }], // soft teal
  });
  if (!r5.ok) throw new Error(`add_column_label: ${r5.error}`);
  console.log(`  inserted:`, r5.data!.inserted);
  const leaveLabelId = r5.data!.inserted[0]!.id;
  // DB scan
  const { data: leaveRow } = await SB
    .from('column_labels').select('id, name, color, sort_order').eq('id', leaveLabelId).maybeSingle();
  console.log(`  DB row:`, leaveRow);
  assert((leaveRow as { name?: string } | null)?.name === 'Leave', 'Leave label exists in DB');

  // ===== [6] update_task_cell — Regression testing → Leave (raw str)
  banner('[6/8] update_task_cell — Regression testing.Status = "Leave" (raw string, hotfix path)');
  // Discover the task id via get_board.tasks[]
  const mid = await getBoard();
  const regression = mid.tasks.find((t) => /regression testing/i.test(t.name));
  assert(!!regression, 'Regression testing task present');
  const r6 = await callTool('update_task_cell', {
    task_id:   regression!.id,
    column_id: ORIGINAL_STATUS_COL,
    value:     'Leave',   // raw string — the hotfix shape
  });
  if (!r6.ok) throw new Error(`update_task_cell: ${r6.error}`);
  // DB scan
  const { data: cellRow } = await SB
    .from('item_column_values')
    .select('value').eq('item_id', regression!.id).eq('column_id', ORIGINAL_STATUS_COL).maybeSingle();
  console.log(`  Regression testing.Status =`, cellRow);
  const got = (cellRow as { value?: { label_id?: string } } | null)?.value?.label_id;
  assert(got === leaveLabelId, `Regression testing.label_id must be the Leave label (got ${got})`);

  // ===== [7] rename_column on a throw-away column ==================
  banner('[7/8] rename_column — make a throw-away column then rename it');
  const rcMake = await callTool<{ column_id: string }>('create_column', {
    board_id: QA_BOARD, name: 'temp-for-rename', column_type: 'text',
  });
  if (!rcMake.ok) throw new Error(`create_column: ${rcMake.error}`);
  const tempCol = rcMake.data!.column_id;
  console.log(`  temp col = ${tempCol}`);
  const r7 = await callTool('rename_column', { column_id: tempCol, new_name: 'temp-RENAMED' });
  if (!r7.ok) throw new Error(`rename_column: ${r7.error}`);
  const { data: rnRow } = await SB.from('columns').select('name').eq('id', tempCol).maybeSingle();
  console.log(`  DB.name = ${(rnRow as { name?: string } | null)?.name}`);
  assert(((rnRow as { name?: string } | null)?.name ?? '') === 'temp-RENAMED', 'rename persisted');
  // Clean up the throw-away column so QA Test stays tidy.
  await callTool('delete_column', { column_id: tempCol, confirm_delete: true });

  // ===== [8] AFTER snapshot ========================================
  banner('[8/8] get_board AFTER — 1 Status column with Leave; Regression testing on Leave');
  const after = await getBoard();
  printColumns('AFTER', after);
  const liveStatus = after.columns.filter((c) => c.column_type === 'status' && c.name === 'Status');
  assert(liveStatus.length === 1, `AFTER: expected exactly 1 live "Status" column, got ${liveStatus.length}`);
  assert(liveStatus[0].id === ORIGINAL_STATUS_COL, 'AFTER: surviving Status column is the original');
  const labelNames = liveStatus[0].labels.map((l) => l.name);
  console.log(`  Original Status now has labels:`, labelNames);
  assert(labelNames.includes('Leave'), 'AFTER: Leave label is in the original column');

  const regressionAfter = after.tasks.find((t) => /regression testing/i.test(t.name));
  console.log(`  Regression testing.cells[status] =`, (regressionAfter?.cells ?? {})[ORIGINAL_STATUS_COL]);
  assert(
    ((regressionAfter?.cells ?? {})[ORIGINAL_STATUS_COL] as { label_id?: string })?.label_id === leaveLabelId,
    'AFTER: Regression testing points at Leave',
  );

  // ===== regression — list_boards still works =====================
  banner('[regression] list_boards still works');
  const lb = await callTool<{ boards: unknown[] }>('list_boards', {});
  assert(lb.ok && (lb.data!.boards.length ?? 0) > 0, 'list_boards still works');
  console.log(`  ${lb.data!.boards.length} boards listed.`);

  // ===== regression — tools/list shows 22 tools ===================
  banner('[regression] tools/list now advertises 22 tools (19 + 3 new)');
  const tl = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const tlBody = await tl.json() as { result?: { tools?: { name: string }[] } };
  const names = (tlBody.result?.tools ?? []).map((t) => t.name).sort();
  console.log(`  ${names.length} tools advertised`);
  for (const n of ['add_column_label', 'delete_column', 'rename_column']) {
    assert(names.includes(n), `${n} advertised`);
  }
  assert(names.length === 22, `expected 22 tools, got ${names.length}`);

  console.log('\n✅ 3d follow-up #2 verified end-to-end. Duplicate Status column gone, Leave label added, Regression testing set to Leave.');
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
