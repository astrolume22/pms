import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { publishBoardChange } from '@/lib/boardSync';
import type { ColumnRow, ColumnType } from '@/lib/database.types';

export const columnKeys = {
  all: ['columns'] as const,
  board: (boardId: string) => [...columnKeys.all, 'board', boardId] as const,
};

// Widths tuned to match Monday's roomier proportions — colored label
// blocks need to feel substantial. Migration 0015 widens existing
// columns on the live DB; these defaults govern brand-new columns.
const DEFAULT_WIDTH: Record<ColumnType, number> = {
  task_name: 320,
  text: 220,
  status: 180,
  priority: 180,
  people: 160,
  date: 140,
  numbers: 140,
  checkbox: 90,
  dropdown: 200,
  link: 200,
  files: 160,
};

const DEFAULT_NAME: Record<ColumnType, string> = {
  task_name: 'Task',
  text: 'Text',
  status: 'Status',
  priority: 'Priority',
  people: 'Person',
  date: 'Date',
  numbers: 'Number',
  checkbox: 'Done',
  dropdown: 'Tags',
  link: 'Link',
  files: 'Files',
};

export function useColumns(boardId: string | undefined) {
  return useQuery({
    queryKey: boardId ? columnKeys.board(boardId) : ['columns', '_'],
    enabled: !!boardId,
    // See useBoardItems comment — refetch on focus, watermark poll
    // drives background invalidation cheaply.
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ColumnRow[]> => {
      const { data, error } = await supabase
        .from('columns')
        .select('*')
        .eq('board_id', boardId!)
        .is('archived_at', null)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ColumnRow[];
    },
  });
}

export function useCreateColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, type }: { boardId: string; type: Exclude<ColumnType, 'task_name'> }) => {
      // Determine next sort_order.
      const { data: existing } = await supabase
        .from('columns')
        .select('sort_order')
        .eq('board_id', boardId)
        .order('sort_order', { ascending: false })
        .limit(1);
      const nextSort = ((existing?.[0] as { sort_order?: number })?.sort_order ?? -1) + 1;
      const insert = {
        board_id: boardId,
        name: DEFAULT_NAME[type],
        column_type: type,
        sort_order: nextSort,
        width: DEFAULT_WIDTH[type],
      };
      const { data, error } = await supabase
        .from('columns')
        .insert(insert as never)
        .select('*')
        .single();
      if (error) throw error;
      const col = data as ColumnRow;

      // For label-bearing columns, seed an empty default label so the cell
      // renders meaningfully on first click.
      if (type === 'status' || type === 'priority' || type === 'dropdown') {
        const seeds = type === 'priority'
          ? [
              { name: 'Low',      color: '#579BFC', sort_order: 0, is_default: true  },
              { name: 'Medium',   color: '#FFCB00', sort_order: 1, is_default: false },
              { name: 'High',     color: '#FDAB3D', sort_order: 2, is_default: false },
              { name: 'Critical', color: '#E2445C', sort_order: 3, is_default: false },
            ]
          : type === 'status'
          ? [
              { name: 'Not Started',    color: '#C4C4C4', sort_order: 0, is_default: true  },
              { name: 'Working on it',  color: '#FDAB3D', sort_order: 1, is_default: false },
              { name: 'Stuck',          color: '#E2445C', sort_order: 2, is_default: false },
              { name: 'Done',           color: '#00C875', sort_order: 3, is_default: false },
            ]
          : [
              { name: 'Tag 1', color: '#0086C0', sort_order: 0, is_default: false },
              { name: 'Tag 2', color: '#9CD326', sort_order: 1, is_default: false },
            ];
        await supabase
          .from('column_labels')
          .insert(seeds.map((s) => ({ column_id: col.id, ...s })) as never);
      }
      return col;
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: columnKeys.board(c.board_id) });
      publishBoardChange(c.board_id);
    },
  });
}

export function useUpdateColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: {
      id: string; boardId: string;
      patch: Partial<Pick<ColumnRow, 'name' | 'width' | 'sort_order' | 'is_pinned_left' | 'is_pinned_right' | 'settings'>>;
    }) => {
      const { error } = await supabase.from('columns').update(patch as never).eq('id', id);
      if (error) throw error;
    },
    // Optimistic patch. Prevents the "resize snaps back" flicker that
    // happens when the columns query takes its sweet time to refetch
    // after onSettled — the cell layout reads `column.width` straight
    // from the cache, so without this the UI briefly reverts to the
    // pre-mutation width between pointerup and the server response.
    onMutate: async (vars) => {
      const qk = columnKeys.board(vars.boardId);
      await qc.cancelQueries({ queryKey: qk });
      const prev = qc.getQueryData<ColumnRow[]>(qk);
      if (prev) {
        qc.setQueryData<ColumnRow[]>(qk, prev.map((c) =>
          c.id === vars.id ? ({ ...c, ...vars.patch } as ColumnRow) : c,
        ));
      }
      return { prev };
    },
    onError: (_e, vars, ctx) => {
      // Roll back if the server rejected.
      const prev = (ctx as { prev?: ColumnRow[] } | undefined)?.prev;
      if (prev) qc.setQueryData(columnKeys.board(vars.boardId), prev);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: columnKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
  });
}

export function useReorderColumns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, orderedIds }: { boardId: string; orderedIds: string[] }) => {
      // task_name must remain first. Caller is responsible for keeping it pinned.
      for (let i = 0; i < orderedIds.length; i += 1) {
        const { error } = await supabase
          .from('columns')
          .update({ sort_order: i } as never)
          .eq('id', orderedIds[i]);
        if (error) throw error;
      }
      return boardId;
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: columnKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
  });
}

export function useDeleteColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; boardId: string }) => {
      // The DB trigger guard_task_name_column will reject task_name deletes.
      const { error } = await supabase.from('columns').delete().eq('id', id);
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: columnKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
  });
}
