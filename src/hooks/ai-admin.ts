/**
 * Phase 2 admin-only hooks for the new "Build with AI" engine.
 *
 *   useAiRuns()         — recent ai_runs rows with usernames + target board names
 *                         resolved. Gated by `ai_runs_select_admin` RLS policy.
 *   useAiHealth()       — fetches GET /api/ai-health (Bearer JWT, admin-only).
 *   useAiRunsCount7d()  — head-count of ai_runs in the last 7 days.
 *
 * All three are admin-only at the data layer (RLS + the function-side
 * role check). The UI gate is defence-in-depth — RLS is the real fence.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { safeGetSession } from '@/lib/safeAuth';

// ---------------------------------------------------------------------
// useAiRuns
// ---------------------------------------------------------------------
export type AiRunFeature =
  | 'create_board' | 'add_to_board' | 'add_tasks'
  | 'create_tasks' | 'chat' | 'suggest';     // legacy values kept for old rows

export type AiRunStatus = 'success' | 'error' | 'not_configured';

export interface AiRunRow {
  id: string;
  user_id: string;
  username: string | null;          // joined from public.users
  feature: AiRunFeature;
  status: AiRunStatus;
  model: string | null;
  prompt: string | null;
  ran_at: string;
  target_type: string | null;
  target_id: string | null;
  target_board_name: string | null; // joined when target_type='board'
  error_message: string | null;
}

const RUNS_LIMIT = 50;

export function useAiRuns() {
  return useQuery({
    queryKey: ['admin', 'ai-runs', RUNS_LIMIT],
    staleTime: 10_000,
    queryFn: async (): Promise<AiRunRow[]> => {
      // 1. Most recent N runs. RLS enforces admin gate.
      const { data: runs, error } = await supabase
        .from('ai_runs')
        .select(`
          id, user_id, feature, status, model, prompt, ran_at,
          target_type, target_id, error_message
        `)
        .order('ran_at', { ascending: false })
        .limit(RUNS_LIMIT);
      if (error) throw error;
      const rows = (runs ?? []) as Omit<AiRunRow, 'username' | 'target_board_name'>[];
      if (rows.length === 0) return [];

      // 2. Stitch usernames. One round-trip per `in()` set.
      const userIds = Array.from(new Set(rows.map((r) => r.user_id))).filter(Boolean);
      const usernameById = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, username')
          .in('id', userIds);
        for (const u of (users ?? []) as { id: string; username: string }[]) {
          usernameById.set(u.id, u.username);
        }
      }

      // 3. Stitch board names for rows that targeted a board. target_id has
      // no FK to boards (it's a generic uuid), so do a manual lookup.
      const boardIds = Array.from(new Set(
        rows.filter((r) => r.target_type === 'board' && r.target_id)
            .map((r) => r.target_id as string),
      ));
      const boardNameById = new Map<string, string>();
      if (boardIds.length > 0) {
        const { data: boards } = await supabase
          .from('boards')
          .select('id, name')
          .in('id', boardIds);
        for (const b of (boards ?? []) as { id: string; name: string }[]) {
          boardNameById.set(b.id, b.name);
        }
      }

      return rows.map((r) => ({
        ...r,
        username: usernameById.get(r.user_id) ?? null,
        target_board_name: r.target_id ? (boardNameById.get(r.target_id) ?? null) : null,
      }));
    },
  });
}

// ---------------------------------------------------------------------
// useAiHealth — GET /api/ai-health
// ---------------------------------------------------------------------
export interface AiHealthResponse {
  ok: boolean;
  has_key: boolean;
  model: string;
  env: { supabase_url: boolean; supabase_anon_key: boolean };
}

export function useAiHealth() {
  return useQuery({
    queryKey: ['admin', 'ai-health'],
    // 60s cache: this changes only when env vars change on the server.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AiHealthResponse> => {
      const { data: sessionData, timedOut } = await safeGetSession('ai-health');
      if (timedOut) throw new Error('auth check timed out');
      const jwt = sessionData.session?.access_token;
      if (!jwt) throw new Error('not signed in');

      const resp = await fetch('/api/ai-health', {
        method: 'GET',
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const text = await resp.text();
      let payload: unknown;
      try { payload = JSON.parse(text); }
      catch { throw new Error(`bad response (HTTP ${resp.status}): ${text.slice(0, 200)}`); }
      if (!resp.ok) {
        const msg = (payload as { error?: string } | null)?.error
          ?? `request failed (HTTP ${resp.status})`;
        throw new Error(msg);
      }
      return payload as AiHealthResponse;
    },
  });
}

// ---------------------------------------------------------------------
// useAiRunsCount7d — head-count over the last 7 days
// ---------------------------------------------------------------------
export function useAiRunsCount7d() {
  return useQuery({
    queryKey: ['admin', 'ai-runs', 'count-7d'],
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { count, error } = await supabase
        .from('ai_runs')
        .select('id', { count: 'exact', head: true })
        .gte('ran_at', sevenDaysAgo);
      if (error) throw error;
      return count ?? 0;
    },
  });
}
