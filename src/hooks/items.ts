/**
 * TanStack Query hooks for items + cell values.
 *
 * Boards in V1 have at most a few hundred items, so we fetch everything
 * (items + values) per board in one go.  Larger boards will need pagination
 * later but it isn't worth the complexity yet.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import { publishBoardChange } from '@/lib/boardSync';
import { useUndoStore } from '@/lib/undoStack';
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
//
// Cause-agnostic by design — whether the rejection is a 401, an RLS
// denial, a 404, a timeout, or a network drop, the user gets a
// concrete message and we get the evidence we need.
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
    // P4.0 fix: refetchOnWindowFocus was true here, which made FIVE
    // board queries refetch simultaneously on tab refocus and pile
    // onto the (possibly parked / stale-token) H/2 socket — the actual
    // source of the refocus stampede + 401 spam. Cross-device
    // freshness is already handled by the 3-second board_watermark
    // poll below; that single small RPC catches up the heavy queries
    // within 3s of refocus without the stampede. The new
    // refreshAndProbe() in lib/supabase.ts handles the token + socket
    // recovery before the watermark poll runs again.
    refetchOnWindowFocus: false,
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
// UI polish (batch item 4): the create flow is now optimistic. Callers
// pre-generate the item's UUID and pass it as `id`; we paint an
// optimistic row in the items cache immediately (with task_code='…'
// as a placeholder — the DB before_item_insert trigger fills the real
// "Task N" code server-side). When the insert resolves, we replace
// the same-id row in place: React reconciles by key, so it's a
// field-level update (task_code becomes "Task N"), not a remount.
// On error we roll back to the previous cache snapshot. No
// invalidateQueries — that's what made the old flow flash the whole
// board after every add.
export interface CreateItemInput {
  boardId: string;
  groupId: string;
  parentItemId?: string | null;
  name?: string;
  // Optional pre-generated id. When supplied, we paint an optimistic
  // row at this id immediately and replace it with the real row at the
  // same id when the insert returns. When absent, we fall back to the
  // server-default uuid and skip the optimistic path.
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
      const { data, error } = await supabase
        .from('items')
        .insert(payload as never)
        .select('*')
        .single();
      if (error) throw error;
      return data as ItemRow;
    },
    onMutate: async (vars) => {
      // Skip optimistic when the caller didn't pre-generate an id —
      // we'd have no stable key to swap on. The mutation still runs
      // normally, just without the instant-paint.
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
        task_code: '…',                 // ← placeholder until the trigger-filled value lands
        sort_order: 0,                   // ← matches the DB default so position stays put on swap
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
      // Replace the optimistic row (same id, when caller supplied one)
      // with the real one — task_code goes from "…" → "Task N", any
      // server-fixed timestamps land. If the optimistic row is missing
      // for any reason (no pre-gen id / cache evicted mid-flight), we
      // prepend the real row. We do NOT invalidate — that would refetch
      // the whole board and flash the user's optimistic edits away.
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
      // Undo: soft-delete the freshly-created item.
      useUndoStore.getState().push({
        description: 'create "' + item.name + '"',
        undo: async () => {
          const { error } = await supabase
            .from('items')
            .update({ deleted_at: new Date().toISOString() } as never)
            .eq('id', item.id);
          if (error) throw error;
          void qc.invalidateQueries({ queryKey: itemKeys.board(item.board_id) });
          publishBoardChange(item.board_id);
        },
      });
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
          const { error } = await supabase
            .from('items')
            .update({ name: oldName, updated_by: userId } as never)
            .eq('id', vars.id);
          if (error) throw error;
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
            const { error } = await supabase
              .from('item_column_values')
              .delete()
              .eq('item_id', vars.itemId)
              .eq('column_id', vars.columnId);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from('item_column_values')
              .upsert({
                item_id: vars.itemId, column_id: vars.columnId,
                value: oldValue, updated_by: userId,
              } as never, { onConflict: 'item_id,column_id' });
            if (error) throw error;
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
      const { error } = await supabase
        .from('items')
        .update({ archived_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
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
      const { error } = await supabase
        .from('items')
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: ({ id, boardId }) => {
      // Capture the task name BEFORE we hide the row so the undo toast
      // can name it. (No optimistic UI patch here — the existing flow
      // relies on the onSettled invalidate to redraw.)
      const previous = qc.getQueryData<BoardItemsData>(itemKeys.board(boardId));
      const itemName = previous?.items.find((i) => i.id === id)?.name ?? 'task';
      return { itemName };
    },
    onSuccess: (_d, vars, ctx) => {
      const itemName = ctx?.itemName ?? 'task';
      useUndoStore.getState().push({
        description: 'delete of "' + itemName + '"',
        undo: async () => {
          const { error } = await supabase
            .from('items')
            .update({ deleted_at: null } as never)
            .eq('id', vars.id);
          if (error) throw error;
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
      // Snapshot the BEFORE state for each touched item so the undo
      // can move it back to its original group + position. (Read once
      // from cache; closing the closure over the result.)
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
      // Describe as "move" when at least one patch moves between
      // groups; otherwise it's just a reorder within a single group.
      const isMove = vars.patches.some((p) => p.group_id !== undefined);
      useUndoStore.getState().push({
        description: isMove ? 'move of ' + reversePatches.length + ' task(s)'
                            : 'reorder of ' + reversePatches.length + ' task(s)',
        undo: async () => {
          for (const p of reversePatches) {
            const { id, ...rest } = p;
            const { error } = await supabase.from('items').update(rest as never).eq('id', id);
            if (error) throw error;
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
      const { error } = await supabase
        .from('items')
        .update(patch as never)
        .in('id', args.ids);
      if (error) throw error;
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
