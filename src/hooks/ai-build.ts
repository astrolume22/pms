/**
 * Frontend wrapper for POST /api/ai-build (the Version B endpoint).
 * The function does the Gemini call + auth + role gate; this hook just
 * passes the session JWT and parses the JSON.
 */
import { useMutation } from '@tanstack/react-query';
import { safeGetSession } from '@/lib/safeAuth';
import type { Action, EngineContext } from '@/lib/ai-applier';

export interface AiBuildArgs {
  prompt: string;
  kind: 'create_board' | 'add_to_board' | 'add_tasks';
  boardId?: string;
  model?: 'gemini-2.5-flash' | 'gemini-2.5-pro';
}

export interface AiBuildResponse {
  actions: Action[];
  notes?: string;
  context: EngineContext;
}

export function useAiBuild() {
  return useMutation({
    mutationFn: async (args: AiBuildArgs): Promise<AiBuildResponse> => {
      // Grab the current session JWT — the function uses it to identify
      // the caller and re-fetch their role from public.users.
      const { data: sessionData, timedOut } = await safeGetSession('ai-build');
      if (timedOut) throw new Error('auth check timed out — please try again');
      const jwt = sessionData.session?.access_token;
      if (!jwt) throw new Error('not signed in');

      // Hard client-side deadline: 35s. The server's own Gemini cap is
      // 25s; we leave room for the round-trip + Vercel cold start and
      // then bail with a clear error rather than spinning forever.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35_000);

      let resp: Response;
      try {
        resp = await fetch('/api/ai-build', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({
            prompt: args.prompt,
            kind: args.kind,
            board_id: args.boardId,
            model: args.model,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('AI build timed out after 35 seconds. Please try again.');
        }
        throw new Error(err instanceof Error ? err.message : String(err));
      }
      clearTimeout(timer);

      const text = await resp.text();
      let payload: unknown;
      try { payload = JSON.parse(text); }
      catch { throw new Error(`bad response (HTTP ${resp.status}): ${text.slice(0, 200)}`); }

      if (!resp.ok) {
        const errMsg = (payload as { error?: string } | null)?.error
          ?? `request failed (HTTP ${resp.status})`;
        throw new Error(errMsg);
      }
      return payload as AiBuildResponse;
    },
  });
}
