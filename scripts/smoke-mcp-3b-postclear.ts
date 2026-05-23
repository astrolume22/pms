/**
 * Phase 3b — post-clear sanity. SENSITIVE_WORKSPACE_IDS has been removed
 * from Vercel Production env. Calling create_task into the SAME board
 * that was sensitive 30 seconds ago should now succeed WITHOUT the
 * confirm_sensitive_workspace flag — proving the env var cleanup took
 * effect and the unguarded default path is restored.
 */
import './loadEnv';

const MCP    = 'https://pms-snowy-eight.vercel.app/api/mcp';
const BEARER = process.env.MCP_BEARER ?? '';
const BOARD  = 'aa23e38a-64ae-4288-81f5-f5fc25297e66';
const GROUP  = '409fde88-91cf-4d7b-8ab6-62b937a44968';

if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

interface RpcResp {
  result?: { structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
}

async function main() {
  console.log(`Target: ${MCP}`);
  console.log(`Board : ${BOARD}`);
  console.log(`Group : ${GROUP}`);
  console.log('\nCalling create_task WITHOUT confirm_sensitive_workspace.');
  console.log('Expected: success — SENSITIVE_WORKSPACE_IDS is cleared.\n');

  const resp = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 99,
      method: 'tools/call',
      params: {
        name: 'create_task',
        arguments: {
          board_id: BOARD,
          group_id: GROUP,
          name: 'post-env-clear sanity — should succeed without flag',
        },
      },
    }),
  });
  const text = await resp.text();
  let body: RpcResp;
  try { body = JSON.parse(text) as RpcResp; }
  catch { console.error(`bad response (HTTP ${resp.status}): ${text.slice(0, 300)}`); process.exit(1); }

  console.log(`HTTP ${resp.status}`);
  console.log(JSON.stringify(body, null, 2));

  if (body.error) {
    console.error(`\n✗ FAIL: call returned a JSON-RPC error: ${body.error.message}`);
    process.exit(1);
  }
  if (body.result?.isError) {
    console.error('\n✗ FAIL: tool reported isError');
    process.exit(1);
  }
  const sc = body.result?.structuredContent as { task_id?: string } | undefined;
  if (!sc?.task_id) {
    console.error('\n✗ FAIL: no task_id in result — call succeeded but write did not land');
    process.exit(1);
  }
  console.log(`\n✅ Unguarded path restored. New task_id = ${sc.task_id}`);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
