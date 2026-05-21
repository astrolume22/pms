/**
 * Frontend wrapper for POST /api/ai-build (the Version B endpoint).
 * The function does the Gemini call + auth + role gate; this hook just
 * passes the session JWT and parses the JSON.
 */
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData.session?.access_token;
      if (!jwt) throw new Error('not signed in');

      const resp = await fetch('/api/ai-build', {
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
      });
      const text = await resp.text();
      let payload: unknown;
      try { payload = JSON.parse(text); }
      catch { throw new Error(`bad response: ${text.slice(0, 200)}`); }

      if (!resp.ok) {
        const errMsg = (payload as { error?: string } | null)?.error
          ?? `request failed (${resp.status})`;
        throw new Error(errMsg);
      }
      return payload as AiBuildResponse;
    },
  });
}
