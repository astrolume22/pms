import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, GripVertical, ChevronDown, MessageSquare } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';
import { CellRenderer } from './cells/CellRenderer';
import { useUpdateCellValue } from '@/hooks/items';
import { useBoardViewStore, ITEM_HEIGHT_PX } from '@/state/boardViewStore';
import { COMMENT_COL_WIDTH, TASK_CODE_COL_WIDTH, GUTTER_WIDTH } from './tableLayout';
import { useAuthStore } from '@/state/authStore';
import { canEditCell } from '@/lib/permissions';
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
  item, visibleColumns, labelsByColumnId, valuesByItemColumn,
  boardId, canEdit, isSubitem, hasSubitems, onToggleSubitems, onOpenLabelsEditor,
}: ItemRowProps) {
  const navigate = useNavigate();
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
  const profile = useAuthStore((s) => s.profile);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);

  const openTaskPanel = () => {
    navigate({
      to: '/w/$workspace/b/$boardId',
      params: { workspace: 'main', boardId },
      search: { p: item.id },
    });
  };

  // Split columns into task_name (rendered first, sticky-left) and the rest.
  const taskNameCol = visibleColumns.find((c) => c.column_type === 'task_name');
  const otherCols = visibleColumns.filter((c) => c.column_type !== 'task_name');

  return (
    <div
      ref={sortable.setNodeRef}
      style={{ ...style, height: rowHeight, opacity: sortable.isDragging ? 0.4 : 1 }}
      className={cn(
        'group/row flex items-stretch border-b border-border-light text-[14px]',
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
        style={{ width: GUTTER_WIDTH }}
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
        {/* Selection checkbox drives the bulk-action bar — admin-only feature. */}
        {canEdit && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSel(item.id)}
            className="h-3.5 w-3.5 accent-brand cursor-pointer"
            aria-label={isSelected ? 'Deselect task' : 'Select task'}
          />
        )}
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

      {/* Task-name cell (sticky-left after the gutter) */}
      {taskNameCol && (
        <div
          style={{ width: taskNameCol.width }}
          className={cn(
            'shrink-0 border-r border-border-light sticky z-[2]',
            isSelected ? 'bg-selected' : 'bg-surface',
          )}
        >
          <CellRenderer
            item={item}
            column={taskNameCol}
            value={valuesByItemColumn.get(`${item.id}:${taskNameCol.id}`)}
            labelsForColumn={labelsByColumnId.get(taskNameCol.id)}
            boardId={boardId}
            readonly={!canEditCell(profile, taskNameCol)}
            isEditing={editingColumnId === taskNameCol.id}
            onStartEdit={() => setEditingColumnId(taskNameCol.id)}
            onEndEdit={() => setEditingColumnId(null)}
            onCommit={(v) => updateCell.mutate({ boardId, itemId: item.id, columnId: taskNameCol.id, value: v })}
            onOpenLabelsEditor={onOpenLabelsEditor}
          />
        </div>
      )}

      {/* Synthetic comment-indicator column */}
      <div
        style={{ width: COMMENT_COL_WIDTH }}
        className="shrink-0 border-r border-border-light flex items-center justify-center"
      >
        <button
          type="button"
          onClick={openTaskPanel}
          title="Open task / see updates"
          aria-label="Open task"
          className="h-6 w-6 inline-flex items-center justify-center rounded-pill border border-border-light bg-app/40 text-text-secondary hover:bg-brand/10 hover:text-brand hover:border-brand/40 transition-colors duration-100"
        >
          <MessageSquare className="h-3 w-3" />
        </button>
      </div>

      {/* Synthetic task-code column (read-only, sourced from item.task_code) */}
      <div
        style={{ width: TASK_CODE_COL_WIDTH }}
        className="shrink-0 border-r border-border-light flex items-center justify-center text-[12px] font-mono text-text-secondary"
      >
        {item.task_code}
      </div>

      {/* Remaining user-defined columns */}
      {otherCols.map((col) => {
        const key = `${item.id}:${col.id}`;
        const val = valuesByItemColumn.get(key);
        return (
          <div
            key={col.id}
            style={{ width: col.width }}
            className="shrink-0 border-r border-border-light"
          >
            <CellRenderer
              item={item}
              column={col}
              value={val}
              labelsForColumn={labelsByColumnId.get(col.id)}
              boardId={boardId}
              readonly={!canEditCell(profile, col)}
              isEditing={editingColumnId === col.id}
              onStartEdit={() => setEditingColumnId(col.id)}
              onEndEdit={() => setEditingColumnId(null)}
              onCommit={(v) => updateCell.mutate({ boardId, itemId: item.id, columnId: col.id, value: v })}
              onOpenLabelsEditor={onOpenLabelsEditor}
            />
          </div>
        );
      })}
    </div>
  );
}
