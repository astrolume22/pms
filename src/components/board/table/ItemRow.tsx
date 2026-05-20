import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, GripVertical, ChevronDown } from 'lucide-react';
import type { ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';
import { CellRenderer } from './cells/CellRenderer';
import { useUpdateCellValue } from '@/hooks/items';
import { useBoardViewStore, ITEM_HEIGHT_PX } from '@/state/boardViewStore';
import { cn } from '@/lib/cn';

interface ItemRowProps {
  item: ItemRow;
  columns: ColumnRow[];
  visibleColumns: ColumnRow[];
  labelsByColumnId: Map<string, ColumnLabelRow[]>;
  valuesByItemColumn: Map<string, unknown>;
  boardId: string;
  canEdit: boolean;
  isSubitem?: boolean;
  hasSubitems?: boolean;
  onToggleSubitems?: () => void;
  onOpenLabelsEditor: (col: ColumnRow) => void;
}

export function ItemRow({
  item, columns, visibleColumns, labelsByColumnId, valuesByItemColumn,
  boardId, canEdit, isSubitem, hasSubitems, onToggleSubitems, onOpenLabelsEditor,
}: ItemRowProps) {
  const sortable = useSortable({ id: item.id, disabled: !canEdit || isSubitem });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  const isSelected = useBoardViewStore((s) => s.selectedItemIds.has(item.id));
  const isExpanded = useBoardViewStore((s) => s.expandedItemIds.has(item.id));
  const toggleSel = useBoardViewStore((s) => s.toggleSelected);
  const itemHeight = useBoardViewStore((s) => s.persisted.itemHeight);
  const rowHeight = ITEM_HEIGHT_PX[itemHeight];

  const updateCell = useUpdateCellValue();
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);

  // Find task_name column code display
  const taskNameCol = columns.find((c) => c.column_type === 'task_name');

  return (
    <div
      ref={sortable.setNodeRef}
      style={{ ...style, height: rowHeight, opacity: sortable.isDragging ? 0.4 : 1 }}
      className={cn(
        'group/row flex items-stretch border-b border-border-light text-sm',
        isSelected ? 'bg-selected' : 'hover:bg-hover',
        isSubitem && 'bg-app/40',
      )}
    >
      {/* Gutter: drag handle + checkbox + expand */}
      <div
        className={cn(
          'shrink-0 flex items-center justify-center gap-0.5 border-r border-border-light bg-surface sticky left-0 z-[3]',
          isSelected && 'bg-selected',
        )}
        style={{ width: 40 }}
      >
        {canEdit && !isSubitem && (
          <button
            type="button"
            {...sortable.attributes}
            {...sortable.listeners}
            className="opacity-0 group-hover/row:opacity-100 h-5 w-3 flex items-center justify-center text-text-disabled cursor-grab active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleSel(item.id)}
          className="h-3.5 w-3.5 accent-brand cursor-pointer"
          aria-label={isSelected ? 'Deselect task' : 'Select task'}
        />
        {hasSubitems && onToggleSubitems && !isSubitem && (
          <button
            type="button"
            onClick={onToggleSubitems}
            className="h-5 w-5 inline-flex items-center justify-center text-text-secondary hover:bg-hover/50 rounded-sm"
            aria-label={isExpanded ? 'Collapse subitems' : 'Expand subitems'}
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* Visible columns */}
      {visibleColumns.map((col) => {
        const key = `${item.id}:${col.id}`;
        const val = valuesByItemColumn.get(key);
        return (
          <div
            key={col.id}
            style={{ width: col.width }}
            className={cn(
              'shrink-0 border-r border-border-light last:border-r-0 relative',
              col.column_type === 'task_name' && 'sticky z-[2] bg-surface',
              col.column_type === 'task_name' && isSelected && 'bg-selected',
            )}
          >
            <CellRenderer
              item={item}
              column={col}
              value={val}
              labelsForColumn={labelsByColumnId.get(col.id)}
              boardId={boardId}
              readonly={!canEdit}
              isEditing={editingColumnId === col.id}
              onStartEdit={() => setEditingColumnId(col.id)}
              onEndEdit={() => setEditingColumnId(null)}
              onCommit={(v) => {
                updateCell.mutate({ boardId, itemId: item.id, columnId: col.id, value: v });
              }}
              onOpenLabelsEditor={onOpenLabelsEditor}
            />
            {/* For task_name col: show task code under the name in a tiny font */}
            {col.column_type === 'task_name' && taskNameCol?.id === col.id && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-disabled font-mono pointer-events-none">
                {item.task_code}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
