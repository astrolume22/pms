/**
 * Phase 3a smoke: 5 curls against the live MCP endpoint.
 *
 *   1. No bearer            → JSON-RPC auth error (HTTP 401), not a crash
 *   2. Correct bearer +
 *      initialize           → handshake response (protocolVersion etc.)
 *   3. tools/list           → list_boards + get_board with schemas
 *   4. tools/call list_boards → real boards from DB with workspace_id
 *   5. tools/call get_board   → groups + columns + labels for one board
 *
 * Bearer comes from process.env.MCP_BEARER or argv[2]. Host defaults to
 * the production alias; override with argv[3].
 *
 * Usage:
 *   MCP_BEARER=… npx tsx scripts/smoke-mcp-3a.ts
 *   npx tsx scripts/smoke-mcp-3a.ts <bearer> <host>
 */
import './loadEnv';

const HOST   = process.argv[3] ?? 'https://pms-snowy-eight.vercel.app';
const BEARER = process.env.MCP_BEARER ?? process.argv[2] ?? '';

if (!BEARER) {
  console.error('Missing MCP_BEARER. Pass it via env var or argv[2].');
  console.error('  MCP_BEARER=… npx tsx scripts/smoke-mcp-3a.ts');
  console.error('  npx tsx scripts/smoke-mcp-3a.ts <bearer>');
  process.exit(1);
}

const URL = `${HOST}/api/mcp`;

interface RpcResp {
  jsonrpc?: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function post(headers: Record<string, string>, body: unknown): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: resp.status, body: parsed };
}

function section(title: string) {
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(title);
  console.log('────────────────────────────────────────────────────────────');
}

async function main() {
  console.log(`Target: ${URL}`);
  console.log(`Bearer: ${BEARER.slice(0, 4)}…${BEARER.slice(-4)} (${BEARER.length} chars)`);

  // ----- 1. No bearer -----------------------------------------------
  section('[1/5] POST with NO bearer → expect 401 + JSON-RPC auth error');
  {
    const r = await post({}, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'smoke', version: '0' } },
    });
    console.log(`  status: ${r.status}`);
    console.log(`  body:   ${JSON.stringify(r.body, null, 2)}`);
    const b = r.body as RpcResp;
    assert(r.status === 401, 'status should be 401');
    assert(b.error?.code === -32001, 'error.code should be -32001 (auth)');
    console.log('  ✓ clean JSON-RPC auth error, no crash');
  }

  // ----- 2. initialize with correct bearer ---------------------------
  section('[2/5] POST initialize with correct bearer → expect handshake');
  {
    const r = await post(
      { Authorization: `Bearer ${BEARER}` },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', clientInfo: { name: 'smoke-3a', version: '0.1' } },
      },
    );
    console.log(`  status: ${r.status}`);
    console.log(`  body:   ${JSON.stringify(r.body, null, 2)}`);
    const b = r.body as RpcResp;
    const result = b.result as { protocolVersion?: string; serverInfo?: { name: string; version: string }; capabilities?: unknown } | undefined;
    assert(r.status === 200, 'status should be 200');
    assert(result?.protocolVersion === '2025-06-18', 'protocolVersion must be 2025-06-18');
    assert(result?.serverInfo?.name === 'pms-mcp', 'serverInfo.name must be pms-mcp');
    console.log('  ✓ MCP handshake OK');
  }

  // ----- 3. tools/list ----------------------------------------------
  section('[3/5] tools/list → expect list_boards + get_board with schemas');
  {
    const r = await post(
      { Authorization: `Bearer ${BEARER}` },
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    );
    console.log(`  status: ${r.status}`);
    console.log(`  body:   ${JSON.stringify(r.body, null, 2)}`);
    const tools = ((r.body as RpcResp).result as { tools?: { name: string }[] } | undefined)?.tools ?? [];
    const names = tools.map((t) => t.name).sort();
    assert(r.status === 200, 'status should be 200');
    assert(names.includes('list_boards') && names.includes('get_board'),
      `expected list_boards + get_board, got ${names.join(', ')}`);
    console.log(`  ✓ tools listed: ${names.join(', ')}`);
  }

  // ----- 4. tools/call list_boards ----------------------------------
  let pickedBoardId = '';
  section('[4/5] tools/call list_boards → expect real boards w/ workspace_id');
  {
    const r = await post(
      { Authorization: `Bearer ${BEARER}` },
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'list_boards', arguments: { include_archived: false } },
      },
    );
    console.log(`  status: ${r.status}`);
    const sc = ((r.body as RpcResp).result as { structuredContent?: unknown } | undefined)?.structuredContent as {
      boards?: { id: string; name: string; workspace_id: string; workspace_name?: string | null }[];
      count?: number;
      workspaces?: { id: string; name: string }[];
    } | undefined;
    console.log(`  count:  ${sc?.count}`);
    console.log(`  first 3:`, JSON.stringify(sc?.boards?.slice(0, 3), null, 2));
    console.log(`  workspaces:`, JSON.stringify(sc?.workspaces, null, 2));
    assert(r.status === 200, 'status should be 200');
    assert(Array.isArray(sc?.boards), 'boards must be an array');
    assert((sc?.boards?.length ?? 0) > 0, 'expected at least 1 board on this env');
    const first = sc!.boards![0];
    assert(typeof first.workspace_id === 'string' && first.workspace_id.length > 0, 'workspace_id must be present on every row');
    pickedBoardId = first.id;
    console.log(`  ✓ list_boards returned ${sc?.boards?.length} boards; tenancy visible`);
  }

  // ----- 5. tools/call get_board ------------------------------------
  section(`[5/5] tools/call get_board { board_id: "${pickedBoardId}" }`);
  {
    const r = await post(
      { Authorization: `Bearer ${BEARER}` },
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'get_board', arguments: { board_id: pickedBoardId } },
      },
    );
    console.log(`  status: ${r.status}`);
    const sc = ((r.body as RpcResp).result as { structuredContent?: unknown } | undefined)?.structuredContent as {
      board?: { id: string; name: string; workspace_id: string };
      groups?: unknown[];
      columns?: { id: string; name: string; column_type: string; labels?: unknown[] }[];
    } | undefined;
    console.log(`  board.id:           ${sc?.board?.id}`);
    console.log(`  board.workspace_id: ${sc?.board?.workspace_id}`);
    console.log(`  groups.length:      ${sc?.groups?.length}`);
    console.log(`  columns.length:     ${sc?.columns?.length}`);
    console.log(`  columns:`, JSON.stringify(sc?.columns?.map((c) => ({ name: c.name, type: c.column_type, labels: c.labels?.length ?? 0 })), null, 2));
    assert(r.status === 200, 'status should be 200');
    assert(sc?.board?.id === pickedBoardId, 'board.id round-trips');
    assert(typeof sc?.board?.workspace_id === 'string', 'workspace_id present');
    assert(Array.isArray(sc?.groups), 'groups is an array');
    assert(Array.isArray(sc?.columns), 'columns is an array');
    console.log('  ✓ get_board returned snapshot');
  }

  console.log('\n✅ Phase 3a — all 5 curls passed.\n');
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`  ✗ FAIL: ${msg}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
