/**
 * MCP tenancy helpers — the SINGLE auditable place where the MCP write
 * tools enforce multi-tenant isolation (Phase 3b).
 *
 * Why this matters: api/mcp.ts uses the Supabase service-role JWT, which
 * BYPASSES RLS. The database doesn't enforce workspace boundaries for us
 * here. Every write tool MUST call one of these helpers BEFORE writing.
 *
 *   - parseSensitiveWorkspaceIds()    — pulls SENSITIVE_WORKSPACE_IDS
 *                                       from env, returns a Set.
 *   - assertWorkspaceWriteAllowed()   — fails fast if the target
 *                                       workspace is sensitive and the
 *                                       caller didn't pass the
 *                                       confirm_sensitive_workspace flag.
 *   - resolveWorkspaceForBoard()      — looks up a board's workspace_id
 *                                       and confirms the board exists +
 *                                       isn't soft-deleted. Returns
 *                                       { boardId, workspaceId }.
 *   - assertGroupInBoard()            — confirms a group_id belongs to
 *                                       the same board the caller named.
 *                                       Refuses cross-board writes.
 *   - assertTaskInBoard()             — same idea for task_id (used by
 *                                       update_task_status).
 *
 * Throws TenancyError on refusal — the MCP handler catches and converts
 * to a JSON-RPC error with the user-visible message intact.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export class TenancyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenancyError';
  }
}

// ---- Sensitive-workspace gate ---------------------------------------
// Env var is comma-separated UUIDs, whitespace-tolerant. Empty / unset =
// no workspace is treated as sensitive (so EIA-style smoke tests aren't
// blocked when SENSITIVE_WORKSPACE_IDS isn't set in Vercel).
export function parseSensitiveWorkspaceIds(env?: string | undefined): Set<string> {
  const raw = env ?? process.env.SENSITIVE_WORKSPACE_IDS ?? '';
  return new Set(
    raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
  );
}

export function assertWorkspaceWriteAllowed(
  workspaceId: string,
  sensitive: Set<string>,
  confirmFlag: boolean,
): void {
  if (sensitive.has(workspaceId) && !confirmFlag) {
    throw new TenancyError(
      `Workspace ${workspaceId} is marked sensitive on this server. ` +
      `To write to it via MCP, pass "confirm_sensitive_workspace": true ` +
      `in the tool arguments. This is a deliberate guard — review the ` +
      `target before resending.`,
    );
  }
}

// ---- Board → workspace lookup (the canonical tenancy anchor) --------
export interface BoardLookup {
  boardId: string;
  workspaceId: string;
}

export async function resolveWorkspaceForBoard(
  sb: SupabaseClient,
  boardId: string,
): Promise<BoardLookup> {
  if (!boardId || typeof boardId !== 'string') {
    throw new TenancyError('board_id is required');
  }
  const { data, error } = await sb
    .from('boards')
    .select('id, workspace_id, deleted_at')
    .eq('id', boardId)
    .maybeSingle();
  if (error) throw new Error(`boards select failed: ${error.message}`);
  if (!data) throw new TenancyError(`Board ${boardId} not found`);
  const row = data as { id: string; workspace_id: string; deleted_at: string | null };
  if (row.deleted_at) {
    throw new TenancyError(`Board ${boardId} is deleted`);
  }
  return { boardId: row.id, workspaceId: row.workspace_id };
}

// ---- Group must belong to the asserted board ------------------------
export async function assertGroupInBoard(
  sb: SupabaseClient,
  groupId: string,
  expectedBoardId: string,
): Promise<void> {
  if (!groupId || typeof groupId !== 'string') {
    throw new TenancyError('group_id is required');
  }
  const { data, error } = await sb
    .from('groups')
    .select('id, board_id, deleted_at')
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw new Error(`groups select failed: ${error.message}`);
  if (!data) throw new TenancyError(`Group ${groupId} not found`);
  const row = data as { id: string; board_id: string; deleted_at: string | null };
  if (row.deleted_at) {
    throw new TenancyError(`Group ${groupId} is deleted`);
  }
  if (row.board_id !== expectedBoardId) {
    throw new TenancyError(
      `Cross-board write refused: group ${groupId} belongs to board ` +
      `${row.board_id}, not to the board_id passed (${expectedBoardId}). ` +
      `MCP will not write the task — pass the matching board_id.`,
    );
  }
}

// ---- Task must belong to the asserted board -------------------------
// Returns the task's board_id + workspace_id so the caller can run the
// sensitive-workspace check on the resolved workspace.
export async function assertTaskBoardAndWorkspace(
  sb: SupabaseClient,
  taskId: string,
): Promise<{ taskId: string; boardId: string; workspaceId: string }> {
  if (!taskId || typeof taskId !== 'string') {
    throw new TenancyError('task_id is required');
  }
  const { data: item, error } = await sb
    .from('items')
    .select('id, board_id, archived_at')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw new Error(`items select failed: ${error.message}`);
  if (!item) throw new TenancyError(`Task ${taskId} not found`);
  const row = item as { id: string; board_id: string; archived_at: string | null };
  // Resolve the board's workspace via the canonical helper so the
  // tenancy chain (task → board → workspace) lives in one file.
  const board = await resolveWorkspaceForBoard(sb, row.board_id);
  return { taskId: row.id, boardId: board.boardId, workspaceId: board.workspaceId };
}
