import { useMemo, useState, useRef, useEffect } from 'react';
import {
  DndContext, closestCenter, useDroppable, useDraggable, useSensor, useSensors, PointerSensor, KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Plus, MoreHorizontal, Pencil, Palette, Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useBoardItems, useUpdateCellValue } from '@/hooks/items';
import { useColumns } from '@/hooks/columns';
import { useColumnLabels, useCreateLabel, useUpdateLabel, useDeleteLabel } from '@/hooks/labels';
import { useGroups } from '@/hooks/groups';
import { useCreateItem } from '@/hooks/items';
import { useNavigate } from '@tanstack/react-router';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import type { ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';
import { cn } from '@/lib/cn';

// Same Monday-night chip palette LabelPicker uses — picked in this order
// so the first auto-added Kanban column reads as "Active orange".
const LABEL_PALETTE = [
  '#F8BD6D', '#787F92', '#D0728A', '#33C481',
  '#3DA0CA', '#1F5A62', '#B17FE0', '#265565',
  '#F9885E', '#7DAFF8', '#F74EA1', '#459CC7', '#71BCA5',
  '#6646A7', '#51458F', '#3E3A6B',
  '#FF3D8B',
];

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
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();
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
            label={null}
            unassignedTitle="Unassigned"
            unassignedColor="#C4C4C4"
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
            label={l}
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
            onRename={canEdit ? async (newName) => {
              try {
                await updateLabel.mutateAsync({
                  id: l.id, columnId: groupCol.id, boardId, patch: { name: newName },
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Rename failed');
              }
            } : null}
            onChangeColor={canEdit ? async (color) => {
              try {
                await updateLabel.mutateAsync({
                  id: l.id, columnId: groupCol.id, boardId, patch: { color },
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Color update failed');
              }
            } : null}
            onDelete={canEdit ? async () => {
              if (!window.confirm(`Delete label "${l.name}"? Items using it will lose this status.`)) return;
              try {
                await deleteLabel.mutateAsync({ id: l.id, columnId: groupCol.id, boardId });
                toast.success('Label deleted');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Delete failed');
              }
            } : null}
            onOpenItem={(id) => navigate({
              to: '/w/$workspace/b/$boardId',
              params: { workspace: 'main', boardId },
              search: { p: id },
            })}
          />
        ))}

        {/* Trailing "+ Add label" column — only when the user can edit. */}
        {canEdit && (
          <AddLabelColumn
            onAdd={async (name) => {
              // Pick a palette color that isn't already in use
              const used = new Set(labels.map((l) => l.color));
              const color = LABEL_PALETTE.find((c) => !used.has(c)) ?? '#0073EA';
              try {
                await createLabel.mutateAsync({
                  boardId, columnId: groupCol.id, name, color,
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not add label');
              }
            }}
          />
        )}
      </div>
    </DndContext>
  );
}

interface KanbanColumnProps {
  id: string;
  // When `label` is null this is the "Unassigned" bucket (no rename / no menu).
  label: ColumnLabelRow | null;
  // Used only by Unassigned — table-column form
  unassignedTitle?: string;
  unassignedColor?: string;
  items: ItemRow[];
  boardId: string;
  canEdit: boolean;
  onAdd: ((name: string) => Promise<void>) | null;
  onRename?: ((name: string) => Promise<void>) | null;
  onChangeColor?: ((color: string) => Promise<void>) | null;
  onDelete?: (() => Promise<void>) | null;
  onOpenItem: (id: string) => void;
}

function KanbanColumn({
  id, label, unassignedTitle, unassignedColor,
  items, canEdit, onAdd, onRename, onChangeColor, onDelete, onOpenItem,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const title = label?.name ?? unassignedTitle ?? 'Unassigned';
  const color = label?.color ?? unassignedColor ?? '#C4C4C4';

  const [menuOpen, setMenuOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(title);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraftName(title), [title]);
  useEffect(() => {
    if (!menuOpen && !colorOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setColorOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen, colorOpen]);

  const commitRename = async () => {
    const t = draftName.trim();
    setRenaming(false);
    if (!t || t === title || !onRename) { setDraftName(title); return; }
    await onRename(t);
  };

  const showMenu = !!label && canEdit && (onRename || onChangeColor || onDelete);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'shrink-0 w-[280px] bg-app/40 rounded-md border border-border-light flex flex-col max-h-[calc(100vh-280px)]',
        isOver && 'ring-2 ring-brand',
      )}
    >
      <header
        className="px-3 py-2 rounded-t-md flex items-center justify-between text-white relative"
        style={{ background: color }}
      >
        {renaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename();
              else if (e.key === 'Escape') { setDraftName(title); setRenaming(false); }
            }}
            className="flex-1 min-w-0 text-[13px] font-semibold uppercase tracking-wide bg-white/15 border border-white/40 rounded-sm px-1 outline-none text-white placeholder:text-white/70"
          />
        ) : (
          <span
            className={cn('text-[13px] font-semibold uppercase tracking-wide truncate', showMenu && 'cursor-text')}
            onClick={() => showMenu && setRenaming(true)}
            title={showMenu ? 'Click to rename' : ''}
          >
            {title}
          </span>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[12px] font-medium bg-white/20 rounded-pill px-2 py-0.5">{items.length}</span>
          {showMenu && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                aria-label="Label menu"
                onClick={() => { setMenuOpen((v) => !v); setColorOpen(false); }}
                className="h-6 w-6 inline-flex items-center justify-center rounded-sm hover:bg-white/20"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-7 z-30 w-44 bg-surface text-text-primary border border-border-light rounded-md shadow-lg overflow-hidden">
                  {onRename && (
                    <button
                      onClick={() => { setMenuOpen(false); setRenaming(true); }}
                      className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover"
                    >
                      <Pencil className="h-3.5 w-3.5 text-text-secondary" /> Rename
                    </button>
                  )}
                  {onChangeColor && (
                    <button
                      onClick={() => { setMenuOpen(false); setColorOpen(true); }}
                      className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover"
                    >
                      <Palette className="h-3.5 w-3.5 text-text-secondary" /> Change color
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={async () => { setMenuOpen(false); await onDelete(); }}
                      className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-error/10 text-error"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete label
                    </button>
                  )}
                </div>
              )}
              {colorOpen && onChangeColor && (
                <div className="absolute right-0 top-7 z-30 bg-surface border border-border-light rounded-md shadow-lg p-2 grid grid-cols-6 gap-1.5 w-[160px]">
                  {LABEL_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={async () => { setColorOpen(false); await onChangeColor(c); }}
                      className={cn(
                        'h-5 w-5 rounded-sm inline-flex items-center justify-center',
                        c === color && 'ring-2 ring-text-primary ring-offset-1 ring-offset-surface',
                      )}
                      style={{ background: c }}
                      aria-label={c}
                    >
                      {c === color && <Check className="h-3 w-3 text-white" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
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

function AddLabelColumn({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await onAdd(draft.trim());
      setDraft('');
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="shrink-0 w-[280px] h-[68px] inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border-medium text-sm font-medium text-text-secondary hover:bg-hover hover:text-text-primary"
      >
        <Plus className="h-4 w-4" />
        Add label
      </button>
    );
  }

  return (
    <div className="shrink-0 w-[280px] rounded-md border border-border-light bg-surface p-2 space-y-2">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-text-secondary">New label</p>
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !submitting) void submit();
          else if (e.key === 'Escape') { setDraft(''); setAdding(false); }
        }}
        placeholder="Label name"
        disabled={submitting}
        className="input h-8 text-[13px] w-full"
      />
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={() => { setDraft(''); setAdding(false); }}
          className="btn-ghost h-7 px-3 text-xs"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !draft.trim()}
          className="btn-primary h-7 px-3 text-xs"
        >
          Add
        </button>
      </div>
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
