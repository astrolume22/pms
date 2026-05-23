/**
 * Phase 3b core smoke — steps 1-6 + button regression. No env flips.
 * Step 7 (sensitive workspace) runs separately via smoke-mcp-3b-sensitive.ts
 * once Vercel env is set.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = process.argv[3] ?? 'https://pms-snowy-eight.vercel.app';
const BEARER = process.env.MCP_BEARER ?? process.argv[2] ?? '';
const MCP    = `${HOST}/api/mcp`;
const BUILD  = `${HOST}/api/ai-build`;

if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

interface RpcResp {
  jsonrpc?: '2.0'; id?: number | string | null;
  result?: { structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
}

async function rpc(method: string, params: unknown, id = Math.floor(Math.random() * 1e6)): Promise<RpcResp> {
  const resp = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await resp.text();
  try { return JSON.parse(text) as RpcResp; }
  catch { throw new Error(`bad response (HTTP ${resp.status}): ${text.slice(0, 200)}`); }
}

async function callTool<T>(name: string, args: unknown): Promise<{ status: 'ok' | 'err'; data?: T; error?: string; raw?: unknown }> {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error) return { status: 'err', error: r.error.message, raw: r };
  if (r.result?.isError) return { status: 'err', error: JSON.stringify(r.result), raw: r };
  return { status: 'ok', data: r.result?.structuredContent as T, raw: r };
}

function banner(t: string) {
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(t);
  console.log('────────────────────────────────────────────────────────────');
}
function assert(c: unknown, m: string): asserts c {
  if (!c) { console.error(`  ✗ FAIL: ${m}`); process.exit(1); }
}

async function main() {
  console.log(`Target: ${MCP}`);
  console.log(`Bearer: ${BEARER.slice(0, 4)}…${BEARER.slice(-4)} (${BEARER.length} chars)`);

  banner('[setup] list_boards → Main workspace + an existing board for tenancy proof');
  const lb = await callTool<{ boards: { id: string; workspace_id: string }[]; workspaces: { id: string; name: string }[] }>('list_boards', {});
  if (lb.status !== 'ok') throw new Error(`list_boards: ${lb.error}`);
  const mainWs = lb.data!.workspaces.find((w) => w.name === 'Main workspace');
  if (!mainWs) throw new Error('Main workspace not found');
  console.log(`  Main workspace = ${mainWs.id}`);
  const tenancyVictim = lb.data!.boards.find((b) => b.workspace_id === mainWs.id);
  if (!tenancyVictim) throw new Error('need an existing board for tenancy proof');
  console.log(`  tenancy-proof other board = ${tenancyVictim.id}`);

  // ===== #1 create_board ============================================
  banner('[1/6] create_board');
  const cb = await callTool<{ board_id: string; workspace_id: string }>('create_board', {
    workspace_id: mainWs.id,
    name: `3b-smoke ${new Date().toISOString().slice(11, 19)}`,
    icon_emoji: '🧪',
  });
  if (cb.status !== 'ok') throw new Error(`create_board: ${cb.error}`);
  const boardId = cb.data!.board_id;
  console.log(`  ✓ board_id = ${boardId}`);
  // verify the trigger seeded task_name + at least 1 group + 1 status column
  const gb = await callTool<{ board: unknown; groups: { id: string; name: string }[]; columns: { name: string; column_type: string; labels: { name: string }[] }[] }>('get_board', { board_id: boardId });
  if (gb.status !== 'ok') throw new Error(`get_board: ${gb.error}`);
  console.log(`  seeded:`);
  console.log(`    groups : ${gb.data!.groups.length}  →`, gb.data!.groups.map((g) => g.name));
  console.log(`    columns: ${gb.data!.columns.length} →`, gb.data!.columns.map((c) => `${c.name}/${c.column_type}` + (c.labels.length ? `(${c.labels.length}L)` : '')));
  assert(gb.data!.columns.some((c) => c.column_type === 'task_name'), 'task_name auto-seeded');
  const seededGroup = gb.data!.groups[0];
  const seededStatus = gb.data!.columns.find((c) => c.column_type === 'status');

  // ===== #2 create_task =============================================
  banner('[2/6] create_task');
  const ct = await callTool<{ task_id: string; workspace_id: string }>('create_task', {
    board_id: boardId,
    group_id: seededGroup.id,
    name: 'first task from MCP',
  });
  if (ct.status !== 'ok') throw new Error(`create_task: ${ct.error}`);
  const taskId = ct.data!.task_id;
  console.log(`  ✓ task_id = ${taskId}`);

  // Verify sort_order by creating a 2nd task and pulling both back
  await callTool('create_task', { board_id: boardId, group_id: seededGroup.id, name: 'second task' });
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rows } = await sb
    .from('items').select('name, sort_order').eq('group_id', seededGroup.id).order('sort_order');
  console.log(`  sort_order:`, rows);
  assert((rows ?? []).length >= 2, 'two tasks should land in the group');

  // ===== #3 bulk_create_tasks =======================================
  banner('[3/6] bulk_create_tasks (4 good + 1 forced-bad via cross-board group_id)');
  // Probe a group from the OTHER board — its id is valid in the DB but
  // belongs to a different board than the batch's board_id, so the
  // tenancy helper refuses just that row and the rest land.
  const otherCtxForBulk = await callTool<{ groups: { id: string }[] }>('get_board', { board_id: tenancyVictim.id });
  if (otherCtxForBulk.status !== 'ok') throw new Error(`get_board(otherForBulk): ${otherCtxForBulk.error}`);
  const crossBoardGroup = otherCtxForBulk.data!.groups[0];
  if (!crossBoardGroup) throw new Error('victim board has no group');
  const bulk = await callTool<{
    succeeded: number; failed: number;
    results: { index: number; ok: boolean; task_id?: string; error?: string; name: string }[];
  }>('bulk_create_tasks', {
    board_id: boardId, group_id: seededGroup.id,
    tasks: [
      { name: 'bulk 1' },
      { name: 'bulk 2' },
      { name: 'bulk 3 (CROSS-BOARD)', group_id: crossBoardGroup.id },   // forced fail
      { name: 'bulk 4' },
      { name: 'bulk 5' },
    ],
  });
  if (bulk.status !== 'ok') throw new Error(`bulk: ${bulk.error}`);
  console.log(`  total=5  succeeded=${bulk.data!.succeeded}  failed=${bulk.data!.failed}`);
  for (const r of bulk.data!.results) {
    console.log(`    [${r.index}] ok=${r.ok}  ${r.ok ? r.task_id : '(error: ' + (r.error?.slice(0, 120) ?? '') + ')'}`);
  }
  assert(bulk.data!.failed === 1, 'exactly one forced-bad row should fail');
  assert(bulk.data!.succeeded === 4, 'the other 4 must land');
  assert(/cross-board|belongs to board/i.test(bulk.data!.results.find((r) => !r.ok)?.error ?? ''),
    'failed row must carry the tenancy-refusal message');

  // ===== #4 design_board_from_spec ==================================
  banner('[4/6] design_board_from_spec (Gemini prompt path)');
  const QA_PROMPT = 'Build a small QA board: 3 groups (Backlog, In Progress, Done), each with 2 tasks. Add a Priority column with High/Medium/Low labels.';
  const t0 = Date.now();
  const design = await callTool<{ board_id: string; actions_planned: number; actions_applied: number; source: string; failed_at?: unknown }>('design_board_from_spec', {
    workspace_id: mainWs.id,
    board_name: `3b-design ${new Date().toISOString().slice(11, 19)}`,
    prompt: QA_PROMPT,
  });
  const ms = Date.now() - t0;
  if (design.status !== 'ok') throw new Error(`design: ${design.error}`);
  console.log(`  ✓ board_id = ${design.data!.board_id}  (${ms}ms)`);
  console.log(`    planned/applied = ${design.data!.actions_planned}/${design.data!.actions_applied}  source=${design.data!.source}`);
  console.log(`    failed_at: ${JSON.stringify(design.data!.failed_at ?? null)}`);
  assert(design.data!.actions_applied > 0, 'engine should produce + apply actions');

  // ===== #5 update_task_status ======================================
  banner('[5/6] update_task_status');
  const label = (seededStatus?.labels ?? [])[0]?.name;
  if (!label) throw new Error('no status label seeded');
  console.log(`  setting status of task ${taskId} → "${label}"`);
  const upd = await callTool<{ task_id: string; label_id: string }>('update_task_status', {
    task_id: taskId, status_label: label,
  });
  if (upd.status !== 'ok') throw new Error(`update_task_status: ${upd.error}`);
  console.log(`  ✓ label_id = ${upd.data!.label_id}`);

  // ===== #6 TENANCY — cross-board write REFUSED ====================
  banner('[6/6] TENANCY: create_task w/ group_id from a DIFFERENT board');
  const otherCtx = await callTool<{ groups: { id: string }[] }>('get_board', { board_id: tenancyVictim.id });
  if (otherCtx.status !== 'ok') throw new Error(`get_board(victim): ${otherCtx.error}`);
  const otherGroup = otherCtx.data!.groups[0];
  if (!otherGroup) throw new Error('victim has no group; pick another board');
  console.log(`  passing: board_id=${boardId} group_id=${otherGroup.id} (which belongs to ${tenancyVictim.id})`);
  const refused = await callTool('create_task', {
    board_id: boardId,            // 3b-smoke board
    group_id: otherGroup.id,      // group is from tenancyVictim, NOT boardId
    name: 'this MUST NOT land',
  });
  console.log(`  status: ${refused.status}`);
  console.log(`  error : ${refused.error}`);
  assert(refused.status === 'err', 'cross-board write MUST be refused');
  assert(/cross-board|belongs to board/i.test(refused.error ?? ''), 'refusal carries the tenancy message');
  // Belt and braces: scan the DB.
  const { data: leaked } = await sb.from('items').select('id').eq('name', 'this MUST NOT land');
  console.log(`  DB scan: ${(leaked ?? []).length} rows match (must be 0)`);
  assert((leaked ?? []).length === 0, 'no row should exist');

  // ===== button regression ==========================================
  banner('[+] BUTTON REGRESSION — POST /api/ai-build with the same QA prompt');
  const SB = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `${process.env.MASTER_ADMIN_USERNAME!.toLowerCase()}@pms.internal`;
  const { data: signIn, error: signInErr } = await SB.auth.signInWithPassword({ email, password: process.env.MASTER_ADMIN_PASSWORD! });
  if (signInErr || !signIn.session) throw signInErr ?? new Error('no session');
  const jwt = signIn.session.access_token;
  const t1 = Date.now();
  const resp = await fetch(BUILD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ prompt: QA_PROMPT, kind: 'create_board' }),
  });
  const buildMs = Date.now() - t1;
  const body = await resp.json() as { actions?: unknown[]; error?: string };
  console.log(`  status: ${resp.status} (${buildMs}ms)  actions: ${body.actions?.length ?? 0}`);
  assert(resp.status === 200 && Array.isArray(body.actions) && body.actions.length > 0, '/api/ai-build still works');
  console.log('  ✓ button path unchanged');

  console.log('\n✅ 3b core smoke complete — steps 1-6 + button regression all pass.\n');
  console.log('Next: I will ask you to set SENSITIVE_WORKSPACE_IDS=' + mainWs.id);
  console.log('then run scripts/smoke-mcp-3b-sensitive.ts. Save this board_id for the sensitive test:');
  console.log(`  board_id=${boardId}`);
  console.log(`  group_id=${seededGroup.id}`);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
