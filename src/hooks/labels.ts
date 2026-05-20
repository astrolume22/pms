import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ColumnLabelRow } from '@/lib/database.types';

export const labelKeys = {
  all: ['labels'] as const,
  byBoard: (boardId: string) => [...labelKeys.all, 'board', boardId] as const,
};

// ---------------------------------------------------------------------
// useColumnLabels — fetch all labels for every column on a board, return
// a Map<columnId, ColumnLabelRow[]>
// ---------------------------------------------------------------------
export function useColumnLabels(boardId: string | undefined) {
  return useQuery({
    queryKey: boardId ? labelKeys.byBoard(boardId) : ['labels', '_'],
    enabled: !!boardId,
    queryFn: async (): Promise<Map<string, ColumnLabelRow[]>> => {
      const { data: cols, error: cErr } = await supabase
        .from('columns')
        .select('id')
        .eq('board_id', boardId!)
        .is('archived_at', null);
      if (cErr) throw cErr;
      const colIds = ((cols ?? []) as { id: string }[]).map((c) => c.id);
      if (colIds.length === 0) return new Map();
      const { data, error } = await supabase
        .from('column_labels')
        .select('*')
        .in('column_id', colIds)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      const map = new Map<string, ColumnLabelRow[]>();
      for (const l of (data ?? []) as ColumnLabelRow[]) {
        const list = map.get(l.column_id) ?? [];
        list.push(l);
        map.set(l.column_id, list);
      }
      return map;
    },
  });
}

interface LabelMutBase { columnId: string; boardId: string }

export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ columnId, name, color }: LabelMutBase & { name: string; color: string }) => {
      const { data: existing } = await supabase
        .from('column_labels')
        .select('sort_order')
        .eq('column_id', columnId)
        .order('sort_order', { ascending: false })
        .limit(1);
      const nextSort = ((existing?.[0] as { sort_order?: number })?.sort_order ?? -1) + 1;
      const { data, error } = await supabase
        .from('column_labels')
        .insert({ column_id: columnId, name: name.trim() || 'New label', color, sort_order: nextSort } as never)
        .select('*')
        .single();
      if (error) throw error;
      return data as ColumnLabelRow;
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: labelKeys.byBoard(vars.boardId) }),
  });
}

export function useUpdateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id, patch,
    }: LabelMutBase & { id: string; patch: Partial<Pick<ColumnLabelRow, 'name' | 'color' | 'sort_order'>> }) => {
      const { error } = await supabase.from('column_labels').update(patch as never).eq('id', id);
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: labelKeys.byBoard(vars.boardId) }),
  });
}

export function useSetDefaultLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, columnId }: LabelMutBase & { id: string }) => {
      // Unset existing default on this column, set this one.
      await supabase
        .from('column_labels')
        .update({ is_default: false } as never)
        .eq('column_id', columnId);
      const { error } = await supabase
        .from('column_labels')
        .update({ is_default: true } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: labelKeys.byBoard(vars.boardId) }),
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: LabelMutBase & { id: string }) => {
      const { error } = await supabase.from('column_labels').delete().eq('id', id);
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: labelKeys.byBoard(vars.boardId) }),
  });
}

export function useReorderLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderedIds }: LabelMutBase & { orderedIds: string[] }) => {
      for (let i = 0; i < orderedIds.length; i += 1) {
        const { error } = await supabase
          .from('column_labels')
          .update({ sort_order: i } as never)
          .eq('id', orderedIds[i]);
        if (error) throw error;
      }
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: labelKeys.byBoard(vars.boardId) }),
  });
}
