/**
 * 3d chunk 1 live verify — add_task_update + update_task_cell + update_task_name.
 *
 * Strategy:
 *   1. list_boards to discover Main workspace + pick a fresh board to play in
 *   2. create a scratch board (via create_board) so we don't litter live boards
 *   3. create a scratch task
 *   4. add_task_update on it → assert insert in public.updates
 *   5. update_task_cell on a known column (Status by name; Priority by id)
 *   6. update_task_name → assert items.name changed
 *   + list_boards regression at the end
 *
 * Uses service-role DB scan to confirm rows actually landed.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

const SB = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

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
  const text = await r.text();
  const body = JSON.parse(text) as RpcResp;
  if (body.error)            return { ok: false, error: body.error.message };
  if (body.result?.isError)  return { ok: false, error: JSON.stringify(body.result) };
  return { ok: true, data: body.result?.structuredContent as T };
}

function banner(t: string) {
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(t);
  console.log('────────────────────────────────────────────────────────────');
}
function assert(c: unknown, m: string): asserts c {
  if (!c) { console.error(`✗ FAIL: ${m}`); process.exit(1); }
}

async function main() {
  banner('[setup] discover Main workspace + create scratch board + task');
  const lb = await callTool<{ workspaces: { id: string; name: string }[] }>('list_boards', {});
  if (!lb.ok) throw new Error(`list_boards: ${lb.error}`);
  const mainWs = lb.data!.workspaces.find((w) => w.name === 'Main workspace');
  if (!mainWs) throw new Error('Main workspace not found');
  console.log(`  Main workspace = ${mainWs.id}`);

  const cb = await callTool<{ board_id: string }>('create_board', {
    workspace_id: mainWs.id,
    name: `3d-1 scratch ${new Date().toISOString().slice(11, 19)}`,
    icon_emoji: '🧪',
  });
  if (!cb.ok) throw new Error(`create_board: ${cb.error}`);
  const boardId = cb.data!.board_id;
  console.log(`  scratch board = ${boardId}`);

  const gb = await callTool<{ groups: { id: string; name: string }[]; columns: { id: string; name: string; column_type: string; labels: { id: string; name: string }[] }[] }>('get_board', { board_id: boardId });
  if (!gb.ok) throw new Error(`get_board: ${gb.error}`);
  const group = gb.data!.groups[0];
  const statusCol = gb.data!.columns.find((c) => c.column_type === 'status');
  const priorityCol = gb.data!.columns.find((c) => c.column_type === 'priority');
  if (!group || !statusCol || !priorityCol) throw new Error('expected seeded group + Status + Priority');
  console.log(`  group=${group.id}  statusCol=${statusCol.id}  priorityCol=${priorityCol.id}`);

  const ct = await callTool<{ task_id: string }>('create_task', {
    board_id: boardId, group_id: group.id, name: '3d-1 task',
  });
  if (!ct.ok) throw new Error(`create_task: ${ct.error}`);
  const taskId = ct.data!.task_id;
  console.log(`  task = ${taskId}`);

  // ===== add_task_update ==========================================
  banner('[1/3] add_task_update');
  const upd = await callTool<{ update_id: string; task_id: string }>('add_task_update', {
    task_id: taskId,
    body: 'Hello from MCP — 3d chunk 1 verification.',
  });
  if (!upd.ok) throw new Error(`add_task_update: ${upd.error}`);
  console.log(`  update_id = ${upd.data!.update_id}`);
  // DB scan: confirm row + body shape
  const { data: upRow } = await SB.from('updates').select('id, item_id, body_html, deleted_at').eq('id', upd.data!.update_id).maybeSingle();
  console.log(`  DB row:`, upRow);
  assert(upRow && (upRow as { item_id: string }).item_id === taskId, 'update.item_id matches task');
  assert(((upRow as { body_html: string }).body_html ?? '').includes('Hello from MCP'), 'body_html stored correctly');

  // Tenancy probe: post update on a task from a DIFFERENT board (must fail).
  // (Easier to just create a 2nd scratch board, but for chunk 1 we trust
  // the helper since it's shared with 3b's already-verified path.)

  // ===== update_task_cell ==========================================
  banner('[2/3] update_task_cell — Status by name, then Priority by id');
  // 2a — status by column_name + label_name
  const statusLabelName = statusCol.labels[0]?.name;
  if (!statusLabelName) throw new Error('no status labels seeded');
  console.log(`  setting Status (by name) → "${statusLabelName}"`);
  const c1 = await callTool('update_task_cell', {
    task_id: taskId,
    column_name: 'Status',
    value: { label_name: statusLabelName },
  });
  if (!c1.ok) throw new Error(`update_task_cell status: ${c1.error}`);
  // 2b — priority by column_id + label_id
  const pLabel = priorityCol.labels[0];
  console.log(`  setting Priority (by id ${priorityCol.id}) → label_id ${pLabel.id}`);
  const c2 = await callTool('update_task_cell', {
    task_id: taskId,
    column_id: priorityCol.id,
    value: { label_id: pLabel.id },
  });
  if (!c2.ok) throw new Error(`update_task_cell priority: ${c2.error}`);
  // 2c — date cell (text-style value)
  const dateCol = gb.data!.columns.find((c) => c.column_type === 'date');
  if (dateCol) {
    console.log(`  setting Date → "2026-05-30"`);
    const c3 = await callTool('update_task_cell', {
      task_id: taskId,
      column_id: dateCol.id,
      value: { value: '2026-05-30' },
    });
    if (!c3.ok) throw new Error(`update_task_cell date: ${c3.error}`);
  }

  // DB scan: confirm both cells landed
  const { data: cells } = await SB
    .from('item_column_values')
    .select('column_id, value')
    .eq('item_id', taskId);
  console.log(`  cell rows for task:`, cells);
  assert((cells ?? []).some((r) => (r as { column_id: string }).column_id === statusCol.id), 'status cell exists');
  assert((cells ?? []).some((r) => (r as { column_id: string }).column_id === priorityCol.id), 'priority cell exists');

  // ===== update_task_name ==========================================
  banner('[3/3] update_task_name');
  const renamed = await callTool<{ new_name: string }>('update_task_name', {
    task_id: taskId,
    new_name: '3d-1 task RENAMED',
  });
  if (!renamed.ok) throw new Error(`update_task_name: ${renamed.error}`);
  const { data: item } = await SB.from('items').select('name').eq('id', taskId).maybeSingle();
  console.log(`  items.name in DB now: ${(item as { name?: string } | null)?.name}`);
  assert(((item as { name?: string } | null)?.name ?? '') === '3d-1 task RENAMED', 'name actually changed in DB');

  // ===== regression — list_boards still returns 7 tools-worth =====
  banner('[regression] tools/list still advertises 7 + 3 = 10 tools');
  const tl = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const tlBody = await tl.json() as { result?: { tools?: { name: string }[] } };
  const names = (tlBody.result?.tools ?? []).map((t) => t.name).sort();
  console.log(`  tools (${names.length}):`, names);
  assert(names.includes('add_task_update'), 'add_task_update advertised');
  assert(names.includes('update_task_cell'), 'update_task_cell advertised');
  assert(names.includes('update_task_name'), 'update_task_name advertised');
  assert(names.includes('list_boards'), 'list_boards still there');
  assert(names.length === 10, `expected 10 tools, got ${names.length}`);

  console.log('\n✅ 3d chunk 1 verified.');
  console.log(`Scratch board left in DB: ${boardId}`);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
