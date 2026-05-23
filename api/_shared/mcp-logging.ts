/**
 * MCP write logging — append one row to public.ai_runs per write call,
 * matching the shape api/ai-build.ts already uses.
 *
 * IMPORTANT: AWAIT the insert. Phase 2 found that void-fire-and-forget
 * Supabase calls get killed when the Vercel function exits after
 * res.json(). The cost is ~30ms per MCP write — worth it for an honest
 * audit trail.
 *
 * `feature` carries the MCP tool name verbatim ("create_task" etc.).
 * The ai_runs check constraint was widened in migration 0032 to allow
 * the modern values + 3b additions ride on top of that — see migration
 * 20260520_0033_ai_runs_feature_mcp.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface McpRunLog {
  toolName: string;
  status: 'success' | 'error';
  workspaceId: string | null;
  boardId: string | null;
  prompt: string | null;        // for tools that take prompts
  responseSummary: string;      // short text we can audit later
  errorMessage?: string;
}

// We don't have a user_id (Optimus uses the service-role JWT). The
// ai_runs.user_id column is NOT NULL with an FK to public.users, so we
// pick a deterministic admin uid at log time. Setup: the first admin
// user discovered in public.users is reused as the "MCP system actor"
// until we add a dedicated service identity. Callers can override.
const MCP_ACTOR_CACHE: { id: string | null } = { id: null };

async function getOrFetchMcpActor(sb: SupabaseClient): Promise<string | null> {
  if (MCP_ACTOR_CACHE.id) return MCP_ACTOR_CACHE.id;
  const { data } = await sb
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const id = (data as { id?: string } | null)?.id ?? null;
  if (id) MCP_ACTOR_CACHE.id = id;
  return id;
}

export async function logMcpRun(
  sb: SupabaseClient,
  payload: McpRunLog,
): Promise<{ logged: boolean; error?: string }> {
  try {
    const actor = await getOrFetchMcpActor(sb);
    if (!actor) {
      // No admin user on the system yet — skip silently rather than
      // failing the MCP call. Surfaces via the console for debugging.
      console.warn('[mcp-logging] no admin actor found; skipping ai_runs insert');
      return { logged: false, error: 'no admin actor available' };
    }
    const { error } = await sb.from('ai_runs').insert({
      user_id:       actor,
      feature:       payload.toolName,
      prompt:        payload.prompt,
      model:         'mcp',                 // distinguishes MCP rows from gemini-2.5-flash
      status:        payload.status,
      response:      payload.responseSummary.slice(0, 8000),
      target_type:   payload.boardId ? 'board' : (payload.workspaceId ? 'workspace' : null),
      target_id:     payload.boardId ?? payload.workspaceId ?? null,
      error_message: payload.errorMessage ?? null,
    } as never);
    if (error) {
      console.error('[mcp-logging] ai_runs insert failed:', error);
      return { logged: false, error: error.message };
    }
    return { logged: true };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error('[mcp-logging] exception:', m);
    return { logged: false, error: m };
  }
}
