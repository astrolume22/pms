import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publishBoardChange } from '@/lib/boardSync';
import { useUndoStore } from '@/lib/undoStack';
import { itemKeys, type BoardItemsData } from '@/hooks/items';
import {
  dbSelect,
  dbInsertReturning,
  dbUpdate,
  eq,
  inSet,
} from '@/lib/db';
import type { GroupRow } from '@/lib/database.types';

export const groupKeys = {
  all: ['groups'] as const,
  board: (boardId: string) => [...groupKeys.all, 'board', boardId] as const,
};

// New-group seed colors — anchored on the OKLCH chip palette (chunk 1)
// so each new spine ties to the chip family. Keep these in sync with
// GroupBlock.COLORS, the picker grid.
const COLORS = [
  'oklch(0.70 0.16 25)',   // coral
  'oklch(0.70 0.16 70)',   // amber
  'oklch(0.70 0.14 160)',  // mint
  'oklch(0.65 0.10 200)',  // teal
  'oklch(0.70 0.12 230)',  // sky
  'oklch(0.65 0.15 295)',  // purple
  'oklch(0.65 0.18 350)',  // pink
  'oklch(0.65 0.05 250)',  // slate
];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export function useGroups(boardId: string | undefined) {
  return useQuery({
    queryKey: boardId ? groupKeys.board(boardId) : ['groups', '_'],
    enabled: !!boardId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<GroupRow[]> => {
      return await dbSelect<GroupRow>('groups', {
        filters: { board_id: eq(boardId!), deleted_at: 'is.null' },
        order: 'sort_order.asc',
      });
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, name }: { boardId: string; name: string }) => {
      // Insert new groups at the TOP of the board. Look up the smallest
      // existing sort_order and pick one below it. Single-row insert.
      const existing = await dbSelect<{ sort_order: number }>('groups', {
        select: 'sort_order',
        filters: { board_id: eq(boardId) },
        order: 'sort_order.asc',
        limit: 1,
      });
      const minSort = existing[0]?.sort_order;
      const nextSort = (minSort ?? 0) - 1;
      const payload = {
        board_id: boardId,
        name: name.trim() || 'New group',
        color: randomColor(),
        sort_order: nextSort,
      };
      return await dbInsertReturning<GroupRow>('groups', payload);
    },
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: groupKeys.board(g.board_id) });
      publishBoardChange(g.board_id);
      useUndoStore.getState().push({
        description: 'create group "' + g.name + '"',
        undo: async () => {
          await dbUpdate('groups', { id: eq(g.id) }, { deleted_at: new Date().toISOString() });
          void qc.invalidateQueries({ queryKey: groupKeys.board(g.board_id) });
          publishBoardChange(g.board_id);
        },
      });
    },
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: {
      id: string; boardId: string;
      patch: Partial<Pick<GroupRow, 'name' | 'color' | 'sort_order' | 'is_collapsed_default'>>;
    }) => {
      await dbUpdate('groups', { id: eq(id) }, patch);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: groupKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; boardId: string }) => {
      await dbUpdate('groups', { id: eq(id) }, { deleted_at: new Date().toISOString() });
    },
    onMutate: ({ id, boardId }) => {
      const groups = qc.getQueryData<GroupRow[]>(groupKeys.board(boardId));
      const groupName = groups?.find((g) => g.id === id)?.name ?? 'group';
      const items = qc.getQueryData<BoardItemsData>(itemKeys.board(boardId));
      const itemIds = items?.items.filter((it) => it.group_id === id).map((it) => it.id) ?? [];
      return { groupName, itemIds };
    },
    onSuccess: (_d, vars, ctx) => {
      const groupName = ctx?.groupName ?? 'group';
      const itemIds = ctx?.itemIds ?? [];
      useUndoStore.getState().push({
        description: 'delete group "' + groupName + '"',
        undo: async () => {
          // 1. Restore the group row.
          await dbUpdate('groups', { id: eq(vars.id) }, { deleted_at: null });
          // 2. Restore any items that were soft-deleted as part of the
          //    group delete. Safe even if none were.
          if (itemIds.length > 0) {
            await dbUpdate('items', { id: inSet(itemIds) }, { deleted_at: null });
          }
          void qc.invalidateQueries({ queryKey: groupKeys.board(vars.boardId) });
          void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
          publishBoardChange(vars.boardId);
        },
      });
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: groupKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
  });
}

export function useReorderGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, orderedIds }: { boardId: string; orderedIds: string[] }) => {
      for (let i = 0; i < orderedIds.length; i += 1) {
        await dbUpdate('groups', { id: eq(orderedIds[i]) }, { sort_order: i });
      }
      return boardId;
    },
    onMutate: async ({ boardId, orderedIds }) => {
      await qc.cancelQueries({ queryKey: groupKeys.board(boardId) });
      const prev = qc.getQueryData<GroupRow[]>(groupKeys.board(boardId));
      if (prev) {
        const map = new Map(prev.map((g) => [g.id, g]));
        const next = orderedIds.map((id, i) => ({ ...(map.get(id) as GroupRow), sort_order: i }));
        qc.setQueryData<GroupRow[]>(groupKeys.board(boardId), next);
      }
      return { prev };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(groupKeys.board(vars.boardId), ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: groupKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
  });
}
