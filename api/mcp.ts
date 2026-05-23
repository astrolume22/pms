/**
 * POST /api/mcp
 *
 * Phase 3a: MCP (Model Context Protocol) server skeleton.
 *
 * Transport:        Streamable HTTP, STATELESS POST variant
 *                   (spec rev 2025-06-18; one JSON-RPC message per
 *                   request, response in the same body, no session
 *                   state retained between invocations).
 * Auth:             Authorization: Bearer <MCP_BEARER>   (shared
 *                   secret env var; ignore the request if absent or
 *                   wrong — server returns a JSON-RPC error, never a
 *                   crash).
 * Wire format:      JSON-RPC 2.0
 * Implemented:      initialize, notifications/initialized (ack only),
 *                   tools/list, tools/call.
 * Tools:            list_boards, get_board     (read-only for 3a).
 *
 * ⚠️ MULTI-TENANT WARNING — RLS IS BYPASSED ON THIS PATH.
 * This endpoint authenticates with the Supabase SERVICE_ROLE key
 * because the caller (Optimus) doesn't carry a user JWT. The service
 * role bypasses every RLS policy. **Isolation MUST be enforced in
 * code on every read AND write.** 3a only reads + always surfaces
 * workspace_id so the caller can verify tenancy; 3b will add
 * write tools and MUST scope every mutation by workspace_id /
 * caller-asserted tenancy. Grep this file for `RLS_BYPASS` to find
 * every place that needs hardening when writes land.
 *
 * Conventions: matches api/ai-build.ts — NodeNext + .js extensions
 * for relative imports, top-level try/catch surfacing the real cause
 * in the response body so Vercel never returns FUNCTION_INVOCATION_FAILED.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ----- MCP protocol version we declare to clients ----------------------
const MCP_PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'pms-mcp';
const SERVER_VERSION = '0.1.0';

// ----- JSON-RPC primitives --------------------------------------------
type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;                 // omitted for notifications
  method: string;
  params?: unknown;
}

interface JsonRpcOk {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

interface JsonRpcErr {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

// Standard JSON-RPC codes + a couple of server-defined ones we use.
const ERR_PARSE          = -32700;
const ERR_INVALID_REQ    = -32600;
const ERR_METHOD         = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL       = -32603;
const ERR_AUTH           = -32001;   // server-defined: bearer missing/wrong
const ERR_TOOL_FAILED    = -32002;   // server-defined: tool body threw

function ok(id: JsonRpcId, result: unknown): JsonRpcOk {
  return { jsonrpc: '2.0', id, result };
}
function err(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcErr {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

// ----- Tool catalogue (schemas drive tools/list output) ----------------
const TOOLS = {
  list_boards: {
    name: 'list_boards',
    description:
      'List every board visible to the MCP caller. Returns each board\'s id, name, ' +
      'icon_emoji, board_type (main|private), archived flag, and the workspace it ' +
      'belongs to (workspace_id + workspace_name). Use the workspace_id to scope ' +
      'subsequent calls — RLS is bypassed on this endpoint so the workspace_id IS ' +
      'the multi-tenant boundary.',
    inputSchema: {
      type: 'object',
      properties: {
        include_archived: {
          type: 'boolean',
          description: 'If true, include archived boards. Defaults to false.',
          default: false,
        },
      },
      additionalProperties: false,
    },
  },
  get_board: {
    name: 'get_board',
    description:
      'Fetch a board\'s structural context: groups (id, name, color, sort_order), ' +
      'columns (id, name, column_type, sort_order), and labels per column (id, name, ' +
      'color, sort_order). Same shape api/ai-build.ts produces for the Gemini engine. ' +
      'Returns workspace_id so the caller can verify tenancy.',
    inputSchema: {
      type: 'object',
      properties: {
        board_id: {
          type: 'string',
          description: 'UUID of the board to fetch.',
        },
      },
      required: ['board_id'],
      additionalProperties: false,
    },
  },
} as const;

// ----- Vercel handler --------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preamble — mirrors api/ai-build.ts so the inspector / curl /
  // a browser-side MCP client all work in dev.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    // Streamable HTTP also allows GET-for-SSE; we don't implement that.
    res.status(405).json(err(null, ERR_METHOD, 'Only POST is supported on this MCP endpoint'));
    return;
  }

  try {
    // ---- 1. Env / config checks --------------------------------------
    const bearer = process.env.MCP_BEARER;
    if (!bearer) {
      res.status(500).json(err(null, ERR_INTERNAL, 'MCP_BEARER not configured on server'));
      return;
    }
    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      res.status(500).json(err(null, ERR_INTERNAL,
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server'));
      return;
    }

    // ---- 2. Bearer-token auth ----------------------------------------
    const authHeader = req.headers.authorization ?? '';
    const presented = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    if (!presented) {
      // No bearer → JSON-RPC auth error, NOT a crash. id is unknown
      // because we haven't parsed the body yet.
      res.status(401).json(err(null, ERR_AUTH, 'Missing Authorization: Bearer <MCP_BEARER>'));
      return;
    }
    if (!constantTimeEquals(presented, bearer)) {
      res.status(401).json(err(null, ERR_AUTH, 'Invalid bearer token'));
      return;
    }

    // ---- 3. Parse JSON-RPC body --------------------------------------
    const message = parseRequestBody(req.body);
    if ('parseError' in message) {
      res.status(400).json(err(null, ERR_PARSE, message.parseError));
      return;
    }
    if (!isJsonRpcRequest(message.payload)) {
      res.status(400).json(err((message.payload as { id?: JsonRpcId })?.id ?? null,
        ERR_INVALID_REQ, 'Body is not a valid JSON-RPC 2.0 request'));
      return;
    }
    const rpc = message.payload;
    const isNotification = !('id' in rpc) || rpc.id === undefined;

    // ---- 4. Build the service-role Supabase client (RLS_BYPASS) ------
    // ⚠️ RLS_BYPASS: this client uses the service_role JWT. Every read
    // and write performed with `sb` skips RLS policies. Phase 3b must
    // scope queries by workspace_id manually.
    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---- 5. Dispatch by method ---------------------------------------
    const result = await dispatch(rpc, sb);
    // Notifications get an empty 202 — JSON-RPC says no body should be
    // returned for them.
    if (isNotification) {
      res.status(202).end();
      return;
    }
    res.status(200).json(result);
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[mcp] handler threw:', e);
    res.status(500).json(err(null, ERR_INTERNAL, `internal: ${message}`));
  }
}

// ----- Method dispatch -------------------------------------------------
async function dispatch(rpc: JsonRpcRequest, sb: SupabaseClient): Promise<JsonRpcOk | JsonRpcErr> {
  const id = rpc.id ?? null;

  switch (rpc.method) {
    // ----- MCP handshake ---------------------------------------------
    case 'initialize': {
      const params = (rpc.params ?? {}) as { protocolVersion?: string; clientInfo?: unknown };
      // Per the spec we echo BACK our supported protocol version. The
      // client decides whether it's compatible.
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: {
          tools: { listChanged: false },
        },
        instructions:
          'PMS MCP server. Use list_boards to discover boards (returns workspace_id ' +
          'for tenancy scoping), then get_board for a board\'s structural snapshot. ' +
          'Write tools land in phase 3b.',
        // Spec-suggested informational field — what version of OUR
        // server is talking back. Optional but useful when debugging.
        clientInfo: params.clientInfo,
      });
    }

    case 'notifications/initialized':
    case 'initialized': {
      // Spec: client sends this after `initialize` to confirm the
      // handshake is complete. No response expected (it's a notification),
      // but we route through dispatch() anyway and the caller's
      // notification check short-circuits the response.
      return ok(id, {});
    }

    // ----- Tool discovery / invocation -------------------------------
    case 'tools/list': {
      return ok(id, { tools: Object.values(TOOLS) });
    }

    case 'tools/call': {
      const params = rpc.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const toolName = params?.name;
      const args = params?.arguments ?? {};
      if (!toolName) {
        return err(id, ERR_INVALID_PARAMS, 'tools/call requires params.name');
      }
      try {
        let payload: unknown;
        switch (toolName) {
          case 'list_boards':
            payload = await toolListBoards(sb, args as { include_archived?: boolean });
            break;
          case 'get_board':
            payload = await toolGetBoard(sb, args as { board_id?: string });
            break;
          default:
            return err(id, ERR_METHOD, `Unknown tool: ${toolName}`);
        }
        // MCP tools/call result shape: content[] for human-readable
        // display, structuredContent for typed consumption. We return
        // both so legacy and modern clients are happy.
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
          isError: false,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        // tool errors surface as JSON-RPC errors so clients can
        // distinguish "wrong protocol" from "tool said no".
        return err(id, ERR_TOOL_FAILED, `tool '${toolName}' failed: ${m}`);
      }
    }

    default:
      return err(id, ERR_METHOD, `Method not implemented: ${rpc.method}`);
  }
}

// =====================================================================
// Tools
// =====================================================================

interface BoardListItem {
  id: string;
  name: string;
  icon_emoji: string;
  board_type: 'main' | 'private';
  workspace_id: string;
  workspace_name: string | null;
  archived: boolean;
  created_at: string;
}

async function toolListBoards(
  sb: SupabaseClient,
  args: { include_archived?: boolean },
): Promise<{ boards: BoardListItem[]; count: number; workspaces: { id: string; name: string }[] }> {
  const includeArchived = args.include_archived === true;

  // ⚠️ RLS_BYPASS: service-role read of every non-deleted board across
  // EVERY workspace. 3b must layer workspace scoping before any write
  // tool lets the caller mutate cross-workspace.
  const { data: boards, error } = await sb
    .from('boards')
    .select('id, name, icon_emoji, board_type, workspace_id, archived_at, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`boards select failed: ${error.message}`);

  const rows = (boards ?? []) as Array<{
    id: string; name: string; icon_emoji: string; board_type: 'main' | 'private';
    workspace_id: string; archived_at: string | null; created_at: string;
  }>;

  // Pull workspace names in one round-trip.
  const wsIds = Array.from(new Set(rows.map((b) => b.workspace_id)));
  const wsById = new Map<string, string>();
  if (wsIds.length > 0) {
    const { data: ws } = await sb
      .from('workspaces')
      .select('id, name')
      .in('id', wsIds);
    for (const w of (ws ?? []) as { id: string; name: string }[]) {
      wsById.set(w.id, w.name);
    }
  }

  const visible = rows
    .filter((b) => includeArchived || !b.archived_at)
    .map<BoardListItem>((b) => ({
      id: b.id,
      name: b.name,
      icon_emoji: b.icon_emoji,
      board_type: b.board_type,
      workspace_id: b.workspace_id,
      workspace_name: wsById.get(b.workspace_id) ?? null,
      archived: !!b.archived_at,
      created_at: b.created_at,
    }));

  return {
    boards: visible,
    count: visible.length,
    workspaces: Array.from(wsById, ([id, name]) => ({ id, name })),
  };
}

interface BoardSnapshot {
  board: {
    id: string;
    name: string;
    workspace_id: string;
    workspace_name: string | null;
    board_type: 'main' | 'private';
    icon_emoji: string;
    description: string | null;
  };
  groups: Array<{ id: string; name: string; color: string; sort_order: number }>;
  columns: Array<{
    id: string;
    name: string;
    column_type: string;
    sort_order: number;
    labels: Array<{ id: string; name: string; color: string; sort_order: number }>;
  }>;
}

async function toolGetBoard(
  sb: SupabaseClient,
  args: { board_id?: string },
): Promise<BoardSnapshot> {
  if (!args.board_id || typeof args.board_id !== 'string') {
    throw new Error('board_id (string) is required');
  }
  const boardId = args.board_id;

  // ⚠️ RLS_BYPASS: pulls the board even if the caller's workspace
  // wouldn't normally see it. Surfacing workspace_id below lets the
  // caller assert tenancy at the MCP-client layer; 3b enforces it
  // server-side.
  const { data: board, error: bErr } = await sb
    .from('boards')
    .select('id, name, workspace_id, board_type, icon_emoji, description')
    .eq('id', boardId)
    .is('deleted_at', null)
    .maybeSingle();
  if (bErr) throw new Error(`board select failed: ${bErr.message}`);
  if (!board) throw new Error(`board not found: ${boardId}`);

  const { data: ws } = await sb
    .from('workspaces')
    .select('name')
    .eq('id', board.workspace_id)
    .maybeSingle();

  // Groups + columns in parallel (each scoped to this board).
  const [{ data: groups, error: gErr }, { data: columns, error: cErr }] = await Promise.all([
    sb.from('groups')
      .select('id, name, color, sort_order')
      .eq('board_id', boardId)
      .is('deleted_at', null)
      .order('sort_order'),
    sb.from('columns')
      .select('id, name, column_type, sort_order')
      .eq('board_id', boardId)
      .is('archived_at', null)
      .order('sort_order'),
  ]);
  if (gErr) throw new Error(`groups select failed: ${gErr.message}`);
  if (cErr) throw new Error(`columns select failed: ${cErr.message}`);

  // Labels per column — one round-trip filtered by column_id IN (...).
  const colIds = (columns ?? []).map((c) => c.id);
  const labelsByCol = new Map<string, Array<{ id: string; name: string; color: string; sort_order: number }>>();
  if (colIds.length > 0) {
    const { data: labels, error: lErr } = await sb
      .from('column_labels')
      .select('id, column_id, name, color, sort_order')
      .in('column_id', colIds)
      .order('sort_order');
    if (lErr) throw new Error(`labels select failed: ${lErr.message}`);
    for (const l of (labels ?? []) as Array<{ id: string; column_id: string; name: string; color: string; sort_order: number }>) {
      const arr = labelsByCol.get(l.column_id) ?? [];
      arr.push({ id: l.id, name: l.name, color: l.color, sort_order: l.sort_order });
      labelsByCol.set(l.column_id, arr);
    }
  }

  return {
    board: {
      id: board.id,
      name: board.name,
      workspace_id: board.workspace_id,
      workspace_name: (ws as { name?: string } | null)?.name ?? null,
      board_type: board.board_type,
      icon_emoji: board.icon_emoji,
      description: board.description,
    },
    groups: (groups ?? []) as BoardSnapshot['groups'],
    columns: ((columns ?? []) as Array<{ id: string; name: string; column_type: string; sort_order: number }>)
      .map((c) => ({
        id: c.id,
        name: c.name,
        column_type: c.column_type,
        sort_order: c.sort_order,
        labels: labelsByCol.get(c.id) ?? [],
      })),
  };
}

// =====================================================================
// Helpers
// =====================================================================

// req.body can be a string, parsed object, or undefined depending on
// Content-Type. Same gotcha api/ai-build.ts already handles — copying
// that pattern so MCP messages from any client (curl, fetch, inspector)
// land cleanly.
type ParseOk = { payload: unknown };
type ParseFail = { parseError: string };
function parseRequestBody(body: unknown): ParseOk | ParseFail {
  if (body == null) return { parseError: 'request body is required' };
  if (typeof body === 'string') {
    if (body.trim().length === 0) return { parseError: 'request body is empty' };
    try { return { payload: JSON.parse(body) }; }
    catch (e) {
      return { parseError: `body is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (typeof body === 'object') return { payload: body };
  return { parseError: `unexpected body type: ${typeof body}` };
}

function isJsonRpcRequest(x: unknown): x is JsonRpcRequest {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return r.jsonrpc === '2.0' && typeof r.method === 'string';
}

// Constant-time string compare to avoid leaking bearer length via
// early-exit timing. Standard pattern.
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still walk one of the strings so the timing is roughly even.
    let acc = 1;
    for (let i = 0; i < a.length; i += 1) acc |= a.charCodeAt(i) ^ 0;
    return acc === 0;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
