/**
 * Phase 3c-prep verify — query-param bearer auth.
 *
 * 1. Authorization: Bearer header (existing path)        → 200 + tools list
 * 2. ?token=<valid> in URL, NO header                    → 200 + tools list
 * 3. ?token=<WRONG> in URL                               → 401 + -32001
 * 4. Neither header nor ?token=                          → 401 + -32001
 *
 * Uses tools/list as the probe — cheap, no DB write.
 */
import './loadEnv';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

const RPC_BODY = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
});

interface RpcResp {
  jsonrpc?: '2.0'; id?: number | string | null;
  result?: { tools?: { name: string }[] };
  error?: { code: number; message: string };
}

async function call(label: string, url: string, headers: Record<string, string>) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: RPC_BODY,
  });
  const text = await resp.text();
  let body: RpcResp | string;
  try { body = JSON.parse(text) as RpcResp; }
  catch { body = text; }
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(label);
  console.log('────────────────────────────────────────────────────────────');
  console.log(`HTTP ${resp.status}`);
  if (typeof body === 'string') {
    console.log(`body: ${body.slice(0, 200)}`);
  } else {
    const summary = body.result?.tools
      ? `tools: ${body.result.tools.map((t) => t.name).join(', ')}`
      : body.error
      ? `error: code=${body.error.code} message="${body.error.message}"`
      : JSON.stringify(body, null, 2);
    console.log(summary);
  }
  return { status: resp.status, body };
}

function assert(c: unknown, m: string): asserts c {
  if (!c) { console.error(`  ✗ FAIL: ${m}`); process.exit(1); }
}

async function main() {
  console.log(`Target: ${MCP}`);
  console.log(`Bearer: ${BEARER.slice(0, 4)}…${BEARER.slice(-4)} (${BEARER.length} chars)`);

  // (1) Header path — must still work exactly as before.
  const r1 = await call(
    '[1/4] Authorization header (existing path) → expect 200 + tools list',
    MCP,
    { Authorization: `Bearer ${BEARER}` },
  );
  assert(r1.status === 200, '#1 must be 200');
  const tools1 = (r1.body as RpcResp).result?.tools;
  assert(Array.isArray(tools1) && tools1.length >= 2, '#1 must list tools');

  // (2) Query-param path — header absent. URL-encode the bearer so
  // special chars don't trip URLSearchParams.
  const r2 = await call(
    '[2/4] ?token=<valid> in URL, NO Authorization header → expect 200',
    `${MCP}?token=${encodeURIComponent(BEARER)}`,
    {},
  );
  assert(r2.status === 200, '#2 must be 200');
  const tools2 = (r2.body as RpcResp).result?.tools;
  assert(Array.isArray(tools2) && tools2.length >= 2, '#2 must list tools');
  assert((tools2 ?? []).map((t) => t.name).sort().join(',') === (tools1 ?? []).map((t) => t.name).sort().join(','),
    'header and query-param paths must return the same tool list');

  // (3) Wrong query-param token.
  const r3 = await call(
    '[3/4] ?token=<WRONG> → expect 401 + -32001 Invalid bearer token',
    `${MCP}?token=${encodeURIComponent('totally-not-the-bearer')}`,
    {},
  );
  assert(r3.status === 401, '#3 must be 401');
  assert((r3.body as RpcResp).error?.code === -32001, '#3 must be -32001');
  assert(/invalid bearer/i.test((r3.body as RpcResp).error?.message ?? ''), '#3 must say invalid bearer');

  // (4) Neither header nor ?token=.
  const r4 = await call(
    '[4/4] No header AND no ?token= → expect 401 + -32001 Missing bearer',
    MCP,
    {},
  );
  assert(r4.status === 401, '#4 must be 401');
  assert((r4.body as RpcResp).error?.code === -32001, '#4 must be -32001');
  assert(/missing bearer/i.test((r4.body as RpcResp).error?.message ?? ''), '#4 must mention missing bearer');

  console.log('\n✅ Query-param auth path verified. Header path still works.');
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
