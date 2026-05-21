/**
 * Admin deep-copy hooks for board / group. Server-side SECURITY DEFINER
 * functions in migration 0025 enforce the admin gate.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { boardKeys } from './boards';
import { groupKeys } from './groups';

export function useDuplicateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (boardId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('duplicate_board', { p_board_id: boardId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: boardKeys.list() }),
  });
}

export function useDuplicateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { groupId: string; boardId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc('duplicate_group', { p_group_id: args.groupId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: groupKeys.board(vars.boardId) });
      void qc.invalidateQueries({ queryKey: ['items', 'board', vars.boardId] });
    },
  });
}
