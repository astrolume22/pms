/**
 * Frontend wrappers around the Gemini Supabase RPC layer (migration
 * 0017). The actual HTTPS call to Google happens server-side inside
 * `gemini_invoke` so the API key never leaves the database.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export const geminiKeys = {
  status: ['gemini', 'status'] as const,
};

export interface GeminiStatus { configured: boolean }

export function useGeminiStatus() {
  return useQuery({
    queryKey: geminiKeys.status,
    queryFn: async (): Promise<GeminiStatus> => {
      const { data, error } = await supabase.rpc('get_gemini_status');
      if (error) throw error;
      return (data as GeminiStatus) ?? { configured: false };
    },
    staleTime: 30_000,
  });
}

export function useSetGeminiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const { error } = await supabase.rpc('set_gemini_key', { p_key: key });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: geminiKeys.status }),
  });
}

export function useClearGeminiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('clear_gemini_key');
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: geminiKeys.status }),
  });
}

export type GeminiModel = 'gemini-2.5-flash' | 'gemini-2.5-pro';

export interface GeminiInvokeArgs {
  prompt: string;
  system?: string;
  model?: GeminiModel;
  feature?: 'create_board' | 'create_tasks' | 'chat' | 'suggest';
}

export interface GeminiResponse {
  ok: boolean;
  reason?: 'not_configured' | 'timeout';
  status?: number;
  text?: string | null;
  raw?: unknown;
}

export function useGeminiInvoke() {
  return useMutation({
    mutationFn: async (args: GeminiInvokeArgs): Promise<GeminiResponse> => {
      const { data, error } = await supabase.rpc('gemini_invoke', {
        p_prompt: args.prompt,
        p_system: args.system ?? null,
        p_model: args.model ?? 'gemini-2.5-flash',
        p_feature: args.feature ?? 'chat',
      });
      if (error) throw error;
      return (data as GeminiResponse) ?? { ok: false };
    },
  });
}
