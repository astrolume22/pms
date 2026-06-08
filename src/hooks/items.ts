/**
 * TanStack Query hooks for items + cell values.
 *
 * Boards in V1 have at most a few hundred items, so we fetch everything
 * (items + values) per board in one go.  Larger boards will need pagination
 * later but it isn't worth the complexity yet.
 *
 * All data calls go through src/lib/db.ts (cached-token PostgREST). The
 * funnel jam (per-request supabase.auth.getSession) is bypassed here too.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuthStore } from '@/state/authStore';
import { publishBoardChange } from '@/lib/boardSync';
import { useUndoStore } from '@/lib/undoStack';
import {
  dbSelect,
  dbInsertReturning,
  dbUpdate,
  dbDelete,
  dbUpsert,
  eq,
  isNull,
  inSet,
} from '@/lib/db';
import type { ItemRow, ItemColumnValueRow } from '@/lib/database.types';

// =====================================================================
// Visible-error helper — kills the "saves silently fail" mystery class.
// Every mutation in this file used to swallow its rejection: the
// optimistic update flickered, then onSettled.invalidateQueries
// refetched DB state and reverted the UI, leaving the user with a
// soundless mystery (especially confusing with two browser tabs open
// on the same account, where it looked like one tab was "locked out").
//
// Each mutation's onError now goes through this helper so the failure
// is impossible to miss: a red toast + the full error object in the
// dev console for diagnosis. Existing optimistic-state rollbacks are
// preserved alongside the toast.
// =====================================================================
function reportMutationError(action: string, err: unknown) {
  const code = (err as { code?: string })?.code;
  const message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : 'unknown error';
  const prefix = `Couldn't ${action}`;
  toast.error(code ? `${prefix} — ${message} (${code})` : `${prefix} — ${message}`);
  console.error(`[items] ${action} failed`, err);
}

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
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const itemRows = await dbSelect<ItemRow>('items', {
        filters: { board_id: eq(boardId!), deleted_at: isNull },
        order: 'sort_order.asc',
      });
      if (itemRows.length === 0) {
        return { items: [], valuesByItemColumn: new Map() };
      }
      const values = await dbSelect<ItemColumnValueRow>('item_column_values', {
        select: 'id,item_id,column_id,value,updated_by,updated_at',
        filters: { item_id: inSet(itemRows.map((i) => i.id)) },
      });
      const map = new Map<string, unknown>();
      for (const v of values) {
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
  id?: string;
}

export function useCreateItem() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ id, boardId, groupId, parentItemId, name }: CreateItemInput): Promise<ItemRow> => {
      if (!userId) throw new Error('Not signed in');
      const payload = {
        ...(id ? { id } : {}),
        board_id: boardId,
        group_id: groupId,
        parent_item_id: parentItemId ?? null,
        name: (name ?? 'New task').trim() || 'New task',
        task_code: '',          // trigger fills it
        created_by: userId,
      };
      return await dbInsertReturning<ItemRow>('items', payload);
    },
    onMutate: async (vars) => {
      if (!vars.id) {
        await qc.cancelQueries({ queryKey: itemKeys.board(vars.boardId) });
        return { previous: qc.getQueryData<BoardItemsData>(itemKeys.board(vars.boardId)) };
      }
      await qc.cancelQueries({ queryKey: itemKeys.board(vars.boardId) });
      const previous = qc.getQueryData<BoardItemsData>(itemKeys.board(vars.boardId));
      const finalName = (vars.name ?? 'New task').trim() || 'New task';
      const now = new Date().toISOString();
      const optimistic: ItemRow = {
        id: vars.id,
        board_id: vars.boardId,
        group_id: vars.groupId,
        parent_item_id: vars.parentItemId ?? null,
        name: finalName,
        task_code: '…',
        sort_order: 0,
        created_by: userId ?? '',
        updated_by: null,
        created_at: now,
        updated_at: now,
        archived_at: null,
        deleted_at: null,
      };
      if (previous) {
        qc.setQueryData<BoardItemsData>(itemKeys.board(vars.boardId), {
          ...previous,
          items: [optimistic, ...previous.items],
        });
      }
      return { previous };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(itemKeys.board(vars.boardId), ctx.previous);
      reportMutationError('create task', err);
    },
    onSuccess: (item) => {
      const cur = qc.getQueryData<BoardItemsData>(itemKeys.board(item.board_id));
      if (cur) {
        let found = false;
        const nextItems = cur.items.map((it) => {
          if (it.id === item.id) { found = true; return item; }
          return it;
        });
        qc.setQueryData<BoardItemsData>(itemKeys.board(item.board_id), {
          ...cur,
          items: found ? nextItems : [item, ...cur.items],
        });
      }
      publishBoardChange(item.board_id);
      useUndoStore.getState().push({
        description: 'create "' + item.name + '"',
        undo: async () => {
          await dbUpdate('items', { id: eq(item.id) }, { deleted_at: new Date().toISOString() });
          void qc.invalidateQueries({ queryKey: itemKeys.board(item.board_id) });
          publishBoardChange(item.board_id);
        },
      });
    },
  });
}

// ---------------------------------------------------------------------
// useRenameItem
// ---------------------------------------------------------------------
export function useRenameItem() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string; boardId: string }) => {
      await dbUpdate('items', { id: eq(id) }, { name, updated_by: userId });
    },
    onMutate: async ({ id, name, boardId }) => {
      await qc.cancelQueries({ queryKey: itemKeys.board(boardId) });
      const previous = qc.getQueryData<BoardItemsData>(itemKeys.board(boardId));
      const oldName = previous?.items.find((i) => i.id === id)?.name ?? null;
      if (previous) {
        qc.setQueryData<BoardItemsData>(itemKeys.board(boardId), {
          ...previous,
          items: previous.items.map((i) => (i.id === id ? { ...i, name } : i)),
        });
      }
      return { previous, oldName };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(itemKeys.board(vars.boardId), ctx.previous);
      reportMutationError('rename task', err);
    },
    onSuccess: (_d, vars, ctx) => {
      if (ctx?.oldName === null || ctx?.oldName === undefined) return;
      const oldName = ctx.oldName;
      useUndoStore.getState().push({
        description: 'rename of "' + vars.name + '" → "' + oldName + '"',
        undo: async () => {
          await dbUpdate('items', { id: eq(vars.id) }, { name: oldName, updated_by: userId });
          void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
          publishBoardChange(vars.boardId);
        },
      });
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
  });
}

// ---------------------------------------------------------------------
// useUpdateCellValue — upsert into item_column_values
// ---------------------------------------------------------------------
export interface UpdateCellInput {
  boardId: string;
  itemId: string;
  columnId: string;
  value: unknown;
}

export function useUpdateCellValue() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ itemId, columnId, value }: UpdateCellInput) => {
      if (value === null || value === undefined) {
        await dbDelete('item_column_values', {
          item_id: eq(itemId),
          column_id: eq(columnId),
        });
      } else {
        await dbUpsert(
          'item_column_values',
          { item_id: itemId, column_id: columnId, value, updated_by: userId },
          { onConflict: 'item_id,column_id' },
        );
      }
    },
    onMutate: async ({ boardId, itemId, columnId, value }) => {
      await qc.cancelQueries({ queryKey: itemKeys.board(boardId) });
      const previous = qc.getQueryData<BoardItemsData>(itemKeys.board(boardId));
      const oldValue = previous?.valuesByItemColumn.get(cellKey(itemId, columnId)) ?? null;
      const itemName = previous?.items.find((i) => i.id === itemId)?.name ?? 'task';
      if (previous) {
        const next = new Map(previous.valuesByItemColumn);
        if (value === null || value === undefined) next.delete(cellKey(itemId, columnId));
        else next.set(cellKey(itemId, columnId), value);
        qc.setQueryData<BoardItemsData>(itemKeys.board(boardId), {
          ...previous,
          valuesByItemColumn: next,
        });
      }
      return { previous, oldValue, itemName };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(itemKeys.board(vars.boardId), ctx.previous);
      reportMutationError('save cell', err);
    },
    onSuccess: (_d, vars, ctx) => {
      const oldValue = ctx?.oldValue ?? null;
      const itemName = ctx?.itemName ?? 'task';
      useUndoStore.getState().push({
        description: 'cell change on "' + itemName + '"',
        undo: async () => {
          if (oldValue === null || oldValue === undefined) {
            await dbDelete('item_column_values', {
              item_id: eq(vars.itemId),
              column_id: eq(vars.columnId),
            });
          } else {
            await dbUpsert(
              'item_column_values',
              { item_id: vars.itemId, column_id: vars.columnId, value: oldValue, updated_by: userId },
              { onConflict: 'item_id,column_id' },
            );
          }
          void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
          publishBoardChange(vars.boardId);
        },
      });
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
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
      await dbUpdate('items', { id: eq(id) }, { archived_at: new Date().toISOString() });
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
    onError: (err) => reportMutationError('archive task', err),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; boardId: string }) => {
      await dbUpdate('items', { id: eq(id) }, { deleted_at: new Date().toISOString() });
    },
    onMutate: ({ id, boardId }) => {
      const previous = qc.getQueryData<BoardItemsData>(itemKeys.board(boardId));
      const itemName = previous?.items.find((i) => i.id === id)?.name ?? 'task';
      return { itemName };
    },
    onSuccess: (_d, vars, ctx) => {
      const itemName = ctx?.itemName ?? 'task';
      useUndoStore.getState().push({
        description: 'delete of "' + itemName + '"',
        undo: async () => {
          await dbUpdate('items', { id: eq(vars.id) }, { deleted_at: null });
          void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
          publishBoardChange(vars.boardId);
        },
      });
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
    onError: (err) => reportMutationError('delete task', err),
  });
}

// ---------------------------------------------------------------------
// useReorderItems — persist sort_order + (optionally) move to new group
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
      for (const p of patches) {
        const { id, ...rest } = p;
        await dbUpdate('items', { id: eq(id) }, rest);
      }
      return boardId;
    },
    onMutate: async ({ boardId, patches }) => {
      await qc.cancelQueries({ queryKey: itemKeys.board(boardId) });
      const previous = qc.getQueryData<BoardItemsData>(itemKeys.board(boardId));
      const reversePatches: ItemPatch[] = previous
        ? patches.map((p) => {
            const prev = previous.items.find((i) => i.id === p.id);
            return {
              id: p.id,
              ...(p.sort_order !== undefined ? { sort_order: prev?.sort_order ?? 0 } : {}),
              ...(p.group_id   !== undefined ? { group_id: prev?.group_id ?? '' }    : {}),
            };
          })
        : [];
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
      return { previous, reversePatches };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(itemKeys.board(vars.boardId), ctx.previous);
      reportMutationError('reorder tasks', err);
    },
    onSuccess: (_d, vars, ctx) => {
      const reversePatches = ctx?.reversePatches ?? [];
      if (reversePatches.length === 0) return;
      const isMove = vars.patches.some((p) => p.group_id !== undefined);
      useUndoStore.getState().push({
        description: isMove ? 'move of ' + reversePatches.length + ' task(s)'
                            : 'reorder of ' + reversePatches.length + ' task(s)',
        undo: async () => {
          for (const p of reversePatches) {
            const { id, ...rest } = p;
            await dbUpdate('items', { id: eq(id) }, rest);
          }
          void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
          publishBoardChange(vars.boardId);
        },
      });
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
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
      await dbUpdate('items', { id: inSet(args.ids) }, patch);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: itemKeys.board(vars.boardId) });
      publishBoardChange(vars.boardId);
    },
    onError: (err, vars) => reportMutationError(
      vars.kind === 'archive' ? 'archive selected tasks'
        : vars.kind === 'delete' ? 'delete selected tasks'
        : 'move selected tasks',
      err,
    ),
  });
}
