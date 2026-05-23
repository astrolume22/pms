/**
 * 3d chunk 5 verify — rename_board + archive_board + delete_board.
 *
 *  1. create_board (scratch-A) — for rename + archive round-trip
 *  2. rename_board → DB.name changed
 *  3. archive_board → DB.archived_at set
 *  4. archive_board restore:true → archived_at null
 *  5. create_board (scratch-B) — for delete
 *  6. delete_board without confirm_delete → REFUSED
 *  7. delete_board WITH confirm_delete → DB.deleted_at set;
 *     resolveWorkspaceForBoard now refuses the same id (already deleted)
 *  + regression list_boards
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

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
  const lb = await callTool<{ workspaces: { id: string; name: string }[] }>('list_boards', {});
  if (!lb.ok) throw new Error(`list_boards: ${lb.error}`);
  const mainWs = lb.data!.workspaces.find((w) => w.name === 'Main workspace');
  if (!mainWs) throw new Error('Main workspace not found');

  // ===== create scratch-A ==========================================
  banner('[1/6] create scratch-A for rename/archive');
  const cbA = await callTool<{ board_id: string }>('create_board', {
    workspace_id: mainWs.id,
    name: `3d-5 scratch-A ${new Date().toISOString().slice(11, 19)}`,
  });
  if (!cbA.ok) throw new Error(`create_board A: ${cbA.error}`);
  const boardA = cbA.data!.board_id;
  console.log(`  scratch-A = ${boardA}`);

  // ===== rename_board ===============================================
  banner('[2/6] rename_board');
  const rn = await callTool<{ new_name: string }>('rename_board', {
    board_id: boardA, new_name: '3d-5 scratch-A RENAMED',
  });
  if (!rn.ok) throw new Error(`rename_board: ${rn.error}`);
  const { data: r1 } = await SB.from('boards').select('name').eq('id', boardA).maybeSingle();
  console.log(`  DB.name: ${(r1 as { name?: string } | null)?.name}`);
  assert(((r1 as { name?: string } | null)?.name ?? '') === '3d-5 scratch-A RENAMED', 'rename persisted');

  // ===== archive_board ==============================================
  banner('[3/6] archive_board → archived_at set');
  const arc = await callTool<{ archived_at: string | null }>('archive_board', { board_id: boardA });
  if (!arc.ok) throw new Error(`archive_board: ${arc.error}`);
  console.log(`  archived_at = ${arc.data!.archived_at}`);
  const { data: r2 } = await SB.from('boards').select('archived_at').eq('id', boardA).maybeSingle();
  assert(!!(r2 as { archived_at?: string } | null)?.archived_at, 'archived_at is set in DB');

  // ===== archive_board restore: true ===============================
  banner('[4/6] archive_board { restore: true } → archived_at null');
  const res = await callTool<{ archived_at: string | null }>('archive_board', { board_id: boardA, restore: true });
  if (!res.ok) throw new Error(`archive_board restore: ${res.error}`);
  console.log(`  archived_at after restore = ${res.data!.archived_at}`);
  const { data: r3 } = await SB.from('boards').select('archived_at').eq('id', boardA).maybeSingle();
  assert(!(r3 as { archived_at?: string } | null)?.archived_at, 'archived_at cleared in DB');

  // ===== create scratch-B for delete ===============================
  banner('[5/6] create scratch-B for delete_board, then refuse + accept');
  const cbB = await callTool<{ board_id: string }>('create_board', {
    workspace_id: mainWs.id,
    name: `3d-5 scratch-B ${new Date().toISOString().slice(11, 19)}`,
  });
  if (!cbB.ok) throw new Error(`create_board B: ${cbB.error}`);
  const boardB = cbB.data!.board_id;
  console.log(`  scratch-B = ${boardB}`);
  // refuse
  const noFlag = await callTool('delete_board', { board_id: boardB });
  console.log(`  refuse-no-flag: ok=${noFlag.ok}  error=${noFlag.error}`);
  assert(!noFlag.ok, 'must refuse without confirm_delete');
  assert(/confirm_delete/i.test(noFlag.error ?? ''), 'refusal mentions confirm_delete');

  // accept
  banner('[6/6] delete_board WITH confirm_delete → SUCCESS (soft)');
  const ok = await callTool<{ deleted_at: string }>('delete_board', { board_id: boardB, confirm_delete: true });
  if (!ok.ok) throw new Error(`delete_board: ${ok.error}`);
  console.log(`  deleted_at = ${ok.data!.deleted_at}`);
  const { data: r4 } = await SB.from('boards').select('deleted_at, name').eq('id', boardB).maybeSingle();
  console.log(`  DB row    : ${JSON.stringify(r4)}`);
  assert(!!(r4 as { deleted_at?: string } | null)?.deleted_at, 'boards.deleted_at is set');

  // Try to operate on it again — resolveWorkspaceForBoard now refuses.
  const again = await callTool('rename_board', { board_id: boardB, new_name: 'should-never-land' });
  console.log(`  follow-up rename_board: ok=${again.ok}  error=${again.error}`);
  assert(!again.ok, 'soft-deleted board must be treated as gone for writes');

  banner('[regression] list_boards still works');
  const lb2 = await callTool<{ boards: unknown[] }>('list_boards', {});
  assert(lb2.ok && (lb2.data!.boards.length ?? 0) > 0, 'list_boards still works');
  console.log(`  ${lb2.data!.boards.length} boards.`);

  console.log('\n✅ 3d chunk 5 verified.');
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
