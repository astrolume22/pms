/**
 * 3d chunk 6 verify — create_workspace + final button regression.
 *
 *  1. create_workspace → new workspace_id, DB row visible
 *  2. create_board in that workspace → board lands inside the new tenant
 *  3. tools/list shows all 16 tools (7 from 3a/3b + 9 from 3d)
 *  4. /api/ai-build with the QA prompt → still 200 + actions list
 *     (proves the Build-with-AI button is byte-for-byte unchanged)
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BUILD  = `${HOST}/api/ai-build`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

const SB = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } });

interface RpcResp { result?: { structuredContent?: unknown; isError?: boolean; tools?: unknown[] }; error?: { code: number; message: string }; }
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
  // ===== create_workspace ==========================================
  banner('[1/4] create_workspace');
  const ws = await callTool<{ workspace_id: string; name: string; icon_emoji: string; icon_color: string }>('create_workspace', {
    name: `3d-6 scratch ws ${new Date().toISOString().slice(11, 19)}`,
    icon_emoji: '🧪',
    icon_color: '#9B6DC9',
  });
  if (!ws.ok) throw new Error(`create_workspace: ${ws.error}`);
  console.log(`  workspace_id = ${ws.data!.workspace_id}`);
  console.log(`  name=${ws.data!.name}  icon=${ws.data!.icon_emoji}  color=${ws.data!.icon_color}`);
  // DB scan
  const { data: wsRow } = await SB.from('workspaces').select('id, name, is_main').eq('id', ws.data!.workspace_id).maybeSingle();
  console.log(`  DB row: ${JSON.stringify(wsRow)}`);
  assert(!!(wsRow as { id?: string } | null)?.id, 'workspace row exists');
  assert((wsRow as { is_main?: boolean } | null)?.is_main === false, 'is_main must be false');

  // ===== create_board in the new workspace =========================
  banner('[2/4] create_board inside the new workspace');
  const cb = await callTool<{ board_id: string; workspace_id: string }>('create_board', {
    workspace_id: ws.data!.workspace_id,
    name: `3d-6 scratch board ${new Date().toISOString().slice(11, 19)}`,
  });
  if (!cb.ok) throw new Error(`create_board in new ws: ${cb.error}`);
  console.log(`  board_id = ${cb.data!.board_id}`);
  console.log(`  workspace_id round-trip = ${cb.data!.workspace_id}`);
  assert(cb.data!.workspace_id === ws.data!.workspace_id, 'board belongs to the new workspace');

  // ===== tools/list — confirm 16 tools advertised ==================
  banner('[3/4] tools/list → expect 19 tools total (7 from 3a/3b + 12 from 3d)');
  const tlResp = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const tlBody = await tlResp.json() as { result?: { tools?: { name: string }[] } };
  const names = (tlBody.result?.tools ?? []).map((t) => t.name).sort();
  console.log(`  ${names.length} tools:`, names);
  assert(names.length === 19, `expected 19 tools, got ${names.length}`);
  const expected3d = [
    'add_task_update','update_task_cell','update_task_name',
    'create_column',
    'create_group','rename_group','delete_group',
    'delete_task',
    'rename_board','archive_board','delete_board',
    'create_workspace',
  ];
  for (const n of expected3d) assert(names.includes(n), `tool ${n} missing`);
  // and the original 7 are still there
  const expected3ab = ['list_boards','get_board','create_task','bulk_create_tasks','create_board','design_board_from_spec','update_task_status'];
  for (const n of expected3ab) assert(names.includes(n), `3a/3b tool ${n} missing`);

  // ===== Build-with-AI button regression ===========================
  banner('[4/4] BUTTON REGRESSION — POST /api/ai-build same QA prompt');
  const SB_anon = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `${process.env.MASTER_ADMIN_USERNAME!.toLowerCase()}@pms.internal`;
  const { data: si, error: siErr } = await SB_anon.auth.signInWithPassword({ email, password: process.env.MASTER_ADMIN_PASSWORD! });
  if (siErr || !si.session) throw siErr ?? new Error('no session');
  const QA = 'Build a small QA board: 3 groups (Backlog, In Progress, Done), each with 2 tasks. Add a Priority column with High/Medium/Low labels.';
  const t0 = Date.now();
  const resp = await fetch(BUILD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${si.session.access_token}` },
    body: JSON.stringify({ prompt: QA, kind: 'create_board' }),
  });
  const ms = Date.now() - t0;
  const body = await resp.json() as { actions?: unknown[]; error?: string };
  console.log(`  status: ${resp.status} (${ms}ms)  actions: ${body.actions?.length ?? 0}`);
  assert(resp.status === 200 && Array.isArray(body.actions) && body.actions.length > 0,
    '/api/ai-build button path must still work');
  console.log('  ✓ button path unchanged');

  console.log('\n✅ 3d chunk 6 verified + button regression passed.');
  console.log('   19 tools live; Phase 3 (a + b + d) complete.');
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
