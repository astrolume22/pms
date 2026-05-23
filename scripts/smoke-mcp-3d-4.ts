/**
 * 3d chunk 4 verify — delete_task (soft).
 *   1. create a fresh task on the scratch board
 *   2. delete_task WITHOUT confirm_delete → refused
 *   3. delete_task WITH confirm_delete → success, items.deleted_at populated
 *   4. delete_task AGAIN → friendly "already deleted" error
 *   5. regression: list_boards still works
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }
const BOARD  = 'd96eb6f7-e266-4339-8000-77760d5d27c3';

const SB = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } });

interface RpcResp { result?: { structuredContent?: unknown; isError?: boolean }; error?: { code: number; message: string }; }
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

async function main() {
  // Find first surviving (non-deleted) group on the scratch board.
  const { data: grps } = await SB
    .from('groups').select('id, name').eq('board_id', BOARD).is('deleted_at', null).order('sort_order').limit(1);
  if (!grps || grps.length === 0) throw new Error('no live groups on scratch board — create one first');
  const groupId = (grps[0] as { id: string }).id;
  console.log(`Using group ${groupId} on scratch board`);

  // ===== create task for the delete dance =========================
  banner('[1/5] create_task to delete');
  const ct = await callTool<{ task_id: string }>('create_task', { board_id: BOARD, group_id: groupId, name: 'task to be deleted' });
  if (!ct.ok) throw new Error(`create_task: ${ct.error}`);
  const taskId = ct.data!.task_id;
  console.log(`  task = ${taskId}`);

  // ===== refusal ===================================================
  banner('[2/5] delete_task without confirm_delete → REFUSED');
  const noFlag = await callTool('delete_task', { task_id: taskId });
  console.log(`  ok    : ${noFlag.ok}`);
  console.log(`  error : ${noFlag.error}`);
  assert(!noFlag.ok, 'must refuse without confirm_delete');
  assert(/confirm_delete/i.test(noFlag.error ?? ''), 'refusal mentions confirm_delete');

  // ===== success ===================================================
  banner('[3/5] delete_task WITH confirm_delete → SUCCESS (soft)');
  const ok = await callTool<{ deleted_at: string }>('delete_task', { task_id: taskId, confirm_delete: true });
  if (!ok.ok) throw new Error(`delete_task ok: ${ok.error}`);
  console.log(`  deleted_at = ${ok.data!.deleted_at}`);
  const { data: row } = await SB.from('items').select('deleted_at, name').eq('id', taskId).maybeSingle();
  console.log(`  DB row    : ${JSON.stringify(row)}`);
  assert(!!(row as { deleted_at?: string } | null)?.deleted_at, 'items.deleted_at is set in DB');

  // ===== already-deleted ==========================================
  banner('[4/5] delete_task again → friendly "already deleted"');
  const again = await callTool('delete_task', { task_id: taskId, confirm_delete: true });
  console.log(`  ok    : ${again.ok}`);
  console.log(`  error : ${again.error}`);
  assert(!again.ok, 'second delete must refuse');
  assert(/already soft-deleted/i.test(again.error ?? ''), 'error notes already soft-deleted');

  // ===== regression =================================================
  banner('[5/5] regression — list_boards still returns boards');
  const lb = await callTool<{ boards: unknown[] }>('list_boards', {});
  assert(lb.ok && (lb.data!.boards.length ?? 0) > 0, 'list_boards still works');
  console.log(`  ${lb.data!.boards.length} boards.`);

  console.log('\n✅ 3d chunk 4 verified.');
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
