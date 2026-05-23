/**
 * Phase 3b — step 7 (sensitive workspace proof).
 *
 *   Pre-req: SENSITIVE_WORKSPACE_IDS in Vercel Production env set to the
 *   Main workspace id, and a deploy has rolled out picking up that env.
 *
 *   The script:
 *     (a) attempts create_task into Main without confirm_sensitive_workspace
 *         → expect a TenancyError-shaped refusal.
 *     (b) repeats with confirm_sensitive_workspace: true → expect success.
 *
 *   Args:
 *     --board   <id>   board_id to write into (must be in Main workspace)
 *     --group   <id>   group_id on that board
 *
 *   After the script finishes, remove SENSITIVE_WORKSPACE_IDS from Vercel
 *   (or set to empty) and redeploy. Verify with `vercel env ls production`.
 */
import './loadEnv';

const HOST   = 'https://pms-snowy-eight.vercel.app';
const BEARER = process.env.MCP_BEARER ?? '';
const MCP    = `${HOST}/api/mcp`;

if (!BEARER) { console.error('Missing MCP_BEARER'); process.exit(1); }

// argv: --board <id> --group <id>
const argv = process.argv.slice(2);
function arg(name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}
const BOARD = arg('--board');
const GROUP = arg('--group');
if (!BOARD || !GROUP) {
  console.error('Usage: smoke-mcp-3b-sensitive.ts --board <id> --group <id>');
  process.exit(1);
}

interface RpcResp {
  result?: { structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
}

async function callTool<T>(name: string, args: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const resp = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await resp.text();
  const body = JSON.parse(text) as RpcResp;
  if (body.error)            return { ok: false, error: body.error.message };
  if (body.result?.isError)  return { ok: false, error: JSON.stringify(body.result) };
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
  console.log(`Target:   ${MCP}`);
  console.log(`Board:    ${BOARD}`);
  console.log(`Group:    ${GROUP}`);

  banner('[7a] Sensitive workspace, NO confirm flag → expect refusal');
  const noFlag = await callTool('create_task', {
    board_id: BOARD, group_id: GROUP, name: 'sensitive WITHOUT flag — must refuse',
  });
  console.log(`  ok    : ${noFlag.ok}`);
  console.log(`  error : ${noFlag.error}`);
  assert(!noFlag.ok, 'sensitive write without flag MUST be refused');
  assert(/sensitive|confirm_sensitive_workspace/i.test(noFlag.error ?? ''),
    'refusal must explain the flag requirement');

  banner('[7b] Sensitive workspace WITH confirm flag → expect success');
  const withFlag = await callTool<{ task_id: string }>('create_task', {
    board_id: BOARD, group_id: GROUP, name: 'sensitive WITH flag — must succeed',
    confirm_sensitive_workspace: true,
  });
  console.log(`  ok    : ${withFlag.ok}`);
  if (withFlag.ok) console.log(`  task_id = ${withFlag.data?.task_id}`);
  if (!withFlag.ok) console.log(`  error : ${withFlag.error}`);
  assert(withFlag.ok, 'flag-on call must succeed');

  console.log('\n✅ Sensitive workspace proof complete.');
  console.log('▶ NOW clear SENSITIVE_WORKSPACE_IDS in Vercel Production env and redeploy.');
  console.log('  Verify with: vercel env ls production');
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
