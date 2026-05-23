/**
 * Phase 3b live smoke — covers every acceptance curl in the brief:
 *
 *  1. create_board               in Main workspace        → board_id
 *  2. create_task                into that board's group  → task_id
 *  3. bulk_create_tasks          partial success (1 bad)  → per-task report
 *  4. design_board_from_spec     prompt path              → new board built
 *  5. update_task_status         on task #2               → label set
 *  6. TENANCY: create_task w/ group_id from a DIFFERENT board → REFUSED
 *  7. SENSITIVE: set SENSITIVE_WORKSPACE_IDS=Main; refused w/o flag,
 *                accepted with the flag; then RESET (user verifies).
 *  + button regression — one curl to /api/ai-build proving it still
 *                        returns actions for the same prompt.
 *
 * Usage:
 *   MCP_BEARER=… npx tsx scripts/smoke-mcp-3b.ts
 *
 * Note: step 7 requires the Vercel env var to be flipped between runs.
 * The script tells you exactly when to flip + reset.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = process.argv[3] ?? 'https://pms-snowy-eight.vercel.app';
const BEARER = process.env.MCP_BEARER ?? process.argv[2] ?? '';
const MCP    = `${HOST}/api/mcp`;
const BUILD  = `${HOST}/api/ai-build`;

if (!BEARER) {
  console.error('Missing MCP_BEARER (env or argv[2])');
  process.exit(1);
}

interface RpcResp {
  jsonrpc?: '2.0';
  id?: number | string | null;
  result?: { structuredContent?: unknown; content?: unknown[]; isError?: boolean };
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

async function callTool<T>(name: string, args: unknown): Promise<{ status: 'ok' | 'err'; data?: T; error?: string }> {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error) return { status: 'err', error: r.error.message };
  if (r.result?.isError) return { status: 'err', error: JSON.stringify(r.result) };
  return { status: 'ok', data: r.result?.structuredContent as T };
}

function banner(title: string) {
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(title);
  console.log('────────────────────────────────────────────────────────────');
}

async function main() {
  console.log(`Target: ${MCP}`);
  console.log(`Bearer: ${BEARER.slice(0, 4)}…${BEARER.slice(-4)} (${BEARER.length} chars)`);

  // ----- discover the Main workspace via list_boards ------------------
  banner('[setup] discover Main workspace via list_boards');
  const lb = await callTool<{ boards: { id: string; workspace_id: string; workspace_name: string }[]; workspaces: { id: string; name: string }[] }>('list_boards', {});
  if (lb.status !== 'ok') throw new Error(`list_boards failed: ${lb.error}`);
  const mainWs = lb.data!.workspaces.find((w) => w.name === 'Main workspace');
  if (!mainWs) throw new Error('Could not find "Main workspace"');
  console.log(`  Main workspace: ${mainWs.id} "${mainWs.name}"`);
  // Pick an existing board (for the cross-board tenancy proof).
  const otherBoard = lb.data!.boards.find((b) => b.workspace_id === mainWs.id);
  if (!otherBoard) throw new Error('No existing board to use for tenancy proof');
  console.log(`  Other-board for tenancy proof: ${otherBoard.id}`);

  // ===== #1 — create_board =========================================
  banner('[1/7] create_board (Main workspace)');
  const board1 = await callTool<{ board_id: string; workspace_id: string }>('create_board', {
    workspace_id: mainWs.id,
    name: `3b-smoke ${new Date().toISOString().slice(11, 19)}`,
    icon_emoji: '🧪',
  });
  if (board1.status !== 'ok') throw new Error(`create_board failed: ${board1.error}`);
  const boardId = board1.data!.board_id;
  console.log(`  ✓ board_id = ${boardId}`);
  // confirm the trigger seeded task_name + status + groups
  const gb = await callTool<{ board: { id: string; workspace_id: string }; groups: unknown[]; columns: { name: string; column_type: string; labels: unknown[] }[] }>('get_board', { board_id: boardId });
  if (gb.status !== 'ok') throw new Error(`get_board failed: ${gb.error}`);
  console.log(`  seeded groups: ${gb.data!.groups.length}`);
  console.log(`  seeded columns:`, gb.data!.columns.map((c) => `${c.name}/${c.column_type}` + (c.labels.length ? `(${c.labels.length})` : '')));
  const taskNameCol = gb.data!.columns.find((c) => c.column_type === 'task_name');
  assert(!!taskNameCol, 'task_name column should be auto-seeded by trigger');
  const firstGroup = ((gb.data!.groups as { id: string }[]) ?? [])[0];
  if (!firstGroup) throw new Error('no group seeded on new board — trigger broken?');

  // ===== #2 — create_task ===========================================
  banner('[2/7] create_task into the new board');
  const t2 = await callTool<{ task_id: string; board_id: string; workspace_id: string }>('create_task', {
    board_id: boardId,
    group_id: firstGroup.id,
    name: 'first task from MCP',
  });
  if (t2.status !== 'ok') throw new Error(`create_task failed: ${t2.error}`);
  console.log(`  ✓ task_id = ${t2.data!.task_id}`);
  const taskIdForStatus = t2.data!.task_id;

  // ===== #3 — bulk_create_tasks with one bad row ====================
  banner('[3/7] bulk_create_tasks (5 good + 1 bad → per-task report)');
  // We can't easily fail one task by group_id (the helper would refuse
  // the whole batch). The "bad task" route: name too long (>200) so the
  // Postgres check fails. The per-task try/catch in toolBulkCreateTasks
  // should surface that as a single failed entry.
  const longName = 'X'.repeat(250);   // >200 → applier returns failedAt
  const bulk = await callTool<{
    succeeded: number; failed: number;
    results: { index: number; ok: boolean; task_id?: string; error?: string; name: string }[];
  }>('bulk_create_tasks', {
    board_id: boardId,
    group_id: firstGroup.id,
    tasks: [
      { name: 'bulk task 1' },
      { name: 'bulk task 2' },
      { name: longName },           // expected to fail (too long)
      { name: 'bulk task 4' },
      { name: 'bulk task 5' },
    ],
  });
  if (bulk.status !== 'ok') throw new Error(`bulk_create_tasks failed: ${bulk.error}`);
  console.log(`  total=${bulk.data!.succeeded + bulk.data!.failed}  succeeded=${bulk.data!.succeeded}  failed=${bulk.data!.failed}`);
  console.log('  per-task:');
  for (const r of bulk.data!.results) {
    console.log(`    [${r.index}] ok=${r.ok}  ${r.ok ? r.task_id : r.error}`);
  }
  assert(bulk.data!.failed >= 1, 'expected at least 1 failure in the bulk batch');
  assert(bulk.data!.succeeded >= 1, 'expected the other rows to land');

  // ===== #4 — design_board_from_spec (prompt path) ==================
  banner('[4/7] design_board_from_spec (Gemini prompt path)');
  const QA_PROMPT = 'Build a small QA board: 3 groups (Backlog, In Progress, Done), each with 2 tasks. Add a Priority column with High/Medium/Low labels.';
  const t0 = Date.now();
  const design = await callTool<{ board_id: string; actions_planned: number; actions_applied: number; source: string }>('design_board_from_spec', {
    workspace_id: mainWs.id,
    board_name: `3b-design ${new Date().toISOString().slice(11, 19)}`,
    prompt: QA_PROMPT,
  });
  const ms = Date.now() - t0;
  if (design.status !== 'ok') throw new Error(`design_board_from_spec failed: ${design.error}`);
  console.log(`  ✓ board_id        = ${design.data!.board_id}  (${ms}ms total)`);
  console.log(`    actions planned = ${design.data!.actions_planned}`);
  console.log(`    actions applied = ${design.data!.actions_applied}`);
  console.log(`    source          = ${design.data!.source}`);
  assert(design.data!.actions_planned > 0, 'engine should return at least 1 action');
  assert(design.data!.actions_applied === design.data!.actions_planned, 'all planned actions should apply');

  // ===== #5 — update_task_status ====================================
  banner('[5/7] update_task_status on the task from #2');
  // Discover an existing status label from the seeded board.
  const statusCol = gb.data!.columns.find((c) => c.column_type === 'status');
  const labelName = ((statusCol?.labels ?? []) as { name: string }[])[0]?.name;
  if (!labelName) throw new Error('no seeded status label to flip');
  console.log(`  will set status → "${labelName}"`);
  const upd = await callTool<{ task_id: string; label_id: string; workspace_id: string }>('update_task_status', {
    task_id: taskIdForStatus,
    status_label: labelName,
  });
  if (upd.status !== 'ok') throw new Error(`update_task_status failed: ${upd.error}`);
  console.log(`  ✓ label_id = ${upd.data!.label_id}`);

  // ===== #6 — TENANCY: cross-board write must be REFUSED ============
  banner('[6/7] TENANCY: create_task with a group_id from a DIFFERENT board');
  // Get a group from the "otherBoard" (the existing one in step setup).
  const other = await callTool<{ groups: { id: string; name: string }[] }>('get_board', { board_id: otherBoard.id });
  if (other.status !== 'ok') throw new Error(`get_board(otherBoard) failed: ${other.error}`);
  const otherGroup = other.data!.groups[0];
  if (!otherGroup) throw new Error(`otherBoard has no groups — pick a different board`);
  console.log(`  trying: board_id=${boardId}  group_id=${otherGroup.id} (which is in ${otherBoard.id})`);
  const refused = await callTool('create_task', {
    board_id: boardId,                   // our 3b-smoke board
    group_id: otherGroup.id,             // group belongs to otherBoard, NOT boardId
    name: 'this should NEVER land',
  });
  console.log(`  status: ${refused.status}`);
  console.log(`  error : ${refused.error}`);
  assert(refused.status === 'err', 'cross-board write MUST be refused');
  assert(/Cross-board write refused|belongs to board/i.test(refused.error ?? ''),
    'refusal must surface the tenancy error message');
  console.log('  ✓ cross-board write refused, no row written');

  // Belt-and-braces: query the DB and prove the row did NOT land.
  const directSb = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: leaked } = await directSb
    .from('items')
    .select('id, board_id, name')
    .eq('name', 'this should NEVER land');
  console.log(`  DB scan for the refused row: ${(leaked ?? []).length} hits`);
  assert((leaked ?? []).length === 0, 'no row should have been written for the refused call');

  // ===== #7 — SENSITIVE WORKSPACE PROOF =============================
  banner('[7/7] SENSITIVE workspace proof');
  console.log('  Set SENSITIVE_WORKSPACE_IDS in Vercel Production env to:');
  console.log(`    ${mainWs.id}`);
  console.log('  then redeploy ("vercel --prod" or the dashboard) and press Enter.');
  console.log('  (Or run the helper "npx tsx scripts/sensitive-flip.ts set" if you wired one.)');
  await waitForKey();

  console.log('\n  (a) Attempt create_task WITHOUT confirm_sensitive_workspace → expect refusal');
  const sens1 = await callTool('create_task', {
    board_id: boardId,
    group_id: firstGroup.id,
    name: 'sensitive without flag',
  });
  console.log(`  status: ${sens1.status}`);
  console.log(`  error : ${sens1.error}`);
  assert(sens1.status === 'err', 'sensitive write without flag must be refused');
  assert(/sensitive|confirm_sensitive_workspace/i.test(sens1.error ?? ''), 'refusal must explain the flag');

  console.log('\n  (b) Same call WITH confirm_sensitive_workspace: true → expect success');
  const sens2 = await callTool<{ task_id: string }>('create_task', {
    board_id: boardId,
    group_id: firstGroup.id,
    name: 'sensitive WITH flag',
    confirm_sensitive_workspace: true,
  });
  if (sens2.status !== 'ok') throw new Error(`flag-on call failed: ${sens2.error}`);
  console.log(`  ✓ task_id = ${sens2.data!.task_id}`);

  console.log('\n  ▶ NOW CLEAR SENSITIVE_WORKSPACE_IDS in Vercel + redeploy.');
  console.log('    Confirm with `vercel env ls production` that it is gone or empty.');

  // ===== button regression — /api/ai-build still works unchanged =====
  banner('[+] BUTTON REGRESSION: POST /api/ai-build with the same QA prompt');
  // Sign in as admin to get a user JWT for /api/ai-build.
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
  const buildBody = await resp.json() as { actions?: unknown[]; error?: string };
  console.log(`  status: ${resp.status} (${buildMs}ms)`);
  console.log(`  actions returned: ${buildBody.actions?.length ?? 0}`);
  assert(resp.status === 200 && Array.isArray(buildBody.actions) && buildBody.actions.length > 0,
    'Build-with-AI button path must still work');
  console.log('  ✓ /api/ai-build behaviour unchanged');

  console.log('\n✅ Phase 3b — every curl passed.\n');
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`  ✗ FAIL: ${msg}`); process.exit(1); }
}

function waitForKey(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve();
    });
  });
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
