/**
 * 3d chunk 2 live verify — create_column.
 *   (a) long_text → text alias (with render_hint=long settings)
 *   (b) dropdown with seeded labels
 *   (c) cross-board refusal (board doesn't exist) → tenancy error path
 *   (d) regression: list_boards still works
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

// Reuse the scratch board from chunk 1.
const BOARD = 'd96eb6f7-e266-4339-8000-77760d5d27c3';

const SB = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
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
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(t);
  console.log('────────────────────────────────────────────────────────────');
}
function assert(c: unknown, m: string): asserts c {
  if (!c) { console.error(`✗ FAIL: ${m}`); process.exit(1); }
}

async function main() {
  console.log(`Scratch board: ${BOARD}`);

  // ===== a — long_text alias ======================================
  banner('[1/3] create_column long_text → text + render_hint=long');
  const a = await callTool<{ column_id: string; column_type: string; alias_applied?: string }>('create_column', {
    board_id: BOARD,
    name: 'Instructions',
    column_type: 'long_text',
  });
  if (!a.ok) throw new Error(`create_column long_text: ${a.error}`);
  console.log(`  column_id    = ${a.data!.column_id}`);
  console.log(`  column_type  = ${a.data!.column_type}`);
  console.log(`  alias_applied= ${a.data!.alias_applied}`);
  assert(a.data!.column_type === 'text', 'long_text must canonicalize to text');
  assert(a.data!.alias_applied === 'long_text→text', 'alias note must be surfaced');
  // DB scan: settings.render_hint
  const { data: longRow } = await SB
    .from('columns').select('column_type, settings, width').eq('id', a.data!.column_id).maybeSingle();
  console.log('  DB row:', longRow);
  assert(((longRow as { settings: { render_hint?: string } } | null)?.settings?.render_hint) === 'long',
    'settings.render_hint=long must be stored');

  // ===== b — dropdown with labels ==================================
  banner('[2/3] create_column dropdown with 3 labels');
  const b = await callTool<{ column_id: string; column_type: string; labels: { id: string; name: string; color: string }[] }>('create_column', {
    board_id: BOARD,
    name: 'Region',
    column_type: 'dropdown',
    labels: [
      { name: 'EU' },
      { name: 'US', color: '#3DA0CA' },
      { name: 'APAC' },
    ],
  });
  if (!b.ok) throw new Error(`create_column dropdown: ${b.error}`);
  console.log(`  column_id   = ${b.data!.column_id}`);
  console.log(`  column_type = ${b.data!.column_type}`);
  console.log(`  labels      = ${b.data!.labels.length}:`, b.data!.labels);
  assert(b.data!.column_type === 'dropdown', 'dropdown stored as-is');
  assert(b.data!.labels.length === 3, 'all 3 labels seeded');
  // DB scan
  const { data: lbRows } = await SB.from('column_labels').select('name, color, sort_order').eq('column_id', b.data!.column_id).order('sort_order');
  console.log('  DB labels:', lbRows);

  // ===== c — non-existent board → tenancy error ===================
  banner('[3/3] create_column on non-existent board_id → tenancy error');
  const c = await callTool('create_column', {
    board_id: '00000000-0000-0000-0000-000000000000',
    name: 'should never land',
    column_type: 'text',
  });
  console.log(`  ok    : ${c.ok}`);
  console.log(`  error : ${c.error}`);
  assert(!c.ok, 'unknown board MUST be refused');
  assert(/not found|board/i.test(c.error ?? ''), 'refusal must reference board not found');

  // ===== regression =================================================
  banner('[regression] list_boards still returns boards');
  const lb = await callTool<{ boards: unknown[] }>('list_boards', {});
  if (!lb.ok) throw new Error(`list_boards: ${lb.error}`);
  assert((lb.data!.boards.length ?? 0) > 0, 'list_boards still returns boards');
  console.log(`  ${lb.data!.boards.length} boards listed.`);

  console.log('\n✅ 3d chunk 2 verified.');
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
