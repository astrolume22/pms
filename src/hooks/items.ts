/**
 * TanStack Query hooks for items + cell values.
 *
 * Boards in V1 have at most a few hundred items, so we fetch everything
 * (items + values) per board in one go.  Larger boards will need pagination
 * later but it isn't worth the complexity yet.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import type { ItemRow, ItemColumnValueRow } from '@/lib/database.types';

export const itemKeys = {
  all:    ['items'] as const,
  board:  (boardId: string) => [...itemKeys.all, 'board', boardId] as const,
};

// ---------------------------------------------------------------------
// useBoardItems — items + values for a board (active + archived flag)
// ---------------------------------------------------------------------
export interface BoardItemsData {
  items: ItemRow[];                            // all non-deleted items
  valuesByItemColumn: Map<string, unknown>;    // key = "${item_id}:${column_id}"
}

const cellKey = (itemId: string, columnId: string) => `${itemId}:${columnId}`;

export function useBoardItems(boardId: string | undefined) {
  return useQuery<BoardItemsData>({
    queryKey: boardId ? itemKeys.board(boardId) : ['items', '_'],
    enabled: !!boardId,
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from('items')
        .select('*')
        .eq('board_id', boardId!)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      const itemRows = (items ?? []) as ItemRow[];
      if (itemRows.length === 0) {
        return { items: [], valuesByItemColumn: new Map() };
      }
      const { data: values, error: vErr } = await supabase
        .from('item_column_values')
        .select('id, item_id, column_id, value, updated_by, updated_at')
        .in('item_id', itemRows.map((i) => i.id));
      if (vErr) throw vErr;
      const map = new Map<string, unknown>();
      for (const v of (values ?? []) as ItemColumnValueRow[]) {
        map.set(cellKey(v.item_id, v.column_id), v.value);
      }
      return { items: itemRows, valuesByItemColumn: map };
    },
  });
}

export function getCellValue(data: BoardItemsData | undefined, itemId: string, columnId: string): unknown {
  return data?.valuesByItemColumn.get(cellKey(itemId, columnId));
}

// ---------------------------------------------------------------------
// useCreateItem — top-level or subitem (parent_item_id optional)
// ---------------------------------------------------------------------
export interface CreateItemInput {
  boardId: string;
  groupId: string;
  parentItemId?: string | null;
  name?: string;
}

export function useCreateItem() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ boardId, groupId, parentItemId, name }: CreateItemInput): Promise<ItemRow> => {
      if (!userId) throw new Error('Not signed in');
      const payload = {
        board_id: boardId,
        group_id: groupId,
        parent_item_id: parentItemId ?? null,
        name: (name ?? 'New task').trim() || 'New task',
        task_code: '',          // trigger fills it
        created_by: userId,
      };
      const { data, error } = await supabase
        .from('items')
        .insert(payload as never)
        .select('*')
        .single();
      if (error) throw error;
      return data as ItemRow;
    },
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: itemKeys.board(item.board_id) });
    },
  });
}

// ---------------------------------------------------------------------
// useRenameItem — rename a single item (used by inline edit)
// ---------------------------------------------------------------------
export function useRenameItem() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string; boardId: string }) => {
      const { error } = await supabase
        .from('items')
        .update({ name, updated_by: userId } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, name, boardId }) => {
      await qc.cancelQueries({ queryKey: itemKeys.board(boardId) });
      const previous = qc.getQueryData<BoardItemsData>(itemKeys.board(boardId));
      if (previous) {
        qc.setQueryData<BoardItemsData>(itemKeys.board(boardId), {
          ...previous,
          items: previous.items.map((i) => (i.id === id ? { ...i, name } : i)),
        });
      }
      return { previous };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(itemKeys.board(vars.boardId), ctx.previous);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
    },
  });
}

// ---------------------------------------------------------------------
// useUpdateCellValue — upsert into item_column_values
// Optimistic update for snappy feel.
// ---------------------------------------------------------------------
export interface UpdateCellInput {
  boardId: string;
  itemId: string;
  columnId: string;
  value: unknown;       // pass null to clear
}

export function useUpdateCellValue() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ itemId, columnId, value }: UpdateCellInput) => {
      if (value === null || value === undefined) {
        // Delete the row to clear the cell.
        const { error } = await supabase
          .from('item_column_values')
          .delete()
          .eq('item_id', itemId)
          .eq('column_id', columnId);
        if (error) throw error;
      } else {
        const row = { item_id: itemId, column_id: columnId, value, updated_by: userId };
        const { error } = await supabase
          .from('item_column_values')
          .upsert(row as never, { onConflict: 'item_id,column_id' });
        if (error) throw error;
      }
    },
    onMutate: async ({ boardId, itemId, columnId, value }) => {
      await qc.cancelQueries({ queryKey: itemKeys.board(boardId) });
      const previous = qc.getQueryData<BoardItemsData>(itemKeys.board(boardId));
      if (previous) {
        const next = new Map(previous.valuesByItemColumn);
        if (value === null || value === undefined) next.delete(cellKey(itemId, columnId));
        else next.set(cellKey(itemId, columnId), value);
        qc.setQueryData<BoardItemsData>(itemKeys.board(boardId), {
          ...previous,
          valuesByItemColumn: next,
        });
      }
      return { previous };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(itemKeys.board(vars.boardId), ctx.previous);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
    },
  });
}

// ---------------------------------------------------------------------
// useArchiveItem / useDeleteItem (soft delete only)
// ---------------------------------------------------------------------
export function useArchiveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; boardId: string }) => {
      const { error } = await supabase
        .from('items')
        .update({ archived_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) }),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; boardId: string }) => {
      const { error } = await supabase
        .from('items')
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) }),
  });
}

// ---------------------------------------------------------------------
// useReorderItems — persist sort_order + (optionally) move to new group
// Accepts a list of patches: { id, sort_order, group_id? }
// ---------------------------------------------------------------------
export interface ItemPatch {
  id: string;
  sort_order?: number;
  group_id?: string;
}

export function useReorderItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, patches }: { boardId: string; patches: ItemPatch[] }) => {
      // Run each patch sequentially — PostgREST doesn't support batched updates by id.
      // Small N (< 100 usually), so this is fine.
      for (const p of patches) {
        const { id, ...rest } = p;
        const { error } = await supabase.from('items').update(rest as never).eq('id', id);
        if (error) throw error;
      }
      return boardId;
    },
    onMutate: async ({ boardId, patches }) => {
      await qc.cancelQueries({ queryKey: itemKeys.board(boardId) });
      const previous = qc.getQueryData<BoardItemsData>(itemKeys.board(boardId));
      if (previous) {
        const patchMap = new Map(patches.map((p) => [p.id, p]));
        const nextItems = previous.items.map((i) => {
          const p = patchMap.get(i.id);
          if (!p) return i;
          return { ...i, ...('sort_order' in p ? { sort_order: p.sort_order! } : {}),
                    ...('group_id' in p ? { group_id: p.group_id! } : {}) };
        });
        qc.setQueryData<BoardItemsData>(itemKeys.board(boardId), { ...previous, items: nextItems });
      }
      return { previous };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(itemKeys.board(vars.boardId), ctx.previous);
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) }),
  });
}

// ---------------------------------------------------------------------
// Bulk: archive / delete / move-to-group (multiple item ids)
// ---------------------------------------------------------------------
export function useBulkItemAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      args:
        | { kind: 'archive'; boardId: string; ids: string[] }
        | { kind: 'delete';  boardId: string; ids: string[] }
        | { kind: 'move';    boardId: string; ids: string[]; groupId: string },
    ) => {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> =
        args.kind === 'archive' ? { archived_at: now }
        : args.kind === 'delete' ? { deleted_at: now }
        : { group_id: args.groupId };
      const { error } = await supabase
        .from('items')
        .update(patch as never)
        .in('id', args.ids);
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) }),
  });
}
