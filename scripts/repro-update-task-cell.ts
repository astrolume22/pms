/**
 * Repro for the update_task_cell bug. Replicates the EXACT JSON-RPC
 * envelope an MCP client (Claude.ai's custom-connector or Optimus)
 * sends, then varies the `value` shape to surface where the rejection
 * happens. No internal function calls — every test is a real
 * POST /api/mcp tools/call.
 *
 * Target (from the bug report):
 *   task   = b1f6a888-9a0f-4d75-b335-e77a0a0705f6   (E2E testing)
 *   column = c1e44add-e87b-4d74-b365-7f8d4de291de   (Instructions, type text)
 */
import './loadEnv';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const MCP    = `${HOST}/api/mcp`;
const BEARER = process.env.MCP_BEARER ?? '';
if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

const TASK   = 'b1f6a888-9a0f-4d75-b335-e77a0a0705f6';
const COLUMN = 'c1e44add-e87b-4d74-b365-7f8d4de291de';

interface RpcResp {
  result?: { structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
}

async function rawCall(label: string, valueShape: unknown): Promise<void> {
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(label);
  console.log('────────────────────────────────────────────────────────────');
  const arguments_ = {
    task_id:   TASK,
    column_id: COLUMN,
    value:     valueShape,
  };
  const requestBody = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e6),
    method: 'tools/call',
    params: { name: 'update_task_cell', arguments: arguments_ },
  };
  console.log('  REQUEST.params.arguments.value =', JSON.stringify(valueShape));
  console.log('  (typeof value:', typeof valueShape, ')');

  const resp = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify(requestBody),
  });
  const text = await resp.text();
  let body: RpcResp;
  try { body = JSON.parse(text) as RpcResp; }
  catch { body = { error: { code: 0, message: text.slice(0, 200) } }; }

  console.log(`  HTTP ${resp.status}`);
  if (body.error) {
    console.log(`  JSON-RPC ERROR  code=${body.error.code}  message="${body.error.message}"`);
  } else {
    console.log(`  RESULT ok       isError=${body.result?.isError ?? false}`);
    console.log(`  structuredContent =`, JSON.stringify(body.result?.structuredContent, null, 2));
  }
}

async function main() {
  console.log(`Live target: ${MCP}`);
  console.log(`Task   : ${TASK} (E2E testing)`);
  console.log(`Column : ${COLUMN} (Instructions / text)`);

  // Shape 1 — exactly what my own description told the LLM to send.
  await rawCall('[A] value: { "value": "test from repro" }', { value: 'test from repro' });

  // Shape 2 — what an LLM would naturally send (skip the wrapper).
  await rawCall('[B] value: "raw string from repro"', 'raw string from repro');

  // Shape 3 — what some MCP serialisers do: stringify nested objects.
  await rawCall('[C] value: \'{"value":"json-stringified"}\' (string-encoded object)',
    JSON.stringify({ value: 'json-stringified' }));

  // Shape 4 — wrapped in a top-level "text" key (the column type name).
  await rawCall('[D] value: { "text": "by-type-key" }', { text: 'by-type-key' });
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
