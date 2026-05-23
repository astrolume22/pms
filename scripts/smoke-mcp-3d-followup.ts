/**
 * 3d follow-up verify — get_board now returns tasks[] + cells.
 *
 *  1. Find / build a "QA Test" board with at least 5 tasks (incl. "E2E testing")
 *  2. get_board → confirm tasks[] is present and contains "E2E testing"
 *  3. create_column "Instructions" (long_text) if it doesn't exist yet
 *  4. update_task_cell on the E2E task's id → set Instructions copy
 *     → DB scan item_column_values to prove it landed
 *  5. add_task_update on the same task id → DB scan public.updates
 *  6. list_boards still works (regression)
 *
 * If no board literally named "QA Test" exists, build one from a
 * deterministic spec via design_board_from_spec — the verifier still
 * exercises the same end-to-end discovery + write flow.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

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
  columns: Array<{ id: string; name: string; column_type: string; labels: { id: string; name: string }[] }>;
  groups: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; name: string; group_id: string; sort_order: number; archived: boolean; cells: Record<string, unknown> }>;
  task_count: number;
}

async function main() {
  // ===== find the QA Test board, or build one ======================
  banner('[setup] find or build a "QA Test" board with ≥5 tasks incl. "E2E testing"');
  const lb = await callTool<{ boards: { id: string; name: string; workspace_id: string }[]; workspaces: { id: string; name: string }[] }>('list_boards', {});
  if (!lb.ok) throw new Error(`list_boards: ${lb.error}`);
  const mainWs = lb.data!.workspaces.find((w) => w.name === 'Main workspace');
  if (!mainWs) throw new Error('Main workspace not found');

  let qaBoardId: string | null = null;
  const candidate = lb.data!.boards.find((b) => /^qa test$/i.test(b.name));
  if (candidate) {
    qaBoardId = candidate.id;
    console.log(`  Found existing "QA Test": ${qaBoardId}`);
  } else {
    console.log('  No board literally named "QA Test" — building one from a deterministic spec.');
    const built = await callTool<{ board_id: string }>('design_board_from_spec', {
      workspace_id: mainWs.id,
      board_name: 'QA Test',
      prompt:
        'Build a small QA testing board with one group called "Test Suite" containing these EXACT 5 tasks: ' +
        '"E2E testing", "Unit testing", "Visual regression", "Accessibility audit", "Cross-browser smoke". ' +
        'Add a single Status column with three labels: Not Started, In Progress, Done.',
    });
    if (!built.ok) throw new Error(`design_board_from_spec: ${built.error}`);
    qaBoardId = built.data!.board_id;
    console.log(`  Built: ${qaBoardId}`);
  }

  // ===== [1] get_board now includes tasks =========================
  banner('[1/5] get_board → expect tasks[] including "E2E testing"');
  const snap = await callTool<BoardSnap>('get_board', { board_id: qaBoardId });
  if (!snap.ok) throw new Error(`get_board: ${snap.error}`);
  console.log(`  workspace_id (tenancy proof) = ${snap.data!.board.workspace_id}`);
  console.log(`  groups : ${snap.data!.groups.map((g) => g.name).join(', ')}`);
  console.log(`  columns: ${snap.data!.columns.map((c) => `${c.name}/${c.column_type}`).join(', ')}`);
  console.log(`  task_count = ${snap.data!.task_count}`);
  console.log(`  tasks[]:`);
  for (const t of snap.data!.tasks) {
    console.log(`    - ${t.id.slice(0, 8)}…  "${t.name}"  cells=${Object.keys(t.cells).length}`);
  }
  assert(snap.data!.task_count >= 5, `expected ≥5 tasks, got ${snap.data!.task_count}`);
  const e2e = snap.data!.tasks.find((t) => /e2e testing/i.test(t.name));
  assert(!!e2e, '"E2E testing" task must be in tasks[]');
  console.log(`  ✓ E2E task id = ${e2e!.id}`);

  // ===== [2] ensure an "Instructions" column exists ===============
  banner('[2/5] ensure an "Instructions" (long_text) column on the board');
  let instructionsCol = snap.data!.columns.find((c) => /^instructions$/i.test(c.name));
  if (!instructionsCol) {
    console.log('  No Instructions column yet — creating one (long_text → text + render_hint=long).');
    const cc = await callTool<{ column_id: string; column_type: string; alias_applied?: string }>('create_column', {
      board_id:    qaBoardId,
      name:        'Instructions',
      column_type: 'long_text',
    });
    if (!cc.ok) throw new Error(`create_column: ${cc.error}`);
    instructionsCol = { id: cc.data!.column_id, name: 'Instructions', column_type: cc.data!.column_type, labels: [] };
    console.log(`  ✓ created Instructions column ${cc.data!.column_id} (alias=${cc.data!.alias_applied})`);
  } else {
    console.log(`  Reusing existing Instructions column ${instructionsCol.id}`);
  }

  // ===== [3] update_task_cell on E2E with the instructions copy ===
  banner('[3/5] update_task_cell on E2E task id → Instructions');
  const INSTRUCTIONS = 'Run full checkout flow on staging, Chrome + Safari, screenshot on failure.';
  const uc = await callTool<{ column_id: string; column_type: string }>('update_task_cell', {
    task_id:   e2e!.id,
    column_id: instructionsCol.id,
    value:     { value: INSTRUCTIONS },
  });
  if (!uc.ok) throw new Error(`update_task_cell: ${uc.error}`);
  console.log(`  ok — column ${uc.data!.column_id} type=${uc.data!.column_type}`);
  // DB scan
  const { data: cellRow } = await SB
    .from('item_column_values')
    .select('value, column_id')
    .eq('item_id', e2e!.id)
    .eq('column_id', instructionsCol.id)
    .maybeSingle();
  console.log(`  DB row:`, cellRow);
  const storedValue = (cellRow as { value?: { value?: string } } | null)?.value?.value;
  assert(storedValue === INSTRUCTIONS, 'Instructions text round-tripped exactly into item_column_values');

  // ===== [4] add_task_update on E2E ================================
  banner('[4/5] add_task_update on E2E task id');
  const COMMENT = 'QA reminder: ran the E2E suite — Stripe checkout flaked once on Safari; please re-run before sign-off.';
  const au = await callTool<{ update_id: string }>('add_task_update', {
    task_id: e2e!.id,
    body:    COMMENT,
  });
  if (!au.ok) throw new Error(`add_task_update: ${au.error}`);
  console.log(`  update_id = ${au.data!.update_id}`);
  const { data: upRow } = await SB
    .from('updates')
    .select('item_id, body_html, deleted_at')
    .eq('id', au.data!.update_id)
    .maybeSingle();
  console.log(`  DB row:`, upRow);
  assert((upRow as { item_id?: string } | null)?.item_id === e2e!.id, 'updates.item_id matches E2E task');
  const html = (upRow as { body_html?: string } | null)?.body_html ?? '';
  assert(html.includes('QA reminder'), 'body_html contains the comment text');
  assert(html.startsWith('<p>'), 'plain text wrapped in <p>');

  // ===== [5] regression — list_boards still works =================
  banner('[5/5] regression — list_boards still works');
  const lb2 = await callTool<{ boards: unknown[] }>('list_boards', {});
  assert(lb2.ok && (lb2.data!.boards.length ?? 0) > 0, 'list_boards still works');
  console.log(`  ${lb2.data!.boards.length} boards returned by list_boards.`);

  console.log('\n✅ 3d follow-up verified. Discovery + write flow is end-to-end usable.');
  console.log(`   QA Test board id : ${qaBoardId}`);
  console.log(`   E2E task id      : ${e2e!.id}`);
  console.log(`   Instructions col : ${instructionsCol.id}`);
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
