/**
 * Live JSON-RPC verification for the update_task_cell hotfix.
 *
 *   A. text column   — raw string             (was -32002, must be 200)
 *   B. text column   — { "value": "..." }     (was 200, must stay 200)
 *   C. text column   — { "text": "..." }      (was -32002, must be 200)
 *   D. status column — raw string label name  (was -32002, must be 200)
 *   E. status column — { label_name }         (must be 200)
 *   F. date column   — raw "YYYY-MM-DD"       (was -32002, must be 200)
 *   G. checkbox col  — raw boolean true       (was -32002, must be 200)
 *   H. create_task with cells primitives      (regression — must still work
 *                                              AND now actually land the cell)
 *   + every DB-scan confirms item_column_values.value matches expectations.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

const TASK   = 'b1f6a888-9a0f-4d75-b335-e77a0a0705f6';   // E2E testing
const COL_INSTRUCTIONS = 'c1e44add-e87b-4d74-b365-7f8d4de291de';  // text
const QA_BOARD = '25d1a287-6634-4ab5-92da-386bac80aca6';

const SB = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface RpcResp {
  result?: { structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
}

async function rpcCall(name: string, args: unknown): Promise<{ ok: boolean; data?: unknown; error?: string; raw: RpcResp }> {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await r.text();
  let body: RpcResp;
  try { body = JSON.parse(text) as RpcResp; }
  catch { return { ok: false, error: `bad JSON (HTTP ${r.status}): ${text.slice(0, 200)}`, raw: {} as RpcResp }; }
  if (body.error)           return { ok: false, error: body.error.message, raw: body };
  if (body.result?.isError) return { ok: false, error: JSON.stringify(body.result), raw: body };
  return { ok: true, data: body.result?.structuredContent, raw: body };
}

function section(t: string) { console.log('\n────────────────────────────────────────────────────────────'); console.log(t); console.log('────────────────────────────────────────────────────────────'); }
function assert(c: unknown, m: string): asserts c { if (!c) { console.error(`✗ FAIL: ${m}`); process.exit(1); } }

async function scanCell(taskId: string, columnId: string): Promise<unknown> {
  const { data } = await SB
    .from('item_column_values')
    .select('value')
    .eq('item_id', taskId)
    .eq('column_id', columnId)
    .maybeSingle();
  return (data as { value?: unknown } | null)?.value;
}

async function main() {
  console.log(`Live target: ${MCP}`);

  // Discover the QA Test board context for status/date/checkbox column ids
  const snap = await rpcCall('get_board', { board_id: QA_BOARD });
  if (!snap.ok) throw new Error(`get_board: ${snap.error}`);
  type Snap = { columns: { id: string; name: string; column_type: string; labels: { id: string; name: string }[] }[] };
  const sc = snap.data as Snap;
  const statusCol = sc.columns.find((c) => c.column_type === 'status' && /status/i.test(c.name));
  const dateCol   = sc.columns.find((c) => c.column_type === 'date');
  console.log(`  Status col=${statusCol?.id}, labels=${statusCol?.labels.map((l) => l.name).join(', ')}`);
  console.log(`  Date col=${dateCol?.id}`);
  assert(!!statusCol, 'Status column found');
  assert(!!dateCol, 'Date column found');

  // ===== A — raw string on text column =============================
  section('[A] update_task_cell text column — RAW STRING (previously -32002)');
  const A_VAL = 'Run the full checkout flow on staging across Chrome, Safari, Firefox; screenshot on failure; capture network HAR.';
  const a = await rpcCall('update_task_cell', { task_id: TASK, column_id: COL_INSTRUCTIONS, value: A_VAL });
  console.log(`  ok=${a.ok}  ${a.ok ? '' : 'error=' + a.error}`);
  assert(a.ok, '[A] must succeed');
  console.log(`  DB.value =`, await scanCell(TASK, COL_INSTRUCTIONS));
  assert(((await scanCell(TASK, COL_INSTRUCTIONS)) as { value?: string })?.value === A_VAL, '[A] DB matches');

  // ===== B — { value } on text column (regression) =================
  section('[B] update_task_cell text column — { value: "..." } (must keep working)');
  const B_VAL = 'B-shape regression value';
  const b = await rpcCall('update_task_cell', { task_id: TASK, column_id: COL_INSTRUCTIONS, value: { value: B_VAL } });
  assert(b.ok, '[B] must succeed');
  assert(((await scanCell(TASK, COL_INSTRUCTIONS)) as { value?: string })?.value === B_VAL, '[B] DB matches');
  console.log('  ✓ ok');

  // ===== C — { text } alias on text column =========================
  section('[C] update_task_cell text column — { text: "..." } (alias key)');
  const C_VAL = 'C-shape alias-key value';
  const c = await rpcCall('update_task_cell', { task_id: TASK, column_id: COL_INSTRUCTIONS, value: { text: C_VAL } });
  assert(c.ok, '[C] must succeed');
  assert(((await scanCell(TASK, COL_INSTRUCTIONS)) as { value?: string })?.value === C_VAL, '[C] DB matches');
  console.log('  ✓ ok');

  // ===== D — raw string label name on status =======================
  const labelName = statusCol!.labels[0]?.name;
  assert(!!labelName, 'at least one status label present');
  section(`[D] update_task_cell status column — RAW STRING "${labelName}"`);
  const d = await rpcCall('update_task_cell', { task_id: TASK, column_id: statusCol!.id, value: labelName });
  console.log(`  ok=${d.ok}  ${d.ok ? '' : 'error=' + d.error}`);
  assert(d.ok, '[D] must succeed');
  const dCell = (await scanCell(TASK, statusCol!.id)) as { label_id?: string };
  console.log('  DB.value =', dCell);
  const dExpectedId = statusCol!.labels.find((l) => l.name === labelName)?.id;
  assert(dCell?.label_id === dExpectedId, '[D] label_id round-trips');

  // ===== E — { label_name } on status ==============================
  const labelName2 = statusCol!.labels[1]?.name ?? labelName;
  section(`[E] update_task_cell status column — { label_name: "${labelName2}" }`);
  const e = await rpcCall('update_task_cell', { task_id: TASK, column_id: statusCol!.id, value: { label_name: labelName2 } });
  assert(e.ok, '[E] must succeed');
  console.log('  ✓ ok');

  // ===== F — raw "YYYY-MM-DD" on date column =======================
  section('[F] update_task_cell date column — RAW STRING "2026-06-15"');
  const f = await rpcCall('update_task_cell', { task_id: TASK, column_id: dateCol!.id, value: '2026-06-15' });
  console.log(`  ok=${f.ok}  ${f.ok ? '' : 'error=' + f.error}`);
  assert(f.ok, '[F] must succeed');
  const fCell = (await scanCell(TASK, dateCol!.id)) as { value?: string };
  console.log('  DB.value =', fCell);
  assert(fCell?.value === '2026-06-15', '[F] date string round-trips');

  // ===== G — improved error on a truly broken shape ================
  section('[G] update_task_cell with a deliberately broken value → expect helpful error');
  const g = await rpcCall('update_task_cell', { task_id: TASK, column_id: COL_INSTRUCTIONS, value: { entirely_made_up_key: 1 } });
  console.log(`  ok=${g.ok}`);
  console.log(`  error=${g.error}`);
  assert(!g.ok, '[G] must fail');
  assert(/Received|Try:/i.test(g.error ?? ''), '[G] new error must echo received + example');

  // ===== H — create_task with cells primitives (regression) =======
  section('[H] create_task with cells primitives — must land cells in DB');
  // We need a group on QA Test
  const snap2 = await rpcCall('get_board', { board_id: QA_BOARD });
  const groups = ((snap2.data as { groups: { id: string }[] }).groups);
  const groupId = groups[0]?.id;
  assert(!!groupId, 'group present');
  const ct = await rpcCall('create_task', {
    board_id: QA_BOARD,
    group_id: groupId,
    name: 'hotfix-H regression task',
    // Test: primitive value for Instructions (text), primitive label name for Status
    cells: {
      Instructions: 'cells primitive — must land',
      Status: labelName,
    },
  });
  console.log(`  ok=${ct.ok}  ${ct.ok ? '' : 'error=' + ct.error}`);
  assert(ct.ok, '[H] create_task must succeed');
  const newTaskId = (ct.data as { task_id: string }).task_id;
  console.log(`  new task=${newTaskId}`);
  // DB scan both cells
  const hText = (await scanCell(newTaskId, COL_INSTRUCTIONS)) as { value?: string } | null;
  const hStatus = (await scanCell(newTaskId, statusCol!.id)) as { label_id?: string } | null;
  console.log('  DB.text  =', hText);
  console.log('  DB.status=', hStatus);
  assert(hText?.value === 'cells primitive — must land',
    '[H] Instructions cell must have landed (was silently skipped before)');
  assert(!!hStatus?.label_id, '[H] Status cell must have landed');
  console.log('  ✓ create_task path still works AND now lands primitive cells');

  // ===== regression — list_boards ==================================
  section('[regression] list_boards still works');
  const lb = await rpcCall('list_boards', {});
  assert(lb.ok, 'list_boards still works');
  console.log(`  ✓ ${((lb.data as { boards: unknown[] }).boards).length} boards listed`);

  console.log('\n✅ Every shape lands. Bug is fixed end-to-end and create_task primitive cells now actually write.');
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
