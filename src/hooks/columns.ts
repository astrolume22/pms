import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publishBoardChange } from '@/lib/boardSync';
import {
  dbSelect,
  dbInsertReturning,
  dbInsertMany,
  dbUpdate,
  dbDelete,
  eq,
  isNull,
} from '@/lib/db';
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
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ColumnRow[]> => {
      return await dbSelect<ColumnRow>('columns', {
        filters: { board_id: eq(boardId!), archived_at: isNull },
        order: 'sort_order.asc',
      });
    },
  });
}

export function useCreateColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, type }: { boardId: string; type: Exclude<ColumnType, 'task_name'> }) => {
      // Determine next sort_order.
      const existing = await dbSelect<{ sort_order: number }>('columns', {
        select: 'sort_order',
        filters: { board_id: eq(boardId) },
        order: 'sort_order.desc',
        limit: 1,
      });
      const nextSort = (existing[0]?.sort_order ?? -1) + 1;
      const insert = {
        board_id: boardId,
        name: DEFAULT_NAME[type],
        column_type: type,
        sort_order: nextSort,
        width: DEFAULT_WIDTH[type],
      };
      const col = await dbInsertReturning<ColumnRow>('columns', insert);

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
        await dbInsertMany('column_labels', seeds.map((s) => ({ column_id: col.id, ...s })));
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
      await dbUpdate('columns', { id: eq(id) }, patch);
    },
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
      for (let i = 0; i < orderedIds.length; i += 1) {
        await dbUpdate('columns', { id: eq(orderedIds[i]) }, { sort_order: i });
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
      // The DB trigger guard_task_name_column rejects task_name deletes.
      await dbDelete('columns', { id: eq(id) });
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: columnKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
  });
}
