import { useMemo } from 'react';
import {
  DndContext, closestCenter, useDroppable, useDraggable, useSensor, useSensors, PointerSensor, KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useBoardItems, useUpdateCellValue } from '@/hooks/items';
import { useColumns } from '@/hooks/columns';
import { useColumnLabels } from '@/hooks/labels';
import { useGroups } from '@/hooks/groups';
import { useCreateItem } from '@/hooks/items';
import { useNavigate } from '@tanstack/react-router';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import type { ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';
import { cn } from '@/lib/cn';

interface KanbanViewProps {
  boardId: string;
  // Which column (status/priority) to group cards by. Inferred from the
  // view's settings.column_id when present; otherwise the first status
  // column on the board.
  groupByColumnId?: string;
  canEdit: boolean;
}

export function KanbanView({ boardId, groupByColumnId, canEdit }: KanbanViewProps) {
  const { data: items, isLoading: itemsLoading } = useBoardItems(boardId);
  const { data: columns, isLoading: colsLoading } = useColumns(boardId);
  const { data: labelsByColumnId } = useColumnLabels(boardId);
  const { data: groups } = useGroups(boardId);
  const updateCell = useUpdateCellValue();
  const create = useCreateItem();
  const navigate = useNavigate();

  // Pick the column to group by: explicit, otherwise the first status / priority column.
  const groupCol = useMemo(() => {
    if (!columns) return null;
    if (groupByColumnId) return columns.find((c) => c.id === groupByColumnId) ?? null;
    return columns.find((c) => c.column_type === 'status')
        ?? columns.find((c) => c.column_type === 'priority')
        ?? null;
  }, [columns, groupByColumnId]);

  const labels: ColumnLabelRow[] = (groupCol && labelsByColumnId?.get(groupCol.id)) ?? [];

  // Bucket items by label id (plus an "Unassigned" bucket).
  const buckets = useMemo(() => {
    const map = new Map<string, ItemRow[]>();
    map.set('unassigned', []);
    for (const l of labels) map.set(l.id, []);
    if (!items || !groupCol) return map;
    for (const it of items.items) {
      if (it.parent_item_id) continue;          // skip subitems on kanban
      if (it.archived_at) continue;
      const v = items.valuesByItemColumn.get(`${it.id}:${groupCol.id}`) as { label_id?: string } | undefined;
      const key = v?.label_id && map.has(v.label_id) ? v.label_id : 'unassigned';
      map.get(key)!.push(it);
    }
    return map;
  }, [items, labels, groupCol]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (itemsLoading || colsLoading) {
    return <div className="flex items-center justify-center py-12"><Spinner className="h-6 w-6 text-brand" /></div>;
  }
  if (!groupCol) {
    return (
      <EmptyMessage
        title="No status column to group by"
        description="Kanban needs a Status or Priority column. Add one from the + Add column menu to use this view."
      />
    );
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || !groupCol) return;
    const itemId = String(active.id);
    const targetLabelId = String(over.id); // "unassigned" or a label id
    const item = items?.items.find((i) => i.id === itemId);
    if (!item) return;

    const newValue = targetLabelId === 'unassigned' ? null : { label_id: targetLabelId };
    updateCell.mutate({
      boardId, itemId, columnId: groupCol.id, value: newValue,
    });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="px-8 py-4 flex gap-3 overflow-x-auto items-start min-h-[420px]">
        {/* Render each label as its own column. Unassigned bucket only shows when non-empty. */}
        {(buckets.get('unassigned')?.length ?? 0) > 0 && (
          <KanbanColumn
            id="unassigned"
            title="Unassigned"
            color="#C4C4C4"
            items={buckets.get('unassigned')!}
            boardId={boardId}
            canEdit={false}             // can't drop here as the "create" target; drop sets value=null
            onAdd={null}
            onOpenItem={(id) => navigate({
              to: '/w/$workspace/b/$boardId',
              params: { workspace: 'main', boardId },
              search: { p: id },
            })}
          />
        )}
        {labels.map((l) => (
          <KanbanColumn
            key={l.id}
            id={l.id}
            title={l.name}
            color={l.color}
            items={buckets.get(l.id) ?? []}
            boardId={boardId}
            canEdit={canEdit}
            onAdd={canEdit && groups && groups[0] ? async (name) => {
              const newItem = await create.mutateAsync({ boardId, groupId: groups[0].id, name });
              // Immediately set the status to this label.
              updateCell.mutate({
                boardId, itemId: newItem.id, columnId: groupCol.id, value: { label_id: l.id },
              });
            } : null}
            onOpenItem={(id) => navigate({
              to: '/w/$workspace/b/$boardId',
              params: { workspace: 'main', boardId },
              search: { p: id },
            })}
          />
        ))}
      </div>
    </DndContext>
  );
}

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  items: ItemRow[];
  boardId: string;
  canEdit: boolean;
  onAdd: ((name: string) => Promise<void>) | null;
  onOpenItem: (id: string) => void;
}

function KanbanColumn({ id, title, color, items, canEdit, onAdd, onOpenItem }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'shrink-0 w-[280px] bg-app/40 rounded-md border border-border-light flex flex-col max-h-[calc(100vh-280px)]',
        isOver && 'ring-2 ring-brand',
      )}
    >
      <header
        className="px-3 py-2 rounded-t-md flex items-center justify-between text-white"
        style={{ background: color }}
      >
        <span className="text-[13px] font-semibold uppercase tracking-wide truncate">{title}</span>
        <span className="text-[12px] font-medium bg-white/20 rounded-pill px-2 py-0.5">{items.length}</span>
      </header>
      <ul className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {items.map((it) => <KanbanCard key={it.id} item={it} onOpen={() => onOpenItem(it.id)} />)}
        {items.length === 0 && (
          <li className="text-[12px] text-text-disabled text-center py-6 italic">Drop here</li>
        )}
      </ul>
      {canEdit && onAdd && <KanbanAdd onAdd={onAdd} />}
    </div>
  );
}

function KanbanCard({ item, onOpen }: { item: ItemRow; onOpen: () => void }) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: item.id });
  const style: React.CSSProperties | undefined = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.4 : 1 }
    : undefined;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="bg-surface border border-border-light rounded-base px-3 py-2 shadow-sm cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
      onDoubleClick={onOpen}
      title="Drag to change status. Double-click to open."
    >
      <p className="text-[13px] text-text-primary leading-snug">{item.name}</p>
      <p className="text-[11px] text-text-disabled font-mono mt-0.5">{item.task_code}</p>
    </li>
  );
}

function KanbanAdd({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await onAdd(draft.trim());
      setDraft('');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="border-t border-border-light p-2">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !submitting) void submit();
        }}
        placeholder="+ Add task"
        disabled={submitting}
        className="input h-7 text-[13px] w-full"
      />
    </div>
  );
}

// Local useState shim so the file is self-contained — React hooks
// already-imported elsewhere may not be in scope here.
import { useState } from 'react';
