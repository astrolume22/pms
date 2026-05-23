/**
 * Read-only probe: show every column on "QA Test" so the user can
 * eyeball which Status column is the original (keep) vs the duplicate
 * (soft-delete) BEFORE the verifier runs.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }
const QA_BOARD = '25d1a287-6634-4ab5-92da-386bac80aca6';

const SB = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  // 1) MCP get_board view
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_board', arguments: { board_id: QA_BOARD } } }),
  });
  const body = await r.json() as { result?: { structuredContent?: unknown } };
  const sc = body.result?.structuredContent as {
    columns: { id: string; name: string; column_type: string; sort_order?: number; labels: { id: string; name: string }[] }[];
  };
  console.log(`\nQA Test columns (via get_board) — sorted by sort_order:`);
  const sorted = [...sc.columns].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const c of sorted) {
    console.log(`  - ${c.id}  sort=${c.sort_order ?? '?'}  type=${c.column_type}  name="${c.name}"  labels=${c.labels.length}`);
  }

  // 2) Direct DB scan with created_at so the older one is unambiguous
  console.log(`\nQA Test columns (direct DB scan) — sorted by created_at:`);
  const { data: dbCols } = await SB
    .from('columns')
    .select('id, name, column_type, sort_order, archived_at, created_at')
    .eq('board_id', QA_BOARD)
    .order('created_at');
  for (const c of (dbCols ?? []) as Array<{ id: string; name: string; column_type: string; sort_order: number; archived_at: string | null; created_at: string }>) {
    console.log(`  - ${c.id}  sort=${c.sort_order}  type=${c.column_type}  name="${c.name}"  created=${c.created_at}  archived=${c.archived_at ?? 'no'}`);
  }
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
