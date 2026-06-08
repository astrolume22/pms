import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dbSelect,
  dbInsertReturning,
  dbUpdate,
  dbDelete,
  eq,
  isNull,
  inSet,
} from '@/lib/db';
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
      const cols = await dbSelect<{ id: string }>('columns', {
        select: 'id',
        filters: { board_id: eq(boardId!), archived_at: isNull },
      });
      const colIds = cols.map((c) => c.id);
      if (colIds.length === 0) return new Map();
      const labels = await dbSelect<ColumnLabelRow>('column_labels', {
        filters: { column_id: inSet(colIds) },
        order: 'sort_order.asc',
      });
      const map = new Map<string, ColumnLabelRow[]>();
      for (const l of labels) {
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
      const existing = await dbSelect<{ sort_order: number }>('column_labels', {
        select: 'sort_order',
        filters: { column_id: eq(columnId) },
        order: 'sort_order.desc',
        limit: 1,
      });
      const nextSort = (existing[0]?.sort_order ?? -1) + 1;
      return await dbInsertReturning<ColumnLabelRow>('column_labels', {
        column_id: columnId,
        name: name.trim() || 'New label',
        color,
        sort_order: nextSort,
      });
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
      await dbUpdate('column_labels', { id: eq(id) }, patch);
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: labelKeys.byBoard(vars.boardId) }),
  });
}

export function useSetDefaultLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, columnId }: LabelMutBase & { id: string }) => {
      // Unset existing default on this column, set this one.
      await dbUpdate('column_labels', { column_id: eq(columnId) }, { is_default: false });
      await dbUpdate('column_labels', { id: eq(id) }, { is_default: true });
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: labelKeys.byBoard(vars.boardId) }),
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: LabelMutBase & { id: string }) => {
      await dbDelete('column_labels', { id: eq(id) });
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: labelKeys.byBoard(vars.boardId) }),
  });
}

export function useReorderLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderedIds }: LabelMutBase & { orderedIds: string[] }) => {
      for (let i = 0; i < orderedIds.length; i += 1) {
        await dbUpdate('column_labels', { id: eq(orderedIds[i]) }, { sort_order: i });
      }
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: labelKeys.byBoard(vars.boardId) }),
  });
}
