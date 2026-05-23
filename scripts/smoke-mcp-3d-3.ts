/**
 * 3d chunk 3 live verify — group ops.
 *   1. create_group on the scratch board
 *   2. rename_group
 *   3. delete_group WITHOUT confirm_delete   → refused
 *   4. delete_group on an EMPTY group with confirm_delete → success, DB shows deleted_at
 *   5. delete_group on a POPULATED group WITHOUT confirm_delete_with_tasks → refused
 *      (we'll create a task into it first)
 *   6. delete_group on populated group WITH confirm_delete_with_tasks → success
 *   7. regression: list_boards still works
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }
const BOARD  = 'd96eb6f7-e266-4339-8000-77760d5d27c3';

const SB = createClient(
  process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface RpcResp { result?: { structuredContent?: unknown; isError?: boolean }; error?: { code: number; message: string }; }
async function callTool<T>(name: string, args: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await r.text();
  const body = JSON.parse(text) as RpcResp;
  if (body.error)           return { ok: false, error: body.error.message };
  if (body.result?.isError) return { ok: false, error: JSON.stringify(body.result) };
  return { ok: true, data: body.result?.structuredContent as T };
}
function banner(t: string) {
  console.log('\n────────────────────────────────────────────────────────────'); console.log(t);
  console.log('────────────────────────────────────────────────────────────');
}
function assert(c: unknown, m: string): asserts c { if (!c) { console.error(`✗ FAIL: ${m}`); process.exit(1); } }

async function main() {
  // ===== create_group =============================================
  banner('[1/6] create_group "Empty Group" + "Populated Group" on scratch board');
  const g1 = await callTool<{ group_id: string }>('create_group', { board_id: BOARD, name: 'Empty Group' });
  if (!g1.ok) throw new Error(`create_group empty: ${g1.error}`);
  const emptyGroupId = g1.data!.group_id;
  console.log(`  empty group = ${emptyGroupId}`);
  const g2 = await callTool<{ group_id: string }>('create_group', { board_id: BOARD, name: 'Populated Group', color: '#FF3D8B' });
  if (!g2.ok) throw new Error(`create_group populated: ${g2.error}`);
  const popGroupId = g2.data!.group_id;
  console.log(`  populated group = ${popGroupId}`);

  // Seed populated group with one task.
  const ct = await callTool<{ task_id: string }>('create_task', {
    board_id: BOARD, group_id: popGroupId, name: 'task inside populated group',
  });
  if (!ct.ok) throw new Error(`create_task: ${ct.error}`);
  console.log(`  task inside populated group = ${ct.data!.task_id}`);

  // ===== rename_group =============================================
  banner('[2/6] rename_group');
  const rn = await callTool<{ new_name: string }>('rename_group', {
    group_id: emptyGroupId, new_name: 'Empty Group (renamed)',
  });
  if (!rn.ok) throw new Error(`rename_group: ${rn.error}`);
  const { data: rgRow } = await SB.from('groups').select('name').eq('id', emptyGroupId).maybeSingle();
  console.log(`  groups.name in DB: ${(rgRow as { name?: string } | null)?.name}`);
  assert(((rgRow as { name?: string } | null)?.name ?? '') === 'Empty Group (renamed)', 'rename persisted');

  // ===== delete_group refused without confirm_delete ==============
  banner('[3/6] delete_group without confirm_delete → REFUSED');
  const noFlag = await callTool('delete_group', { group_id: emptyGroupId });
  console.log(`  ok    : ${noFlag.ok}`);
  console.log(`  error : ${noFlag.error}`);
  assert(!noFlag.ok, 'must refuse without confirm_delete');
  assert(/confirm_delete/i.test(noFlag.error ?? ''), 'refusal mentions confirm_delete');

  // ===== delete_group on EMPTY group with confirm_delete → SUCCESS
  banner('[4/6] delete_group empty group WITH confirm_delete → SUCCESS (soft)');
  const dEmpty = await callTool<{ deleted_at: string; tasks_in_group: number }>('delete_group', {
    group_id: emptyGroupId, confirm_delete: true,
  });
  if (!dEmpty.ok) throw new Error(`delete empty: ${dEmpty.error}`);
  console.log(`  tasks_in_group = ${dEmpty.data!.tasks_in_group}`);
  console.log(`  deleted_at     = ${dEmpty.data!.deleted_at}`);
  const { data: emptyRow } = await SB.from('groups').select('deleted_at').eq('id', emptyGroupId).maybeSingle();
  console.log(`  DB.deleted_at  = ${(emptyRow as { deleted_at?: string } | null)?.deleted_at}`);
  assert(!!(emptyRow as { deleted_at?: string } | null)?.deleted_at, 'deleted_at is set in DB');

  // ===== delete_group POPULATED group, confirm_delete but NOT _with_tasks → REFUSED
  banner('[5/6] delete_group populated group, confirm_delete only → REFUSED');
  const r5 = await callTool('delete_group', { group_id: popGroupId, confirm_delete: true });
  console.log(`  ok    : ${r5.ok}`);
  console.log(`  error : ${r5.error}`);
  assert(!r5.ok, 'must refuse populated group without _with_tasks');
  assert(/non-deleted task|confirm_delete_with_tasks/i.test(r5.error ?? ''), 'refusal carries the warning');

  // ===== delete_group POPULATED group WITH both flags → SUCCESS ===
  banner('[6/6] delete_group populated WITH both flags → SUCCESS');
  const r6 = await callTool<{ tasks_in_group: number; deleted_at: string }>('delete_group', {
    group_id: popGroupId, confirm_delete: true, confirm_delete_with_tasks: true,
  });
  if (!r6.ok) throw new Error(`delete populated: ${r6.error}`);
  console.log(`  tasks_in_group = ${r6.data!.tasks_in_group}`);
  console.log(`  deleted_at     = ${r6.data!.deleted_at}`);
  const { data: popRow } = await SB.from('groups').select('deleted_at').eq('id', popGroupId).maybeSingle();
  assert(!!(popRow as { deleted_at?: string } | null)?.deleted_at, 'populated group deleted_at set');
  // Task inside should still exist (we soft-deleted the group, not the items).
  const { data: orphan } = await SB.from('items').select('deleted_at').eq('id', ct.data!.task_id).maybeSingle();
  console.log(`  orphaned task.deleted_at: ${(orphan as { deleted_at?: string } | null)?.deleted_at}`);
  assert(!(orphan as { deleted_at?: string } | null)?.deleted_at, 'task inside is not soft-deleted (only the group)');

  // ===== regression =================================================
  banner('[regression] list_boards still returns boards');
  const lb = await callTool<{ boards: unknown[] }>('list_boards', {});
  assert(lb.ok && (lb.data!.boards.length ?? 0) > 0, 'list_boards still works');
  console.log(`  ${lb.data!.boards.length} boards listed.`);

  console.log('\n✅ 3d chunk 3 verified.');
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
