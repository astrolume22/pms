import { useRef, useState, useEffect } from 'react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Trash2, Pencil, Copy, Palette,
} from 'lucide-react';
import type { GroupRow, ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';
import { ItemRow as ItemRowComp } from './ItemRow';
import { AddItemRow } from './AddItemRow';
import { ColumnFooter } from './ColumnFooter';
import { useUpdateGroup, useDeleteGroup } from '@/hooks/groups';
import { useBoardViewStore } from '@/state/boardViewStore';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';

interface GroupBlockProps {
  group: GroupRow;
  items: ItemRow[];
  columns: ColumnRow[];
  visibleColumns: ColumnRow[];
  labelsByColumnId: Map<string, ColumnLabelRow[]>;
  valuesByItemColumn: Map<string, unknown>;
  boardId: string;
  canEdit: boolean;
  subitemsByParent: Map<string, ItemRow[]>;
  onOpenLabelsEditor: (col: ColumnRow) => void;
  // Pixel width that every row in the table needs to occupy so the rows line up
  // with the column-header row inside the single horizontal scroll container.
  rowMinWidth: number;
}

const COLORS = [
  '#00C875', '#E2445C', '#FDAB3D', '#FFCB00', '#A25DDC', '#784BD1',
  '#0086C0', '#579BFC', '#037F4C', '#FF158A', '#9CD326', '#225091',
];

export function GroupBlock({
  group, items, columns, visibleColumns, labelsByColumnId, valuesByItemColumn,
  boardId, canEdit, subitemsByParent, onOpenLabelsEditor, rowMinWidth,
}: GroupBlockProps) {
  const sortable = useSortable({ id: `group:${group.id}`, disabled: !canEdit });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  const collapsed = useBoardViewStore((s) => s.persisted.collapsedGroupIds.includes(group.id));
  const toggleCollapsed = useBoardViewStore((s) => s.toggleGroupCollapsed);
  const expandedItemIds = useBoardViewStore((s) => s.expandedItemIds);
  const toggleExpanded = useBoardViewStore((s) => s.toggleExpanded);

  const update = useUpdateGroup();
  const remove = useDeleteGroup();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(group.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  useEffect(() => setDraftName(group.name), [group.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const commitName = async () => {
    setRenaming(false);
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === group.name) { setDraftName(group.name); return; }
    try {
      await update.mutateAsync({ id: group.id, boardId, patch: { name: trimmed } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
      setDraftName(group.name);
    }
  };

  const itemIds = items.map((i) => i.id);

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        'border-b border-border-light last:border-b-0',
        sortable.isDragging && 'opacity-50',
      )}
    >
      {/* Group header — sticky to the LEFT edge of the scroll container so the
          title/menu/etc. stay visible when the user scrolls horizontally.
          Taller padding to match Monday's roomier group bar. */}
      <div
        className="sticky left-0 z-[4] flex items-center gap-2 py-2.5 pl-2 pr-3 bg-surface border-l-[5px]"
        style={{ borderLeftColor: group.color, maxWidth: 'calc(100vw - 320px)' }}
      >
        {canEdit && (
          <button
            type="button"
            {...sortable.attributes}
            {...sortable.listeners}
            className="h-5 w-3 flex items-center justify-center text-text-disabled cursor-grab active:cursor-grabbing"
            aria-label="Drag group"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => toggleCollapsed(group.id)}
          className="h-6 w-6 inline-flex items-center justify-center rounded-sm hover:bg-hover"
          aria-label={collapsed ? 'Expand group' : 'Collapse group'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {renaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitName();
              else if (e.key === 'Escape') { setDraftName(group.name); setRenaming(false); }
            }}
            className="text-base font-bold tracking-tight bg-surface border border-brand rounded-sm px-1 outline-none"
            style={{ color: group.color }}
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => canEdit && setRenaming(true)}
            className="text-base font-bold tracking-tight"
            style={{ color: group.color }}
            title={canEdit ? 'Double-click to rename' : ''}
          >
            {group.name}
          </button>
        )}
        <span className="text-sm text-text-disabled font-medium">{items.length} task{items.length === 1 ? '' : 's'}</span>

        {canEdit && (
          <div ref={menuRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Group menu"
              className="h-6 w-6 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-30 w-44 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); setRenaming(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover"
                >
                  <Pencil className="h-3.5 w-3.5 text-text-secondary" /> Rename
                </button>
                <button
                  onClick={() => { setMenuOpen(false); setColorPickerOpen(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover"
                >
                  <Palette className="h-3.5 w-3.5 text-text-secondary" /> Change color
                </button>
                <button
                  onClick={() => { setMenuOpen(false); toast.info('Duplicate group arrives in V2'); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover opacity-60"
                  disabled
                >
                  <Copy className="h-3.5 w-3.5 text-text-secondary" /> Duplicate
                </button>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    if (items.length > 0 &&
                        !window.confirm(`Delete group "${group.name}" and its ${items.length} task${items.length===1?'':'s'}?`)) return;
                    try {
                      await remove.mutateAsync({ id: group.id, boardId });
                      toast.success('Group deleted');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Delete failed');
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-error/10 text-error"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete group
                </button>
              </div>
            )}
            {colorPickerOpen && (
              <div
                className="absolute right-0 top-7 z-30 bg-surface border border-border-light rounded-md shadow-lg p-2 grid grid-cols-6 gap-1.5 w-[160px]"
                onMouseLeave={() => setColorPickerOpen(false)}
              >
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={async () => {
                      setColorPickerOpen(false);
                      try {
                        await update.mutateAsync({ id: group.id, boardId, patch: { color: c } });
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Color update failed');
                      }
                    }}
                    className={cn(
                      'h-5 w-5 rounded-sm',
                      group.color === c && 'ring-2 ring-text-primary ring-offset-1 ring-offset-surface',
                    )}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="border-t border-border-light" style={{ minWidth: rowMinWidth }}>
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {items.map((it) => {
              const kids = subitemsByParent.get(it.id) ?? [];
              const isExp = expandedItemIds.has(it.id);
              return (
                <div key={it.id}>
                  <ItemRowComp
                    item={it}
                    columns={columns}
                    visibleColumns={visibleColumns}
                    labelsByColumnId={labelsByColumnId}
                    valuesByItemColumn={valuesByItemColumn}
                    boardId={boardId}
                    canEdit={canEdit}
                    hasSubitems={kids.length > 0}
                    onToggleSubitems={() => toggleExpanded(it.id)}
                    onOpenLabelsEditor={onOpenLabelsEditor}
                  />
                  {isExp && (
                    <div className="pl-10 bg-app/30">
                      {kids.map((sub) => (
                        <ItemRowComp
                          key={sub.id}
                          item={sub}
                          columns={columns}
                          visibleColumns={visibleColumns}
                          labelsByColumnId={labelsByColumnId}
                          valuesByItemColumn={valuesByItemColumn}
                          boardId={boardId}
                          canEdit={canEdit}
                          isSubitem
                          onOpenLabelsEditor={onOpenLabelsEditor}
                        />
                      ))}
                      <AddItemRow
                        boardId={boardId}
                        groupId={group.id}
                        parentItemId={it.id}
                        totalWidth={rowMinWidth}
                        placeholder="+ Add subitem"
                        disabled={!canEdit}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </SortableContext>
          <AddItemRow
            boardId={boardId}
            groupId={group.id}
            totalWidth={rowMinWidth}
            disabled={!canEdit}
          />
          {/* Column footer summaries */}
          <ColumnFooter
            visibleColumns={visibleColumns}
            items={items}
            valuesByItemColumn={valuesByItemColumn}
            labelsByColumnId={labelsByColumnId}
          />
        </div>
      )}
    </div>
  );
}
