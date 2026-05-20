import { useEffect, useMemo, useState } from 'react';
import {
  DndContext, closestCenter, useSensor, useSensors, PointerSensor, KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useGroups, useReorderGroups } from '@/hooks/groups';
import { useColumns, useReorderColumns } from '@/hooks/columns';
import { useColumnLabels } from '@/hooks/labels';
import { useBoardItems, useReorderItems } from '@/hooks/items';
import { useBoardViewStore } from '@/state/boardViewStore';
import { useAuthStore } from '@/state/authStore';
import { useActiveUsers } from '@/hooks/users';
import { Spinner } from '@/components/Spinner';
import { ColumnHeader } from './table/ColumnHeader';
import { AddColumnMenu } from './table/AddColumnMenu';
import { GroupBlock } from './table/GroupBlock';
import { AddGroupRow } from './table/AddGroupRow';
import { BulkActionBar } from './table/BulkActionBar';
import { LabelsEditorModal } from './table/LabelsEditorModal';
import {
  GUTTER_WIDTH,
  COMMENT_COL_WIDTH,
  TASK_CODE_COL_WIDTH,
  ADD_COL_WIDTH,
} from './table/tableLayout';
import type { BoardWithOwner } from '@/hooks/boards';
import type { ColumnRow, GroupRow, ItemRow } from '@/lib/database.types';

interface BoardContentProps {
  board: BoardWithOwner;
}

export function BoardContent({ board }: BoardContentProps) {
  const profile = useAuthStore((s) => s.profile);
  const userId = profile?.id ?? '';
  const hydrate = useBoardViewStore((s) => s.hydrate);
  useEffect(() => {
    if (userId) hydrate(board.id, userId);
  }, [board.id, userId, hydrate]);

  const canEdit =
    !!profile &&
    (profile.role === 'admin'
      || profile.is_super_admin
      || board.owner_id === profile.id
      || profile.role === 'manager');

  const { data: groups, isLoading: groupsLoading } = useGroups(board.id);
  const { data: columns, isLoading: colsLoading } = useColumns(board.id);
  const { data: labelsByColumnId } = useColumnLabels(board.id);
  const { data: itemsData, isLoading: itemsLoading } = useBoardItems(board.id);
  const { data: users } = useActiveUsers();

  const search = useBoardViewStore((s) => s.search);
  const sort = useBoardViewStore((s) => s.persisted.sort);
  const hiddenIds = useBoardViewStore((s) => s.persisted.hiddenColumnIds);
  const groupByColumnId = useBoardViewStore((s) => s.persisted.groupByColumnId);

  const visibleColumns = useMemo(() => {
    const list = (columns ?? []).slice();
    list.sort((a, b) => a.sort_order - b.sort_order);
    return list.filter((c) => !hiddenIds.includes(c.id) || c.column_type === 'task_name');
  }, [columns, hiddenIds]);

  // Partition items: top-level vs subitems by parent_item_id
  const { topLevel, subitemsByParent } = useMemo(() => {
    const top: ItemRow[] = [];
    const subs = new Map<string, ItemRow[]>();
    for (const it of itemsData?.items ?? []) {
      if (it.archived_at) continue;
      if (it.parent_item_id) {
        const list = subs.get(it.parent_item_id) ?? [];
        list.push(it);
        subs.set(it.parent_item_id, list);
      } else {
        top.push(it);
      }
    }
    // Sort subitems by sort_order
    for (const [, list] of subs) list.sort((a, b) => a.sort_order - b.sort_order);
    return { topLevel: top, subitemsByParent: subs };
  }, [itemsData]);

  // Filter top-level by search (name or task_code match) — recursive through subitems
  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (it: ItemRow): boolean => {
    if (!searchLower) return true;
    if (it.name.toLowerCase().includes(searchLower)) return true;
    if (it.task_code.toLowerCase().includes(searchLower)) return true;
    const kids = subitemsByParent.get(it.id) ?? [];
    return kids.some((k) => k.name.toLowerCase().includes(searchLower) || k.task_code.toLowerCase().includes(searchLower));
  };

  // Sort top-level items by the chosen column (within each group/bucket)
  const sortItems = (list: ItemRow[]): ItemRow[] => {
    if (!sort || !columns) return list.slice().sort((a, b) => a.sort_order - b.sort_order);
    const col = columns.find((c) => c.id === sort.columnId);
    if (!col) return list.slice().sort((a, b) => a.sort_order - b.sort_order);
    const dir = sort.direction === 'asc' ? 1 : -1;
    const valueFor = (it: ItemRow): string | number => {
      if (col.column_type === 'task_name') return it.name.toLowerCase();
      const v = itemsData?.valuesByItemColumn.get(`${it.id}:${col.id}`);
      if (!v) return '';
      if (col.column_type === 'text') return ((v as { text?: string }).text ?? '').toLowerCase();
      if (col.column_type === 'numbers') return (v as { value?: number }).value ?? Number.NEGATIVE_INFINITY;
      if (col.column_type === 'date') return (v as { date?: string }).date ?? '';
      if (col.column_type === 'checkbox') return (v as { checked?: boolean }).checked ? 1 : 0;
      if (col.column_type === 'status' || col.column_type === 'priority') {
        const id = (v as { label_id?: string }).label_id;
        const labels = labelsByColumnId?.get(col.id) ?? [];
        return labels.find((l) => l.id === id)?.sort_order ?? Number.MAX_SAFE_INTEGER;
      }
      return '';
    };
    return list.slice().sort((a, b) => {
      const va = valueFor(a); const vb = valueFor(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return a.sort_order - b.sort_order;
    });
  };

  // Decide bucketing: by group (default) or by a column's value
  const buckets: { id: string; name: string; color: string; items: ItemRow[]; isVirtual?: boolean }[] = useMemo(() => {
    const filtered = topLevel.filter(matchesSearch);

    if (!groupByColumnId || !columns) {
      // Default: real groups
      return (groups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        items: sortItems(filtered.filter((i) => i.group_id === g.id)),
      }));
    }

    const col = columns.find((c) => c.id === groupByColumnId);
    if (!col) {
      return (groups ?? []).map((g) => ({
        id: g.id, name: g.name, color: g.color,
        items: sortItems(filtered.filter((i) => i.group_id === g.id)),
      }));
    }

    // Virtual buckets keyed by value
    const byKey = new Map<string, { name: string; color: string; items: ItemRow[] }>();
    const unset = { name: 'No value', color: '#C4C4C4', items: [] as ItemRow[] };

    if (col.column_type === 'status' || col.column_type === 'priority') {
      const labels = labelsByColumnId?.get(col.id) ?? [];
      for (const l of labels) byKey.set(`label:${l.id}`, { name: l.name, color: l.color, items: [] });
      for (const it of filtered) {
        const v = itemsData?.valuesByItemColumn.get(`${it.id}:${col.id}`) as { label_id?: string } | undefined;
        const id = v?.label_id;
        if (id && byKey.has(`label:${id}`)) byKey.get(`label:${id}`)!.items.push(it);
        else unset.items.push(it);
      }
    } else if (col.column_type === 'people') {
      for (const u of users ?? []) byKey.set(`user:${u.id}`, { name: u.full_name ?? u.username, color: '#579BFC', items: [] });
      for (const it of filtered) {
        const v = itemsData?.valuesByItemColumn.get(`${it.id}:${col.id}`) as { user_ids?: string[] } | undefined;
        if (v?.user_ids && v.user_ids.length > 0) {
          for (const uid of v.user_ids) {
            if (byKey.has(`user:${uid}`)) byKey.get(`user:${uid}`)!.items.push(it);
          }
        } else {
          unset.items.push(it);
        }
      }
    }

    const out = Array.from(byKey.entries()).map(([id, b]) => ({
      id, name: b.name, color: b.color, items: sortItems(b.items), isVirtual: true,
    }));
    if (unset.items.length > 0) out.push({ id: 'unset', ...unset, items: sortItems(unset.items), isVirtual: true });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, columns, topLevel, search, sort, groupByColumnId, labelsByColumnId, users, itemsData]);

  // ---------- dnd-kit ----------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorderGroups = useReorderGroups();
  const reorderColumns = useReorderColumns();
  const reorderItems = useReorderItems();

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const aid = String(active.id);
    const oid = String(over.id);

    // Group drag
    if (aid.startsWith('group:') && oid.startsWith('group:')) {
      const list = (groups ?? []).map((g) => g.id);
      const from = list.indexOf(aid.slice(6));
      const to = list.indexOf(oid.slice(6));
      if (from < 0 || to < 0) return;
      const next = arrayMove(list, from, to);
      void reorderGroups.mutateAsync({ boardId: board.id, orderedIds: next });
      return;
    }

    // Column drag — anything other than task_name reorderable
    const isColA = columns?.some((c) => c.id === aid);
    const isColB = columns?.some((c) => c.id === oid);
    if (isColA && isColB) {
      const sorted = (columns ?? []).slice().sort((x, y) => x.sort_order - y.sort_order);
      const ids = sorted.map((c) => c.id);
      const from = ids.indexOf(aid);
      const to = ids.indexOf(oid);
      if (from < 0 || to < 0) return;
      let next = arrayMove(ids, from, to);
      // Force task_name to remain first
      const taskNameCol = sorted.find((c) => c.column_type === 'task_name');
      if (taskNameCol) {
        next = next.filter((id) => id !== taskNameCol.id);
        next.unshift(taskNameCol.id);
      }
      void reorderColumns.mutateAsync({ boardId: board.id, orderedIds: next });
      return;
    }

    // Item drag (within bucket only — cross-bucket move arrives in V2)
    const aitem = (itemsData?.items ?? []).find((i) => i.id === aid);
    const bitem = (itemsData?.items ?? []).find((i) => i.id === oid);
    if (aitem && bitem) {
      // Only reorder if both are in the same actual group (we don't support
      // dropping across virtual buckets in V1).
      const sameGroup = aitem.group_id === bitem.group_id;
      if (!sameGroup) return;
      const bucketItems = topLevel
        .filter((i) => i.group_id === aitem.group_id)
        .slice()
        .sort((x, y) => x.sort_order - y.sort_order);
      const ids = bucketItems.map((i) => i.id);
      const from = ids.indexOf(aid);
      const to = ids.indexOf(oid);
      if (from < 0 || to < 0) return;
      const next = arrayMove(ids, from, to);
      const patches = next.map((id, i) => ({ id, sort_order: i }));
      void reorderItems.mutateAsync({ boardId: board.id, patches });
    }
  };

  // Modal state for label editing
  const [labelsForColumn, setLabelsForColumn] = useState<ColumnRow | null>(null);

  if (groupsLoading || colsLoading || itemsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }

  const orderedGroupIds = (groups ?? []).map((g) => `group:${g.id}`);
  const columnIds = (columns ?? []).slice().sort((a, b) => a.sort_order - b.sort_order).map((c) => c.id);

  // Shared width used by every row across the table so the column headers
  // and all group rows stay column-aligned inside the single horizontal
  // scroll container.
  //   Gutter + task_name column + synthetic columns (comment + task code)
  //   + all other user-defined columns + "+ Add column" cell.
  // The synthetic comment + task-code cells live in ItemRow between the
  // task_name column and the rest, so we add them once to the row width
  // here too.  Layout constants are centralised in `tableLayout.ts`.
  const dataWidth =
    GUTTER_WIDTH
    + visibleColumns.reduce((sum, c) => sum + c.width, 0)
    + COMMENT_COL_WIDTH
    + TASK_CODE_COL_WIDTH;
  const tableMinWidth = dataWidth + (canEdit ? ADD_COL_WIDTH : 0);

  // Split visible columns the same way ItemRow does so the header row
  // renders Task name first, then the synthetic columns, then the rest.
  const taskNameCol = visibleColumns.find((c) => c.column_type === 'task_name');
  const otherCols   = visibleColumns.filter((c) => c.column_type !== 'task_name');

  return (
    <div className="px-8 py-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        {/* Single horizontal scroll container — column headers and every
            group row share this scroll and stay aligned column-by-column. */}
        <div className="bg-surface border border-border-light rounded-md overflow-x-auto">
          {/* Column-header row */}
          <div
            className="flex items-stretch bg-app/60 border-b border-border-light"
            style={{ minWidth: tableMinWidth }}
          >
            <div
              className="shrink-0 border-r border-border-light sticky left-0 z-[5] bg-app/95 backdrop-blur-sm"
              style={{ width: GUTTER_WIDTH }}
            />

            {/* Task-name header is rendered first and stays sticky-left after
                the gutter — its layout/sticky positioning lives inside
                ColumnHeader. The synthetic comment + task-code headers come
                after, then the remaining user-defined columns. */}
            <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
              {taskNameCol && (
                <ColumnHeader
                  key={taskNameCol.id}
                  column={taskNameCol}
                  boardId={board.id}
                  canEdit={canEdit}
                  onOpenLabelsEditor={setLabelsForColumn}
                />
              )}

              {/* Synthetic header cells — empty title for the comment column,
                  "Code" for the task-code column. Centered, same uppercase
                  style as ColumnHeader's text. */}
              <div
                style={{ width: COMMENT_COL_WIDTH }}
                className="shrink-0 border-r border-border-light flex items-center justify-center"
                aria-hidden="true"
              />
              <div
                style={{ width: TASK_CODE_COL_WIDTH }}
                className="shrink-0 border-r border-border-light flex items-center justify-center text-[12px] uppercase tracking-[0.04em] text-text-secondary font-semibold"
              >
                Code
              </div>

              {otherCols.map((col) => (
                <ColumnHeader
                  key={col.id}
                  column={col}
                  boardId={board.id}
                  canEdit={canEdit}
                  onOpenLabelsEditor={setLabelsForColumn}
                />
              ))}
            </SortableContext>
            {canEdit && <AddColumnMenu boardId={board.id} disabled={!canEdit} />}
          </div>

          {/* Buckets (real groups or virtual) */}
          {groupByColumnId ? (
            buckets.map((b) => (
              <VirtualBucket
                key={b.id}
                bucket={b}
                columns={columns ?? []}
                visibleColumns={visibleColumns}
                labelsByColumnId={labelsByColumnId ?? new Map()}
                valuesByItemColumn={itemsData?.valuesByItemColumn ?? new Map()}
                boardId={board.id}
                canEdit={canEdit}
                subitemsByParent={subitemsByParent}
                onOpenLabelsEditor={setLabelsForColumn}
                rowMinWidth={tableMinWidth}
              />
            ))
          ) : (
            <SortableContext items={orderedGroupIds} strategy={verticalListSortingStrategy}>
              {buckets.map((b) => {
                const grp = (groups ?? []).find((g) => g.id === b.id);
                if (!grp) return null;
                return (
                  <GroupBlock
                    key={b.id}
                    group={grp}
                    items={b.items}
                    columns={columns ?? []}
                    visibleColumns={visibleColumns}
                    labelsByColumnId={labelsByColumnId ?? new Map()}
                    valuesByItemColumn={itemsData?.valuesByItemColumn ?? new Map()}
                    boardId={board.id}
                    canEdit={canEdit}
                    subitemsByParent={subitemsByParent}
                    onOpenLabelsEditor={setLabelsForColumn}
                    rowMinWidth={tableMinWidth}
                  />
                );
              })}
            </SortableContext>
          )}
        </div>

        {/* "+ Add new group" lives below the table so adding a group doesn't
            depend on the table's horizontal scroll position. */}
        {!groupByColumnId && (
          <div className="mt-3">
            <AddGroupRow boardId={board.id} disabled={!canEdit} />
          </div>
        )}
      </DndContext>

      {/* Hidden-columns chip */}
      {hiddenIds.length > 0 && (
        <p className="mt-4 text-xs text-text-disabled">
          {hiddenIds.length} column{hiddenIds.length === 1 ? '' : 's'} hidden. Toggle via the Hide menu.
        </p>
      )}

      <BulkActionBar boardId={board.id} groups={groups ?? []} canEdit={canEdit} />

      {labelsForColumn && (
        <LabelsEditorModal
          open
          onClose={() => setLabelsForColumn(null)}
          boardId={board.id}
          column={labelsForColumn}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Virtual bucket — used when group-by is set. Same surface as a real
// group but read-only (you can't drag-reorder across virtual buckets in V1).
// ---------------------------------------------------------------------
function VirtualBucket({
  bucket, columns, visibleColumns, labelsByColumnId, valuesByItemColumn,
  boardId, canEdit, subitemsByParent, onOpenLabelsEditor, rowMinWidth,
}: {
  bucket: { id: string; name: string; color: string; items: ItemRow[] };
  columns: ColumnRow[];
  visibleColumns: ColumnRow[];
  labelsByColumnId: Map<string, import('@/lib/database.types').ColumnLabelRow[]>;
  valuesByItemColumn: Map<string, unknown>;
  boardId: string;
  canEdit: boolean;
  subitemsByParent: Map<string, ItemRow[]>;
  onOpenLabelsEditor: (col: ColumnRow) => void;
  rowMinWidth: number;
}) {
  // Reuse GroupBlock with a synthesised group row.
  const fakeGroup: GroupRow = {
    id: bucket.id,
    board_id: boardId,
    name: bucket.name,
    color: bucket.color,
    sort_order: 0,
    is_collapsed_default: false,
    created_at: '',
    updated_at: '',
    archived_at: null,
    deleted_at: null,
  };
  return (
    <GroupBlock
      group={fakeGroup}
      items={bucket.items}
      columns={columns}
      visibleColumns={visibleColumns}
      labelsByColumnId={labelsByColumnId}
      valuesByItemColumn={valuesByItemColumn}
      boardId={boardId}
      canEdit={canEdit && bucket.id !== 'unset'}  // can't add to "No value" bucket
      subitemsByParent={subitemsByParent}
      onOpenLabelsEditor={onOpenLabelsEditor}
      rowMinWidth={rowMinWidth}
    />
  );
}

// Re-export Plus icon to keep tree-shaking honest
export { Plus };
