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
 * code on every read AND write.**
 *
 *   - 3a read tools (list_boards / get_board) intentionally surface
 *     workspace_id on every row so the caller can verify tenancy at
 *     the application layer. Cross-tenant reads are by design — Optimus
 *     needs to see the whole workspace surface to choose where to
 *     write next. RLS_BYPASS-REVIEWED-3B in the read tool bodies marks
 *     each spot.
 *   - 3b write tools route EVERY mutation through the helpers in
 *     api/_shared/mcp-tenancy.ts (resolveWorkspaceForBoard,
 *     assertGroupInBoard, assertTaskBoardAndWorkspace,
 *     assertWorkspaceWriteAllowed). That file is the single auditable
 *     place where tenancy + sensitive-workspace policy is enforced.
 *
 * Conventions: matches api/ai-build.ts — NodeNext + .js extensions
 * for relative imports, top-level try/catch surfacing the real cause
 * in the response body so Vercel never returns FUNCTION_INVOCATION_FAILED.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runEngine, type EngineContext } from './_shared/gemini-engine.js';
import { Action as ActionSchema, type Action } from './_shared/actions-schema.js';
import { applyActions } from './_shared/applier.js';
import {
  TenancyError,
  parseSensitiveWorkspaceIds,
  assertWorkspaceWriteAllowed,
  resolveWorkspaceForBoard,
  assertGroupInBoard,
  assertTaskBoardAndWorkspace,
} from './_shared/mcp-tenancy.js';
import { logMcpRun } from './_shared/mcp-logging.js';
import { z } from 'zod';

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

  // ----- 3b: write tools ------------------------------------------------
  create_task: {
    name: 'create_task',
    description:
      'Create one task in a specific group of a specific board. The caller passes ' +
      'board_id + group_id together; the server verifies the group belongs to that ' +
      'board (cross-board writes are refused). Optional cells map column-name (NOT ' +
      'column-id) to a value object — e.g. {"Status": {"value": "Working on it"}}. ' +
      'For chip columns use {"label_ref": "<existing-label-name>"}. Writes to a ' +
      'sensitive workspace require confirm_sensitive_workspace: true.',
    inputSchema: {
      type: 'object',
      properties: {
        board_id: { type: 'string', description: 'UUID of the board.' },
        group_id: { type: 'string', description: 'UUID of the group. Must belong to board_id.' },
        name:     { type: 'string', description: 'Task name.', minLength: 1, maxLength: 200 },
        cells:    {
          type: 'object',
          description: 'Optional initial cells, keyed by column name. Each value is ' +
            'a CellValue object — { value: ... } | { label_ref: "<name>" } | ' +
            '{ label_refs: [...] } | { checked: bool } | { url: ..., label: ... }.',
          additionalProperties: true,
        },
        confirm_sensitive_workspace: {
          type: 'boolean',
          description: 'Required only if the target workspace is on SENSITIVE_WORKSPACE_IDS. ' +
            'Pass true to consent.',
          default: false,
        },
      },
      required: ['board_id', 'group_id', 'name'],
      additionalProperties: false,
    },
  },

  bulk_create_tasks: {
    name: 'bulk_create_tasks',
    description:
      'Create many tasks in one call. Each task is attempted independently — the ' +
      'response carries a per-task report ({ index, ok, task_id?, error? }) so a ' +
      'partial failure never lies about success. The top-level board_id+group_id ' +
      'are defaults; an individual task may override group_id to write into a ' +
      'different group on the SAME board (cross-board overrides are refused per task ' +
      'by the tenancy helper, surfaced as that task\'s error without aborting the ' +
      'batch). Sensitive-workspace check runs once for the parent board.',
    inputSchema: {
      type: 'object',
      properties: {
        board_id: { type: 'string' },
        group_id: { type: 'string' },
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: {
            type: 'object',
            properties: {
              name:     { type: 'string', minLength: 1, maxLength: 200 },
              group_id: { type: 'string', description: 'Optional per-task override; falls back to the top-level group_id.' },
              cells:    { type: 'object', additionalProperties: true },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['board_id', 'group_id', 'tasks'],
      additionalProperties: false,
    },
  },

  create_board: {
    name: 'create_board',
    description:
      'Create a new board in an EXPLICIT workspace. workspace_id is REQUIRED — never ' +
      'defaulted, never guessed. The board\'s task_name column + a default Status column ' +
      'are auto-seeded by the DB trigger (matches the human "create board" flow). ' +
      'Writes to a sensitive workspace require confirm_sensitive_workspace: true.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'UUID of the workspace.' },
        name:         { type: 'string', description: 'Board name.', minLength: 1, maxLength: 80 },
        icon_emoji:   { type: 'string', description: 'Optional emoji, defaults to 📋.' },
        board_type:   { type: 'string', enum: ['main', 'private'], default: 'main' },
        description:  { type: 'string', maxLength: 2000 },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['workspace_id', 'name'],
      additionalProperties: false,
    },
  },

  design_board_from_spec: {
    name: 'design_board_from_spec',
    description:
      'Create a new board in workspace_id and populate it from a spec — either a ' +
      'natural-language prompt (the SAME Gemini engine + Zod actions schema the ' +
      '"Build with AI" button uses) OR a pre-built actions array (skip the LLM). ' +
      'Identical results to the button when called with the same prompt. Logs to ' +
      'ai_runs with feature="design_board_from_spec". Sensitive-workspace gated.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'UUID of the workspace.' },
        board_name:   { type: 'string', description: 'Name for the new board.', minLength: 1, maxLength: 80 },
        icon_emoji:   { type: 'string' },
        prompt:       { type: 'string', description: 'Natural-language spec. Mutually exclusive with actions.' },
        actions:      {
          type: 'array',
          description: 'Pre-built actions array (matches api/_shared/actions-schema.ts). ' +
            'Mutually exclusive with prompt.',
        },
        model: { type: 'string', enum: ['gemini-2.5-flash', 'gemini-2.5-pro'], default: 'gemini-2.5-flash' },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['workspace_id', 'board_name'],
      additionalProperties: false,
    },
  },

  update_task_status: {
    name: 'update_task_status',
    description:
      'Set the Status of a task to a specific label by name. Resolves task → board → ' +
      'workspace before writing; refuses if the workspace is sensitive without ' +
      'confirm_sensitive_workspace. The status column is the first status-type column ' +
      'on the task\'s board (matches the applier\'s convention). For OTHER column ' +
      'types use update_task_cell.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id:      { type: 'string', description: 'UUID of the task.' },
        status_label: { type: 'string', description: 'Name of an existing status label on the task\'s board.' },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['task_id', 'status_label'],
      additionalProperties: false,
    },
  },

  // =================================================================
  // 3d chunk 1 — non-destructive expansions
  // =================================================================
  add_task_update: {
    name: 'add_task_update',
    description:
      'Post an update/comment on a task — appears in the task panel\'s Updates feed. ' +
      'Input: task_id + body (plain text OR an HTML fragment). Resolves task → board → ' +
      'workspace, refuses cross-tenant + sensitive-workspace writes. Use this for ' +
      'comments / status notes on EXISTING tasks; for STRUCTURED data like an ' +
      '"Instructions" field, use create_column + update_task_cell instead.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the task.' },
        body:    { type: 'string', minLength: 1, maxLength: 20000,
                   description: 'Update body. Plain text is wrapped in <p>; HTML is stored as-is.' },
        is_html: { type: 'boolean', default: false,
                   description: 'If true, body is treated as HTML; otherwise wrapped in <p>…</p>.' },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['task_id', 'body'],
      additionalProperties: false,
    },
  },

  update_task_cell: {
    name: 'update_task_cell',
    description:
      'Set ANY cell value on a task — generalizes update_task_status to every column ' +
      'type. Pass the column by id (column_id) OR by name (column_name); if both are ' +
      'given, column_id wins. Value shape matches the column type:\n' +
      '  text/long_text → { value: "…" }\n' +
      '  numbers        → { value: 123 }     (also accepts "number")\n' +
      '  date           → { value: "YYYY-MM-DD" }\n' +
      '  checkbox       → { checked: true|false }\n' +
      '  link           → { url: "https://…", label?: "display text" }\n' +
      '  status/priority single-select → { label_id } | { label_name }\n' +
      '  dropdown multi-select         → { label_ids: [...] } | { label_names: [...] }\n' +
      '  people         → { user_ids: [<uuid>, …] }\n' +
      'Tenancy-checked + sensitive-workspace-gated.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id:     { type: 'string' },
        column_id:   { type: 'string', description: 'UUID of the column. Mutually exclusive with column_name (id wins).' },
        column_name: { type: 'string', description: 'Display name of the column on the task\'s board.' },
        value:       { description: 'Shape varies by column type — see tool description.' },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['task_id', 'value'],
      additionalProperties: false,
    },
  },

  update_task_name: {
    name: 'update_task_name',
    description:
      'Rename a task. Resolves task → board → workspace; sensitive-workspace gated.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id:  { type: 'string' },
        new_name: { type: 'string', minLength: 1, maxLength: 500 },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['task_id', 'new_name'],
      additionalProperties: false,
    },
  },

  // ----- 3d chunk 3 — group ops ------------------------------------
  create_group: {
    name: 'create_group',
    description:
      'Add a new group to an existing board. Group color defaults to a soft sky ' +
      'tone; pass color (#hex or oklch()) to override. Tenancy + sensitive-' +
      'workspace gated.',
    inputSchema: {
      type: 'object',
      properties: {
        board_id: { type: 'string' },
        name:     { type: 'string', minLength: 1, maxLength: 120 },
        color:    { type: 'string', description: '#RRGGBB hex or oklch(...) — optional.' },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['board_id', 'name'],
      additionalProperties: false,
    },
  },

  rename_group: {
    name: 'rename_group',
    description: 'Rename a group. Tenancy-checked (group must belong to a non-deleted board).',
    inputSchema: {
      type: 'object',
      properties: {
        group_id: { type: 'string' },
        new_name: { type: 'string', minLength: 1, maxLength: 120 },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['group_id', 'new_name'],
      additionalProperties: false,
    },
  },

  delete_group: {
    name: 'delete_group',
    description:
      'SOFT-delete a group (sets groups.deleted_at). REFUSES without confirm_delete: ' +
      'true. ALSO refuses if the group still has non-deleted tasks UNLESS ' +
      'confirm_delete_with_tasks: true is ALSO passed (so a chatty Optimus can\'t ' +
      'wipe a populated group by accident). Tenancy + sensitive-workspace gated.',
    inputSchema: {
      type: 'object',
      properties: {
        group_id: { type: 'string' },
        confirm_delete:            { type: 'boolean', default: false,
                                     description: 'Required — set to true to acknowledge soft-deletion.' },
        confirm_delete_with_tasks: { type: 'boolean', default: false,
                                     description: 'Required IF the group still has non-deleted tasks.' },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['group_id'],
      additionalProperties: false,
    },
  },

  // ----- 3d chunk 2 — column ops -----------------------------------
  create_column: {
    name: 'create_column',
    description:
      'Add a new column to an existing board. Use this to add an "Instructions" / ' +
      '"Notes" text column, a "Due date" date column, a custom status, etc. For ' +
      'comments / discussion ON a task, use add_task_update instead.\n' +
      'column_type accepts the 10 user-creatable types (task_name is auto-seeded ' +
      'per-board and refused here):\n' +
      '  text | long_text | numbers | number | date | checkbox | link |\n' +
      '  status | priority | dropdown | people\n' +
      'long_text → text and number → numbers are aliased silently (canonical type ' +
      'returned in the response). Labels apply to status/priority/dropdown and are ' +
      'seeded as column_labels rows. Tenancy + sensitive-workspace gated.',
    inputSchema: {
      type: 'object',
      properties: {
        board_id:    { type: 'string' },
        name:        { type: 'string', minLength: 1, maxLength: 80 },
        column_type: {
          type: 'string',
          enum: ['text', 'long_text', 'numbers', 'number', 'date', 'checkbox',
                 'link', 'status', 'priority', 'dropdown', 'people'],
        },
        labels: {
          type: 'array',
          description: 'Only consumed for status/priority/dropdown. Other types ignore it.',
          items: {
            type: 'object',
            properties: {
              name:  { type: 'string', minLength: 1, maxLength: 80 },
              color: { type: 'string', description: 'Optional. Hex like "#FF3D8B" or oklch(...); defaults to #C4C4C4.' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        confirm_sensitive_workspace: { type: 'boolean', default: false },
      },
      required: ['board_id', 'name', 'column_type'],
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
    // The token MAY arrive via either path:
    //   (1) Authorization: Bearer <MCP_BEARER>  — preferred. Used by
    //       curl, the smoke scripts, mcp-inspector, and any client that
    //       lets you set custom headers.
    //   (2) ?token=<MCP_BEARER> query parameter — fallback added in 3c
    //       prep for claude.ai's "Add custom connector" UI, which does
    //       NOT expose a custom-header field. Either path satisfies the
    //       check; the header wins when both are present.
    //
    //   Security note: query-param secrets can leak into access logs,
    //   referer headers, and browser history. We accept that tradeoff
    //   because (a) MCP_BEARER is a long random secret, (b) it is
    //   rotatable via Vercel env in seconds, and (c) the only way
    //   claude.ai's connector UI can auth today is via the URL. To
    //   minimise the leak surface we deliberately do NOT log req.url
    //   anywhere in this handler — only the JSON-RPC method name when
    //   diagnosing the catch-all 500. If you add logging below, do NOT
    //   include req.url.
    const authHeader  = req.headers.authorization ?? '';
    const headerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const queryTokenRaw = req.query?.token;
    // Reject array-shaped ?token=a&token=b — we want a single string.
    const queryToken = typeof queryTokenRaw === 'string' ? queryTokenRaw.trim() : '';
    const presented  = headerToken || queryToken;
    if (!presented) {
      // No bearer → JSON-RPC auth error, NOT a crash. id is unknown
      // because we haven't parsed the body yet.
      res.status(401).json(err(null, ERR_AUTH,
        'Missing bearer — provide Authorization: Bearer <MCP_BEARER> ' +
        'header OR ?token=<MCP_BEARER> query parameter'));
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
      const sensitiveWs = parseSensitiveWorkspaceIds();
      try {
        let payload: unknown;
        switch (toolName) {
          // ----- read tools -------------------------------------------
          case 'list_boards':
            payload = await toolListBoards(sb, args as { include_archived?: boolean });
            break;
          case 'get_board':
            payload = await toolGetBoard(sb, args as { board_id?: string });
            break;
          // ----- write tools (3b) -------------------------------------
          // The `as unknown as X` two-step is intentional: TS can't
          // narrow Record<string, unknown> → a specific Args shape, but
          // each tool validates its required fields at the top of the
          // body so the runtime is safe.
          case 'create_task':
            payload = await toolCreateTask(sb, args as unknown as ToolCreateTaskArgs, sensitiveWs);
            break;
          case 'bulk_create_tasks':
            payload = await toolBulkCreateTasks(sb, args as unknown as ToolBulkCreateTasksArgs, sensitiveWs);
            break;
          case 'create_board':
            payload = await toolCreateBoard(sb, args as unknown as ToolCreateBoardArgs, sensitiveWs);
            break;
          case 'design_board_from_spec':
            payload = await toolDesignBoardFromSpec(sb, args as unknown as ToolDesignBoardArgs, sensitiveWs);
            break;
          case 'update_task_status':
            payload = await toolUpdateTaskStatus(sb, args as unknown as ToolUpdateTaskStatusArgs, sensitiveWs);
            break;
          // ----- 3d chunk 1 (non-destructive) -------------------------
          case 'add_task_update':
            payload = await toolAddTaskUpdate(sb, args as unknown as ToolAddTaskUpdateArgs, sensitiveWs);
            break;
          case 'update_task_cell':
            payload = await toolUpdateTaskCell(sb, args as unknown as ToolUpdateTaskCellArgs, sensitiveWs);
            break;
          case 'update_task_name':
            payload = await toolUpdateTaskName(sb, args as unknown as ToolUpdateTaskNameArgs, sensitiveWs);
            break;
          // ----- 3d chunk 2 (column ops) ------------------------------
          case 'create_column':
            payload = await toolCreateColumn(sb, args as unknown as ToolCreateColumnArgs, sensitiveWs);
            break;
          // ----- 3d chunk 3 (group ops) -------------------------------
          case 'create_group':
            payload = await toolCreateGroup(sb, args as unknown as ToolCreateGroupArgs, sensitiveWs);
            break;
          case 'rename_group':
            payload = await toolRenameGroup(sb, args as unknown as ToolRenameGroupArgs, sensitiveWs);
            break;
          case 'delete_group':
            payload = await toolDeleteGroup(sb, args as unknown as ToolDeleteGroupArgs, sensitiveWs);
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
        // TenancyError is a deliberate refusal — surface its message
        // verbatim so callers can read why we said no. Everything else
        // is treated as a tool failure.
        if (e instanceof TenancyError) {
          return err(id, ERR_TOOL_FAILED, e.message);
        }
        const m = e instanceof Error ? e.message : String(e);
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

  // RLS_BYPASS-REVIEWED-3B: this read is INTENTIONALLY cross-workspace
  // — Optimus needs to discover boards across tenants to choose where
  // to write next. The response includes workspace_id on every row so
  // the caller can scope its own behaviour. Writes are gated separately
  // by api/_shared/mcp-tenancy.ts.
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

  // RLS_BYPASS-REVIEWED-3B: read pulls the board even if it belongs to
  // a different workspace. Returning workspace_id below lets the caller
  // verify the snapshot is from the workspace it expected. Writes are
  // gated by api/_shared/mcp-tenancy.ts at the call site.
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
// 3b — Write tools
//
// Every write tool below:
//   1. Resolves the target's workspace_id via api/_shared/mcp-tenancy.ts.
//   2. Asserts the asserted board/group/task actually belongs there
//      (refuses cross-board / cross-workspace mismatches).
//   3. Checks the SENSITIVE_WORKSPACE_IDS gate with the caller's
//      confirm_sensitive_workspace flag.
//   4. Performs the write (via the ported applier when the operation
//      is action-shaped; direct insert otherwise).
//   5. Logs the result to public.ai_runs (awaited — Phase 2 lesson).
// =====================================================================

// ----- create_task ---------------------------------------------------
interface ToolCreateTaskArgs {
  board_id: string;
  group_id: string;
  name: string;
  cells?: Record<string, unknown>;
  confirm_sensitive_workspace?: boolean;
}

async function toolCreateTask(
  sb: SupabaseClient,
  args: ToolCreateTaskArgs,
  sensitive: Set<string>,
): Promise<{ task_id: string; board_id: string; workspace_id: string }> {
  // 1. Tenancy chain: board → workspace, group ∈ board.
  const board = await resolveWorkspaceForBoard(sb, args.board_id);
  await assertGroupInBoard(sb, args.group_id, board.boardId);
  assertWorkspaceWriteAllowed(board.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  // 2. Translate `cells` (keyed by column NAME) into the applier's
  //    ref-keyed actions schema by building a one-action plan + a
  //    minimal EngineContext so the applier can resolve refs.
  const ctx = await fetchBoardContext(sb, board.boardId);
  // Find the group ref that maps to args.group_id (it's seeded by id
  // already; we still need to look it up by its ref name).
  const groupRef = ctx.groups.find((g) => g.id === args.group_id)?.ref;
  if (!groupRef) {
    // Should never happen — group is in this board per assertGroupInBoard
    throw new Error(`internal: could not resolve group ref for ${args.group_id}`);
  }
  // Translate column-name keys → column-ref keys; pass values through.
  const cellsByRef: Record<string, unknown> = {};
  if (args.cells) {
    for (const [colName, cv] of Object.entries(args.cells)) {
      const col = ctx.columns.find((c) => c.name === colName);
      if (!col) continue;     // silently skip unknown columns
      // If the cell is a label_ref by NAME, resolve to ref too.
      if (cv && typeof cv === 'object' && 'label_ref' in (cv as object)) {
        const wantName = String((cv as { label_ref: string }).label_ref);
        const label = col.labels.find((l) => l.name === wantName);
        if (!label) continue;
        cellsByRef[col.ref] = { label_ref: label.ref };
      } else if (cv && typeof cv === 'object' && 'label_refs' in (cv as object)) {
        const wantNames = (cv as { label_refs: string[] }).label_refs;
        const refs = wantNames
          .map((n) => col.labels.find((l) => l.name === n)?.ref)
          .filter((x): x is string => typeof x === 'string');
        if (refs.length > 0) cellsByRef[col.ref] = { label_refs: refs };
      } else {
        cellsByRef[col.ref] = cv;
      }
    }
  }

  const actor = await getServiceActorId(sb);
  const action: Action = {
    type: 'create_task',
    group_ref: groupRef,
    name: args.name,
    ...(Object.keys(cellsByRef).length > 0 ? { cells: cellsByRef as never } : {}),
  };
  const result = await applyActions({
    boardId: board.boardId,
    actions: [action],
    context: ctx,
    userId: actor,
    sb,
  });
  if (result.failedAt) {
    await logMcpRun(sb, {
      toolName: 'create_task',
      status: 'error',
      workspaceId: board.workspaceId,
      boardId: board.boardId,
      prompt: args.name,
      responseSummary: `failed: ${result.failedAt.error}`,
      errorMessage: result.failedAt.error,
    });
    throw new Error(`applier failed: ${result.failedAt.error}`);
  }
  // Fetch the inserted task id back — pull the most recent items row
  // for this group whose name matches.
  const { data: items } = await sb
    .from('items')
    .select('id')
    .eq('group_id', args.group_id)
    .eq('name', args.name)
    .order('created_at', { ascending: false })
    .limit(1);
  const taskId = ((items ?? [])[0] as { id?: string } | undefined)?.id ?? '';
  await logMcpRun(sb, {
    toolName: 'create_task',
    status: 'success',
    workspaceId: board.workspaceId,
    boardId: board.boardId,
    prompt: args.name,
    responseSummary: `task_id=${taskId}`,
  });
  return { task_id: taskId, board_id: board.boardId, workspace_id: board.workspaceId };
}

// ----- bulk_create_tasks --------------------------------------------
interface ToolBulkCreateTasksArgs {
  board_id: string;
  group_id: string;
  tasks: Array<{ name: string; group_id?: string; cells?: Record<string, unknown> }>;
  confirm_sensitive_workspace?: boolean;
}

async function toolBulkCreateTasks(
  sb: SupabaseClient,
  args: ToolBulkCreateTasksArgs,
  sensitive: Set<string>,
): Promise<{
  board_id: string;
  workspace_id: string;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ index: number; ok: boolean; task_id?: string; name: string; error?: string }>;
}> {
  // Tenancy + sensitive check (ONCE for the whole batch — every task
  // lands in the same group on the same board on the same workspace).
  const board = await resolveWorkspaceForBoard(sb, args.board_id);
  await assertGroupInBoard(sb, args.group_id, board.boardId);
  assertWorkspaceWriteAllowed(board.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  if (!Array.isArray(args.tasks) || args.tasks.length === 0) {
    throw new Error('tasks must be a non-empty array');
  }

  // Per-task try/catch so one bad row doesn't poison the rest. Each
  // task honours its own group_id override (falling back to the
  // batch's group_id). toolCreateTask runs the full tenancy chain for
  // every per-task group_id, so a cross-board override surfaces as
  // THAT task's TenancyError without aborting the batch.
  const results: Array<{ index: number; ok: boolean; task_id?: string; name: string; error?: string }> = [];
  let succeeded = 0;
  let failed = 0;
  for (let i = 0; i < args.tasks.length; i += 1) {
    const t = args.tasks[i];
    const effectiveGroupId = t.group_id ?? args.group_id;
    try {
      const r = await toolCreateTask(sb, {
        board_id: args.board_id,
        group_id: effectiveGroupId,
        name: t.name,
        cells: t.cells,
        confirm_sensitive_workspace: args.confirm_sensitive_workspace,
      }, sensitive);
      results.push({ index: i, ok: true, task_id: r.task_id, name: t.name });
      succeeded += 1;
    } catch (e) {
      results.push({
        index: i,
        ok: false,
        name: t.name,
        error: e instanceof Error ? e.message : String(e),
      });
      failed += 1;
    }
  }

  await logMcpRun(sb, {
    toolName: 'bulk_create_tasks',
    status: failed === 0 ? 'success' : 'error',
    workspaceId: board.workspaceId,
    boardId: board.boardId,
    prompt: `${args.tasks.length} tasks → group ${args.group_id}`,
    responseSummary: `succeeded=${succeeded} failed=${failed}`,
    errorMessage: failed === 0 ? undefined : `${failed} of ${args.tasks.length} failed`,
  });
  return {
    board_id: board.boardId,
    workspace_id: board.workspaceId,
    total: args.tasks.length,
    succeeded,
    failed,
    results,
  };
}

// ----- create_board -------------------------------------------------
interface ToolCreateBoardArgs {
  workspace_id: string;
  name: string;
  icon_emoji?: string;
  board_type?: 'main' | 'private';
  description?: string;
  confirm_sensitive_workspace?: boolean;
}

async function toolCreateBoard(
  sb: SupabaseClient,
  args: ToolCreateBoardArgs,
  sensitive: Set<string>,
): Promise<{ board_id: string; workspace_id: string }> {
  if (!args.workspace_id || typeof args.workspace_id !== 'string') {
    throw new TenancyError('workspace_id is required — never defaulted, never guessed');
  }
  if (!args.name || args.name.trim().length === 0) {
    throw new Error('name is required');
  }
  assertWorkspaceWriteAllowed(args.workspace_id, sensitive, args.confirm_sensitive_workspace === true);

  // Verify the workspace exists. service-role read.
  const { data: ws, error: wsErr } = await sb
    .from('workspaces')
    .select('id')
    .eq('id', args.workspace_id)
    .maybeSingle();
  if (wsErr) throw new Error(`workspaces select failed: ${wsErr.message}`);
  if (!ws) throw new TenancyError(`Workspace ${args.workspace_id} not found`);

  const actor = await getServiceActorId(sb);
  const insert = {
    workspace_id: args.workspace_id,
    name: args.name.trim(),
    description: args.description?.trim() || null,
    icon_emoji: args.icon_emoji ?? '📋',
    board_type: args.board_type ?? 'main',
    owner_id: actor,
    created_by: actor,
  };
  const { data, error } = await sb
    .from('boards')
    .insert(insert as never)
    .select('id')
    .single();
  if (error) {
    await logMcpRun(sb, {
      toolName: 'create_board', status: 'error',
      workspaceId: args.workspace_id, boardId: null,
      prompt: args.name, responseSummary: `error: ${error.message}`,
      errorMessage: error.message,
    });
    throw new Error(`board insert failed: ${error.message}`);
  }
  const boardId = (data as { id: string }).id;
  await logMcpRun(sb, {
    toolName: 'create_board', status: 'success',
    workspaceId: args.workspace_id, boardId,
    prompt: args.name, responseSummary: `board_id=${boardId}`,
  });
  return { board_id: boardId, workspace_id: args.workspace_id };
}

// ----- design_board_from_spec ---------------------------------------
interface ToolDesignBoardArgs {
  workspace_id: string;
  board_name: string;
  icon_emoji?: string;
  prompt?: string;
  actions?: unknown[];
  model?: 'gemini-2.5-flash' | 'gemini-2.5-pro';
  confirm_sensitive_workspace?: boolean;
}

async function toolDesignBoardFromSpec(
  sb: SupabaseClient,
  args: ToolDesignBoardArgs,
  sensitive: Set<string>,
): Promise<{
  board_id: string;
  workspace_id: string;
  actions_applied: number;
  actions_planned: number;
  failed_at?: { index: number; description: string; error: string };
  source: 'prompt' | 'actions';
}> {
  if (!args.workspace_id) throw new TenancyError('workspace_id is required');
  if (!args.board_name)   throw new Error('board_name is required');
  assertWorkspaceWriteAllowed(args.workspace_id, sensitive, args.confirm_sensitive_workspace === true);

  const hasPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0;
  const hasActions = Array.isArray(args.actions) && args.actions.length > 0;
  if (hasPrompt && hasActions) throw new Error('pass either prompt OR actions, not both');
  if (!hasPrompt && !hasActions) throw new Error('one of prompt or actions is required');

  // 1. Resolve actions, either from Gemini or from the caller.
  let actions: Action[];
  let source: 'prompt' | 'actions';
  if (hasPrompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured on server');
    const engineResult = await runEngine({
      apiKey,
      prompt: args.prompt!,
      kind: 'create_board',
      context: { groups: [], columns: [] },
      model: args.model ?? 'gemini-2.5-flash',
    });
    if (!engineResult.ok) {
      await logMcpRun(sb, {
        toolName: 'design_board_from_spec', status: 'error',
        workspaceId: args.workspace_id, boardId: null,
        prompt: args.prompt ?? '', responseSummary: `engine failed: ${engineResult.error}`,
        errorMessage: engineResult.error,
      });
      throw new Error(`gemini engine failed: ${engineResult.error}`);
    }
    actions = engineResult.data.actions;
    source = 'prompt';
  } else {
    // Validate the supplied actions through the SAME Zod schema the
    // button-flow uses, so the two paths can't diverge.
    const parsed = z.array(ActionSchema).safeParse(args.actions);
    if (!parsed.success) {
      throw new Error(`actions failed schema validation: ${parsed.error.message}`);
    }
    actions = parsed.data;
    source = 'actions';
  }

  // 2. Create the board (DB trigger seeds task_name + default columns).
  const newBoard = await toolCreateBoard(sb, {
    workspace_id: args.workspace_id,
    name: args.board_name,
    icon_emoji: args.icon_emoji,
    confirm_sensitive_workspace: args.confirm_sensitive_workspace,
  }, sensitive);

  // 3. Apply the actions inside the new board. We re-fetch the just-
  //    created board's seeded columns so the applier has the column refs
  //    it needs (chiefly task_name + the trigger-seeded Status column).
  const ctx = await fetchBoardContext(sb, newBoard.board_id);
  const actor = await getServiceActorId(sb);
  const result = await applyActions({
    boardId: newBoard.board_id,
    actions,
    context: ctx,
    userId: actor,
    sb,
  });

  await logMcpRun(sb, {
    toolName: 'design_board_from_spec',
    status: result.failedAt ? 'error' : 'success',
    workspaceId: args.workspace_id,
    boardId: newBoard.board_id,
    prompt: args.prompt ?? `(actions × ${actions.length})`,
    responseSummary: `applied=${result.applied}/${actions.length} source=${source}`,
    errorMessage: result.failedAt?.error,
  });

  return {
    board_id: newBoard.board_id,
    workspace_id: newBoard.workspace_id,
    actions_planned: actions.length,
    actions_applied: result.applied,
    ...(result.failedAt ? { failed_at: result.failedAt } : {}),
    source,
  };
}

// ----- update_task_status -------------------------------------------
interface ToolUpdateTaskStatusArgs {
  task_id: string;
  status_label: string;
  confirm_sensitive_workspace?: boolean;
}

async function toolUpdateTaskStatus(
  sb: SupabaseClient,
  args: ToolUpdateTaskStatusArgs,
  sensitive: Set<string>,
): Promise<{ task_id: string; board_id: string; workspace_id: string; label_id: string }> {
  if (!args.task_id)      throw new Error('task_id is required');
  if (!args.status_label) throw new Error('status_label is required');

  const t = await assertTaskBoardAndWorkspace(sb, args.task_id);
  assertWorkspaceWriteAllowed(t.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  // Find the first status column on the task's board (matches applier).
  const { data: statusCols } = await sb
    .from('columns')
    .select('id')
    .eq('board_id', t.boardId)
    .eq('column_type', 'status')
    .is('archived_at', null)
    .order('sort_order')
    .limit(1);
  const statusColId = ((statusCols ?? [])[0] as { id?: string } | undefined)?.id;
  if (!statusColId) throw new Error(`no status column on board ${t.boardId}`);

  // Resolve the requested label by name on that column.
  const { data: labels } = await sb
    .from('column_labels')
    .select('id, name')
    .eq('column_id', statusColId);
  const label = (labels ?? []).find((l) => (l as { name: string }).name === args.status_label) as { id: string } | undefined;
  if (!label) throw new Error(`status label "${args.status_label}" not found on this board`);

  const actor = await getServiceActorId(sb);
  const { error } = await sb
    .from('item_column_values')
    .upsert({
      item_id: t.taskId,
      column_id: statusColId,
      value: { label_id: label.id },
      updated_by: actor,
    } as never, { onConflict: 'item_id,column_id' });
  if (error) {
    await logMcpRun(sb, {
      toolName: 'update_task_status', status: 'error',
      workspaceId: t.workspaceId, boardId: t.boardId,
      prompt: args.status_label, responseSummary: `upsert failed`,
      errorMessage: error.message,
    });
    throw new Error(`status upsert failed: ${error.message}`);
  }
  await logMcpRun(sb, {
    toolName: 'update_task_status', status: 'success',
    workspaceId: t.workspaceId, boardId: t.boardId,
    prompt: args.status_label, responseSummary: `task=${t.taskId} → label=${label.id}`,
  });
  return {
    task_id: t.taskId,
    board_id: t.boardId,
    workspace_id: t.workspaceId,
    label_id: label.id,
  };
}

// =====================================================================
// 3d chunk 1 — non-destructive expansions
// =====================================================================

// ----- add_task_update ----------------------------------------------
interface ToolAddTaskUpdateArgs {
  task_id: string;
  body: string;
  is_html?: boolean;
  confirm_sensitive_workspace?: boolean;
}

async function toolAddTaskUpdate(
  sb: SupabaseClient,
  args: ToolAddTaskUpdateArgs,
  sensitive: Set<string>,
): Promise<{ update_id: string; task_id: string; board_id: string; workspace_id: string }> {
  if (!args.task_id) throw new Error('task_id is required');
  if (!args.body || args.body.trim().length === 0) throw new Error('body is required');

  // Tenancy chain: task → board → workspace.
  const t = await assertTaskBoardAndWorkspace(sb, args.task_id);
  assertWorkspaceWriteAllowed(t.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  // Wrap plain text in <p>; treat is_html=true as caller-supplied
  // markup (no sanitization beyond what the DB stores — the UI already
  // renders this field through DOMPurify on read).
  const bodyHtml = args.is_html
    ? args.body
    : `<p>${escapeHtml(args.body)}</p>`;

  const actor = await getServiceActorId(sb);
  const { data, error } = await sb
    .from('updates')
    .insert({
      item_id:   t.taskId,
      author_id: actor,
      body_html: bodyHtml,
      body_json: null,
    } as never)
    .select('id')
    .single();
  if (error) {
    await logMcpRun(sb, {
      toolName: 'add_task_update', status: 'error',
      workspaceId: t.workspaceId, boardId: t.boardId,
      prompt: args.body.slice(0, 200),
      responseSummary: `insert failed: ${error.message}`,
      errorMessage: error.message,
    });
    throw new Error(`updates insert failed: ${error.message}`);
  }
  const updateId = (data as { id: string }).id;
  await logMcpRun(sb, {
    toolName: 'add_task_update', status: 'success',
    workspaceId: t.workspaceId, boardId: t.boardId,
    prompt: args.body.slice(0, 200),
    responseSummary: `update_id=${updateId}`,
  });
  return { update_id: updateId, task_id: t.taskId, board_id: t.boardId, workspace_id: t.workspaceId };
}

// ----- update_task_cell ---------------------------------------------
interface ToolUpdateTaskCellArgs {
  task_id: string;
  column_id?: string;
  column_name?: string;
  value: unknown;
  confirm_sensitive_workspace?: boolean;
}

async function toolUpdateTaskCell(
  sb: SupabaseClient,
  args: ToolUpdateTaskCellArgs,
  sensitive: Set<string>,
): Promise<{
  task_id: string; column_id: string; column_type: string;
  board_id: string; workspace_id: string;
}> {
  if (!args.task_id) throw new Error('task_id is required');
  if (!args.column_id && !args.column_name) {
    throw new Error('one of column_id or column_name is required');
  }
  if (args.value === undefined || args.value === null) {
    throw new Error('value is required (use { value: null } to clear is not yet supported)');
  }

  const t = await assertTaskBoardAndWorkspace(sb, args.task_id);
  assertWorkspaceWriteAllowed(t.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  // Resolve the column on the task's board. column_id wins when both
  // are present, and we re-verify the column actually belongs to this
  // board (cross-board column_id is refused).
  let columnRow: { id: string; column_type: string; name: string } | null = null;
  if (args.column_id) {
    const { data, error } = await sb
      .from('columns')
      .select('id, column_type, name, board_id, archived_at')
      .eq('id', args.column_id)
      .maybeSingle();
    if (error) throw new Error(`columns select failed: ${error.message}`);
    if (!data) throw new Error(`column ${args.column_id} not found`);
    const row = data as { id: string; column_type: string; name: string; board_id: string; archived_at: string | null };
    if (row.archived_at) throw new Error(`column ${args.column_id} is archived`);
    if (row.board_id !== t.boardId) {
      throw new TenancyError(
        `Cross-board write refused: column ${args.column_id} belongs to board ` +
        `${row.board_id}, not to the task's board (${t.boardId}).`,
      );
    }
    columnRow = { id: row.id, column_type: row.column_type, name: row.name };
  } else if (args.column_name) {
    const { data, error } = await sb
      .from('columns')
      .select('id, column_type, name')
      .eq('board_id', t.boardId)
      .eq('name', args.column_name)
      .is('archived_at', null)
      .maybeSingle();
    if (error) throw new Error(`columns select failed: ${error.message}`);
    if (!data) throw new Error(`column named "${args.column_name}" not found on this board`);
    columnRow = data as { id: string; column_type: string; name: string };
  }
  if (!columnRow) throw new Error('column resolution failed');
  if (columnRow.column_type === 'task_name') {
    throw new Error('use update_task_name for the task_name column, not update_task_cell');
  }
  if (columnRow.column_type === 'files') {
    throw new Error('files column writes are not exposed via MCP in 3d');
  }

  // Translate the caller's value shape → DB JSON. We accept both
  // human-readable forms (label_name, label_names) and id forms
  // (label_id, label_ids).
  const dbValue = await translateMcpCellValue(sb, columnRow, args.value);
  if (dbValue == null) {
    throw new Error('value did not resolve — check shape against the tool description');
  }

  const actor = await getServiceActorId(sb);
  const { error } = await sb
    .from('item_column_values')
    .upsert({
      item_id:    t.taskId,
      column_id:  columnRow.id,
      value:      dbValue,
      updated_by: actor,
    } as never, { onConflict: 'item_id,column_id' });
  if (error) {
    await logMcpRun(sb, {
      toolName: 'update_task_cell', status: 'error',
      workspaceId: t.workspaceId, boardId: t.boardId,
      prompt: `${columnRow.name} = ${JSON.stringify(args.value)}`.slice(0, 200),
      responseSummary: `upsert failed: ${error.message}`,
      errorMessage: error.message,
    });
    throw new Error(`item_column_values upsert failed: ${error.message}`);
  }
  await logMcpRun(sb, {
    toolName: 'update_task_cell', status: 'success',
    workspaceId: t.workspaceId, boardId: t.boardId,
    prompt: `${columnRow.name} = ${JSON.stringify(args.value)}`.slice(0, 200),
    responseSummary: `task=${t.taskId} col=${columnRow.id} type=${columnRow.column_type}`,
  });
  return {
    task_id: t.taskId,
    column_id: columnRow.id,
    column_type: columnRow.column_type,
    board_id: t.boardId,
    workspace_id: t.workspaceId,
  };
}

// Cell-value translator that ALSO accepts {label_name, label_names,
// label_id, label_ids, user_ids, value, checked, url}. Resolves
// name→id where needed by querying column_labels on this column.
async function translateMcpCellValue(
  sb: SupabaseClient,
  column: { id: string; column_type: string },
  raw: unknown,
): Promise<unknown | null> {
  if (raw == null || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const colType = column.column_type;

  // status/priority single-select
  if (colType === 'status' || colType === 'priority') {
    if (typeof v.label_id === 'string') return { label_id: v.label_id };
    if (typeof v.label_name === 'string') {
      const { data } = await sb.from('column_labels')
        .select('id').eq('column_id', column.id).eq('name', v.label_name).maybeSingle();
      const id = (data as { id?: string } | null)?.id;
      if (!id) throw new Error(`label "${v.label_name}" not found on column ${column.id}`);
      return { label_id: id };
    }
  }
  // dropdown multi-select
  if (colType === 'dropdown') {
    if (Array.isArray(v.label_ids)) return { label_ids: v.label_ids };
    if (Array.isArray(v.label_names)) {
      const { data } = await sb.from('column_labels')
        .select('id, name').eq('column_id', column.id).in('name', v.label_names as string[]);
      const ids = (data ?? []).map((r) => (r as { id: string }).id);
      return ids.length ? { label_ids: ids } : null;
    }
  }
  // people
  if (colType === 'people') {
    if (Array.isArray(v.user_ids)) return { user_ids: v.user_ids };
  }
  // checkbox
  if (colType === 'checkbox' && 'checked' in v) return { checked: !!v.checked };
  // link
  if (colType === 'link' && typeof v.url === 'string') {
    return { url: v.url, label: typeof v.label === 'string' ? v.label : null };
  }
  // text/numbers/date — generic value
  if ('value' in v) {
    if (colType === 'date') return { value: String(v.value) };
    if (colType === 'numbers') return { value: Number(v.value) };
    return { value: String(v.value) };
  }
  return null;
}

// ----- update_task_name ---------------------------------------------
interface ToolUpdateTaskNameArgs {
  task_id: string;
  new_name: string;
  confirm_sensitive_workspace?: boolean;
}

async function toolUpdateTaskName(
  sb: SupabaseClient,
  args: ToolUpdateTaskNameArgs,
  sensitive: Set<string>,
): Promise<{ task_id: string; board_id: string; workspace_id: string; new_name: string }> {
  if (!args.task_id) throw new Error('task_id is required');
  if (!args.new_name || args.new_name.trim().length === 0) {
    throw new Error('new_name is required');
  }
  const t = await assertTaskBoardAndWorkspace(sb, args.task_id);
  assertWorkspaceWriteAllowed(t.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  const actor = await getServiceActorId(sb);
  const trimmed = args.new_name.trim();
  const { error } = await sb
    .from('items')
    .update({ name: trimmed, updated_by: actor } as never)
    .eq('id', t.taskId);
  if (error) {
    await logMcpRun(sb, {
      toolName: 'update_task_name', status: 'error',
      workspaceId: t.workspaceId, boardId: t.boardId,
      prompt: trimmed, responseSummary: `update failed: ${error.message}`,
      errorMessage: error.message,
    });
    throw new Error(`items update failed: ${error.message}`);
  }
  await logMcpRun(sb, {
    toolName: 'update_task_name', status: 'success',
    workspaceId: t.workspaceId, boardId: t.boardId,
    prompt: trimmed, responseSummary: `task=${t.taskId} renamed`,
  });
  return { task_id: t.taskId, board_id: t.boardId, workspace_id: t.workspaceId, new_name: trimmed };
}

// =====================================================================
// 3d chunk 2 — create_column
// =====================================================================

interface ToolCreateColumnArgs {
  board_id: string;
  name: string;
  column_type: string;            // includes the long_text/number aliases
  labels?: Array<{ name: string; color?: string }>;
  confirm_sensitive_workspace?: boolean;
}

// Maps caller-supplied type names → the 11-value DB enum.
//   long_text → text   (rendered with a "long" hint via settings)
//   number    → numbers
// task_name is refused (the per-board task_name column is auto-seeded
// by the boards-after-insert trigger; multiple task_name columns are
// blocked by the partial unique index).
function canonicalColumnType(t: string): { type: string; settings: Record<string, unknown> } {
  const lower = t.toLowerCase();
  if (lower === 'task_name') {
    throw new Error('task_name columns are auto-seeded per board; create_column refuses to add another');
  }
  if (lower === 'long_text') return { type: 'text',    settings: { render_hint: 'long' } };
  if (lower === 'number')    return { type: 'numbers', settings: {} };
  const allowed = new Set([
    'text', 'numbers', 'date', 'checkbox', 'link',
    'status', 'priority', 'dropdown', 'people', 'files',
  ]);
  if (!allowed.has(lower)) {
    throw new Error(`unknown column_type "${t}". Allowed: text/long_text, numbers/number, date, checkbox, link, status, priority, dropdown, people`);
  }
  return { type: lower, settings: {} };
}

async function toolCreateColumn(
  sb: SupabaseClient,
  args: ToolCreateColumnArgs,
  sensitive: Set<string>,
): Promise<{
  column_id: string;
  board_id: string;
  workspace_id: string;
  column_type: string;            // canonical (mapped) value the DB stored
  alias_applied?: string;         // present when the caller passed long_text/number
  labels: { id: string; name: string; color: string }[];
}> {
  if (!args.board_id) throw new Error('board_id is required');
  if (!args.name || args.name.trim().length === 0) throw new Error('name is required');
  if (!args.column_type) throw new Error('column_type is required');

  const board = await resolveWorkspaceForBoard(sb, args.board_id);
  assertWorkspaceWriteAllowed(board.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  const canonical = canonicalColumnType(args.column_type);
  const aliasApplied =
    args.column_type.toLowerCase() === 'long_text' ? 'long_text→text'
    : args.column_type.toLowerCase() === 'number'  ? 'number→numbers'
    : undefined;

  // Next sort_order: 1 + max existing on this board.
  const { data: existing } = await sb
    .from('columns').select('sort_order').eq('board_id', board.boardId);
  const nextSort = ((existing ?? []).reduce(
    (m: number, c: { sort_order: number }) => Math.max(m, c.sort_order), -1,
  )) + 1;

  // Reasonable width defaults per type — mirrors the applier's logic.
  const widthFor = (t: string): number => {
    switch (t) {
      case 'status':
      case 'priority': return 180;
      case 'dropdown': return 200;
      case 'people':   return 160;
      case 'date':
      case 'numbers':  return 140;
      case 'link':     return 220;
      case 'checkbox': return 100;
      case 'text':     return canonical.settings.render_hint === 'long' ? 360 : 220;
      default:         return 180;
    }
  };

  const { data: col, error } = await sb
    .from('columns')
    .insert({
      board_id:    board.boardId,
      name:        args.name.trim(),
      column_type: canonical.type,
      sort_order:  nextSort,
      width:       widthFor(canonical.type),
      settings:    canonical.settings,
    } as never)
    .select('id, column_type')
    .single();
  if (error) {
    await logMcpRun(sb, {
      toolName: 'create_column', status: 'error',
      workspaceId: board.workspaceId, boardId: board.boardId,
      prompt: args.name, responseSummary: `insert failed: ${error.message}`,
      errorMessage: error.message,
    });
    throw new Error(`columns insert failed: ${error.message}`);
  }
  const colId = (col as { id: string }).id;

  // Seed labels only when the type supports them.
  const wantsLabels = ['status', 'priority', 'dropdown'].includes(canonical.type);
  const inserted: { id: string; name: string; color: string }[] = [];
  if (wantsLabels && Array.isArray(args.labels) && args.labels.length > 0) {
    let labelSort = 0;
    for (const l of args.labels) {
      const { data, error: lErr } = await sb
        .from('column_labels')
        .insert({
          column_id:  colId,
          name:       l.name.trim(),
          color:      (l.color && l.color.trim()) ? l.color.trim() : '#C4C4C4',
          sort_order: labelSort,
        } as never)
        .select('id, name, color')
        .single();
      if (lErr) {
        // Surface but don't roll back the column — partial seeding is
        // explicit in the response.
        console.error('[create_column] label insert failed:', lErr.message);
        continue;
      }
      const row = data as { id: string; name: string; color: string };
      inserted.push(row);
      labelSort += 1;
    }
  }

  await logMcpRun(sb, {
    toolName: 'create_column', status: 'success',
    workspaceId: board.workspaceId, boardId: board.boardId,
    prompt: `${args.name} (${args.column_type})`,
    responseSummary: `col=${colId} type=${canonical.type} labels=${inserted.length}` +
      (aliasApplied ? ` alias=${aliasApplied}` : ''),
  });

  return {
    column_id:    colId,
    board_id:     board.boardId,
    workspace_id: board.workspaceId,
    column_type:  canonical.type,
    ...(aliasApplied ? { alias_applied: aliasApplied } : {}),
    labels:       inserted,
  };
}

// =====================================================================
// 3d chunk 3 — group ops
// =====================================================================

interface ToolCreateGroupArgs {
  board_id: string;
  name: string;
  color?: string;
  confirm_sensitive_workspace?: boolean;
}

async function toolCreateGroup(
  sb: SupabaseClient,
  args: ToolCreateGroupArgs,
  sensitive: Set<string>,
): Promise<{ group_id: string; board_id: string; workspace_id: string }> {
  if (!args.board_id) throw new Error('board_id is required');
  if (!args.name || args.name.trim().length === 0) throw new Error('name is required');

  const board = await resolveWorkspaceForBoard(sb, args.board_id);
  assertWorkspaceWriteAllowed(board.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  const { data: existing } = await sb
    .from('groups').select('sort_order').eq('board_id', board.boardId).is('deleted_at', null);
  const nextSort = ((existing ?? []).reduce(
    (m: number, g: { sort_order: number }) => Math.max(m, g.sort_order), -1,
  )) + 1;

  const { data, error } = await sb
    .from('groups')
    .insert({
      board_id:   board.boardId,
      name:       args.name.trim(),
      color:      (args.color && args.color.trim()) ? args.color.trim() : '#579BFC',
      sort_order: nextSort,
    } as never)
    .select('id')
    .single();
  if (error) {
    await logMcpRun(sb, {
      toolName: 'create_group', status: 'error',
      workspaceId: board.workspaceId, boardId: board.boardId,
      prompt: args.name, responseSummary: `insert failed: ${error.message}`,
      errorMessage: error.message,
    });
    throw new Error(`groups insert failed: ${error.message}`);
  }
  const gid = (data as { id: string }).id;
  await logMcpRun(sb, {
    toolName: 'create_group', status: 'success',
    workspaceId: board.workspaceId, boardId: board.boardId,
    prompt: args.name, responseSummary: `group_id=${gid}`,
  });
  return { group_id: gid, board_id: board.boardId, workspace_id: board.workspaceId };
}

interface ToolRenameGroupArgs {
  group_id: string;
  new_name: string;
  confirm_sensitive_workspace?: boolean;
}

async function toolRenameGroup(
  sb: SupabaseClient,
  args: ToolRenameGroupArgs,
  sensitive: Set<string>,
): Promise<{ group_id: string; board_id: string; workspace_id: string; new_name: string }> {
  if (!args.group_id) throw new Error('group_id is required');
  if (!args.new_name || args.new_name.trim().length === 0) throw new Error('new_name is required');

  // Resolve group → board → workspace inline (mcp-tenancy.ts has
  // assertGroupInBoard for the "I claim board X" pattern, but here we
  // only have group_id and need to discover the board ourselves).
  const { data: g, error: gErr } = await sb
    .from('groups')
    .select('id, board_id, deleted_at')
    .eq('id', args.group_id)
    .maybeSingle();
  if (gErr) throw new Error(`groups select failed: ${gErr.message}`);
  if (!g) throw new TenancyError(`Group ${args.group_id} not found`);
  const groupRow = g as { id: string; board_id: string; deleted_at: string | null };
  if (groupRow.deleted_at) throw new TenancyError(`Group ${args.group_id} is deleted`);

  const board = await resolveWorkspaceForBoard(sb, groupRow.board_id);
  assertWorkspaceWriteAllowed(board.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  const trimmed = args.new_name.trim();
  const { error } = await sb
    .from('groups').update({ name: trimmed } as never).eq('id', groupRow.id);
  if (error) {
    await logMcpRun(sb, {
      toolName: 'rename_group', status: 'error',
      workspaceId: board.workspaceId, boardId: board.boardId,
      prompt: trimmed, responseSummary: error.message,
      errorMessage: error.message,
    });
    throw new Error(`groups update failed: ${error.message}`);
  }
  await logMcpRun(sb, {
    toolName: 'rename_group', status: 'success',
    workspaceId: board.workspaceId, boardId: board.boardId,
    prompt: trimmed, responseSummary: `group=${groupRow.id} renamed`,
  });
  return { group_id: groupRow.id, board_id: board.boardId, workspace_id: board.workspaceId, new_name: trimmed };
}

interface ToolDeleteGroupArgs {
  group_id: string;
  confirm_delete?: boolean;
  confirm_delete_with_tasks?: boolean;
  confirm_sensitive_workspace?: boolean;
}

async function toolDeleteGroup(
  sb: SupabaseClient,
  args: ToolDeleteGroupArgs,
  sensitive: Set<string>,
): Promise<{
  group_id: string; board_id: string; workspace_id: string;
  deleted_at: string; tasks_in_group: number;
}> {
  if (!args.group_id) throw new Error('group_id is required');
  if (args.confirm_delete !== true) {
    throw new Error('delete_group refuses without confirm_delete: true (soft-delete is reversible — but still requires explicit consent)');
  }

  const { data: g, error: gErr } = await sb
    .from('groups')
    .select('id, board_id, deleted_at, name')
    .eq('id', args.group_id)
    .maybeSingle();
  if (gErr) throw new Error(`groups select failed: ${gErr.message}`);
  if (!g) throw new TenancyError(`Group ${args.group_id} not found`);
  const groupRow = g as { id: string; board_id: string; deleted_at: string | null; name: string };
  if (groupRow.deleted_at) throw new Error(`Group ${args.group_id} is already soft-deleted`);

  const board = await resolveWorkspaceForBoard(sb, groupRow.board_id);
  assertWorkspaceWriteAllowed(board.workspaceId, sensitive, args.confirm_sensitive_workspace === true);

  // Count non-deleted tasks in this group; gate via confirm_delete_with_tasks.
  const { count: liveTasks } = await sb
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupRow.id)
    .is('deleted_at', null);
  const taskCount = liveTasks ?? 0;
  if (taskCount > 0 && args.confirm_delete_with_tasks !== true) {
    throw new Error(
      `Group "${groupRow.name}" still has ${taskCount} non-deleted task` +
      `${taskCount === 1 ? '' : 's'}. To soft-delete it anyway, pass ` +
      `confirm_delete_with_tasks: true. (Tasks stay rows in the DB; they ` +
      `just become orphaned in a soft-deleted group.)`,
    );
  }

  const stamp = new Date().toISOString();
  const { error } = await sb
    .from('groups').update({ deleted_at: stamp } as never).eq('id', groupRow.id);
  if (error) {
    await logMcpRun(sb, {
      toolName: 'delete_group', status: 'error',
      workspaceId: board.workspaceId, boardId: board.boardId,
      prompt: groupRow.name, responseSummary: error.message,
      errorMessage: error.message,
    });
    throw new Error(`groups soft-delete failed: ${error.message}`);
  }
  await logMcpRun(sb, {
    toolName: 'delete_group', status: 'success',
    workspaceId: board.workspaceId, boardId: board.boardId,
    prompt: groupRow.name,
    responseSummary: `group=${groupRow.id} soft-deleted, tasks_in_group=${taskCount}`,
  });
  return {
    group_id:       groupRow.id,
    board_id:       board.boardId,
    workspace_id:   board.workspaceId,
    deleted_at:     stamp,
    tasks_in_group: taskCount,
  };
}

// Minimal HTML-escape for the plain-text path. Updates body_html is
// rendered through the UI's prose pipeline which already escapes, but
// we don't want raw '<' / '>' to break the rendered markup when the
// caller passes plain text.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =====================================================================
// Shared internal helpers used by the write tools
// =====================================================================

// Build the EngineContext snapshot for a board — same shape api/ai-build.ts
// constructs for Gemini. The applier consumes this to seed its refMap.
// Refs are deterministic: prefix_slug(name)_<id4> — duplicates with the
// same name still get unique refs because of the id suffix.
async function fetchBoardContext(sb: SupabaseClient, boardId: string): Promise<EngineContext> {
  const { data: board } = await sb.from('boards').select('id, name').eq('id', boardId).maybeSingle();
  const ctx: EngineContext = {
    board_id: boardId,
    board_name: (board as { name?: string } | null)?.name ?? '',
    groups: [],
    columns: [],
  };
  const [{ data: groups }, { data: columns }] = await Promise.all([
    sb.from('groups').select('id, name, color').eq('board_id', boardId).is('deleted_at', null).order('sort_order'),
    sb.from('columns').select('id, name, column_type').eq('board_id', boardId).is('archived_at', null).order('sort_order'),
  ]);
  ctx.groups = (groups ?? []).map((g) => ({
    id: g.id, ref: refFor('g', g.name, g.id), name: g.name, color: g.color,
  })) as EngineContext['groups'];
  const colIds = (columns ?? []).map((c) => c.id);
  let labelsByCol = new Map<string, { id: string; name: string; color: string }[]>();
  if (colIds.length > 0) {
    const { data: labels } = await sb
      .from('column_labels')
      .select('id, column_id, name, color')
      .in('column_id', colIds);
    for (const l of (labels ?? []) as { id: string; column_id: string; name: string; color: string }[]) {
      const list = labelsByCol.get(l.column_id) ?? [];
      list.push({ id: l.id, name: l.name, color: l.color });
      labelsByCol.set(l.column_id, list);
    }
  }
  ctx.columns = (columns ?? []).map((c) => ({
    id: c.id,
    ref: refFor('c', c.name, c.id),
    name: c.name,
    column_type: c.column_type,
    labels: (labelsByCol.get(c.id) ?? []).map((l) => ({
      id: l.id, ref: refFor('l', l.name, l.id), name: l.name, color: l.color,
    })),
  })) as EngineContext['columns'];
  return ctx;
}

function refFor(prefix: string, name: string, id: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'x';
  return `${prefix}_${slug}_${id.slice(0, 4)}`;
}

// Cached: the first admin user's id. Used as the actor for created_by /
// updated_by on MCP-originated rows. See mcp-logging.ts for the same
// cache (intentional duplication — the two caches are independent and
// each module can be reused standalone).
const SERVICE_ACTOR_CACHE: { id: string | null } = { id: null };
async function getServiceActorId(sb: SupabaseClient): Promise<string> {
  if (SERVICE_ACTOR_CACHE.id) return SERVICE_ACTOR_CACHE.id;
  const { data, error } = await sb
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not resolve service actor: ${error.message}`);
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error('no admin user available to act as MCP service actor');
  SERVICE_ACTOR_CACHE.id = id;
  return id;
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
