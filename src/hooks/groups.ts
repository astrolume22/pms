import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { publishBoardChange } from '@/lib/boardSync';
import { useUndoStore } from '@/lib/undoStack';
import { itemKeys, type BoardItemsData } from '@/hooks/items';
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
    // See useBoardItems comment — refetch on focus + every 60s as the
    // cross-device sync backstop.
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: async (): Promise<GroupRow[]> => {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .eq('board_id', boardId!)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as GroupRow[];
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, name }: { boardId: string; name: string }) => {
      const { data: existing } = await supabase
        .from('groups')
        .select('sort_order')
        .eq('board_id', boardId)
        .order('sort_order', { ascending: false })
        .limit(1);
      const nextSort = ((existing?.[0] as { sort_order?: number })?.sort_order ?? -1) + 1;
      const payload = {
        board_id: boardId,
        name: name.trim() || 'New group',
        color: randomColor(),
        sort_order: nextSort,
      };
      const { data, error } = await supabase.from('groups').insert(payload as never).select('*').single();
      if (error) throw error;
      return data as GroupRow;
    },
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: groupKeys.board(g.board_id) });
      publishBoardChange(g.board_id);
      // Undo: soft-delete the freshly-created group.
      useUndoStore.getState().push({
        description: 'create group "' + g.name + '"',
        undo: async () => {
          const { error } = await supabase
            .from('groups')
            .update({ deleted_at: new Date().toISOString() } as never)
            .eq('id', g.id);
          if (error) throw error;
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
      const { error } = await supabase.from('groups').update(patch as never).eq('id', id);
      if (error) throw error;
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
      const { error } = await supabase
        .from('groups')
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: ({ id, boardId }) => {
      // Snapshot the group's name + the ids of every alive item inside
      // it BEFORE we soft-delete. Even though useDeleteGroup itself
      // does not cascade to items today, other paths (or a future
      // trigger) might — so the undo conservatively restores any
      // items that were soft-deleted with the same timestamp window.
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
          const { error: gErr } = await supabase
            .from('groups')
            .update({ deleted_at: null } as never)
            .eq('id', vars.id);
          if (gErr) throw gErr;
          // 2. Restore any items that were soft-deleted as part of
          //    the group delete. Safe even if none were — the .in()
          //    update is a no-op on an empty array.
          if (itemIds.length > 0) {
            const { error: iErr } = await supabase
              .from('items')
              .update({ deleted_at: null } as never)
              .in('id', itemIds);
            if (iErr) throw iErr;
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
        const { error } = await supabase
          .from('groups')
          .update({ sort_order: i } as never)
          .eq('id', orderedIds[i]);
        if (error) throw error;
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
