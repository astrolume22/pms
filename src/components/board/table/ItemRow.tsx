import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, GripVertical, ChevronDown } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';
import { CellRenderer } from './cells/CellRenderer';
import { useUpdateCellValue } from '@/hooks/items';
import { useBoardViewStore, ITEM_HEIGHT_PX } from '@/state/boardViewStore';
import {
  COMMENT_COL_WIDTH,
  TASK_CODE_COL_WIDTH,
  GUTTER_WIDTH,
  GUTTER_DRAG_WIDTH,
  GUTTER_CHECK_WIDTH,
  GUTTER_EXPAND_WIDTH,
  TASK_NAME_MIN_WIDTH,
  TASK_NAME_MAX_WIDTH,
} from './tableLayout';
import { useAuthStore } from '@/state/authStore';
import { canEditCell } from '@/lib/permissions';
import { CommentIndicator } from './cells/CommentIndicator';
import { TaskCodeChip } from './cells/TaskCodeChip';
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

/**
 * One row of the board table — premium polish layout.
 *
 * Anatomy (left → right, exact widths in tableLayout.ts):
 *   1. Drag handle       transparent
 *   2. Checkbox          transparent
 *   3. Expand caret      transparent (only when there are subtasks)
 *   4. Task name         transparent, plain 13/400 white left-aligned
 *   5. Comment indicator transparent
 *   6. Task Code         slate-fill CHIP
 *   7+ Status / Task Type / Co-Work Time / Priority / Date / others → CHIPS
 *
 * Visual rules:
 *   • No horizontal row borders (criterion 8 — "kill row dividers").
 *   • No vertical per-cell borders (criterion 1 — "1px gap of dark canvas
 *     is the only separator"). The gap is created by the parent's
 *     space-y-px AND by an `mr-px` on each cell.
 *   • Cells 6+ are CHIPS — full width / full height, padding inside chip,
 *     sharp corners (radius 0).
 *   • Cells 1–5 are transparent (canvas shows through).
 *   • Selected row gets a 4px chip-sky vertical accent in the checkbox
 *     column (chunk 13 — distinct from group spine).
 */
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
        // Canvas-colored row container: shows through as the 1px gap
        // between cells. No row borders.
        'group/row flex items-stretch bg-canvas text-[13px]',
        isSubitem && 'opacity-95',
      )}
    >
      {/* Gutter — brief section A: three transparent sub-cells (drag 24
          + checkbox 40 + expand 24). Selected row → 4px chip-sky inset
          accent at the very left of the row, distinct from the group
          spine (which sits on the data block's left edge). */}
      <div
        className={cn(
          'shrink-0 flex items-stretch sticky left-0 z-[3] bg-canvas',
          isSelected && 'shadow-[inset_4px_0_0_0_var(--chip-sky)]',
        )}
        style={{ width: GUTTER_WIDTH }}
      >
        {/* (1) Drag handle — 24px, hover-only at 30% opacity */}
        <div
          className="flex items-center justify-center"
          style={{ width: GUTTER_DRAG_WIDTH }}
        >
          {canEdit && !isSubitem && (
            <button
              type="button"
              {...sortable.attributes}
              {...sortable.listeners}
              className="opacity-0 group-hover/row:opacity-30 hover:!opacity-100 h-5 w-5 inline-flex items-center justify-center text-text-secondary cursor-grab active:cursor-grabbing transition-opacity duration-100"
              aria-label="Drag to reorder"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* (2) Selection checkbox — 40px, drives the bulk-action bar */}
        <div
          className="flex items-center justify-center"
          style={{ width: GUTTER_CHECK_WIDTH }}
        >
          {canEdit && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSel(item.id)}
              className="h-4 w-4 accent-brand cursor-pointer"
              aria-label={isSelected ? 'Deselect task' : 'Select task'}
            />
          )}
        </div>
        {/* (3) Expand caret — 24px, only visible when the row has subtasks */}
        <div
          className="flex items-center justify-center"
          style={{ width: GUTTER_EXPAND_WIDTH }}
        >
          {hasSubitems && onToggleSubitems && !isSubitem && (
            <button
              type="button"
              onClick={onToggleSubitems}
              className="h-5 w-5 inline-flex items-center justify-center text-text-secondary hover:bg-[var(--overlay-8)] rounded-sm"
              aria-label={isExpanded ? 'Collapse subitems' : 'Expand subitems'}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Task-name cell (sticky-left after the gutter). Transparent — NOT a
          chip. Plain 13px white text left-aligned. Brief A.4: flex with
          min 240 / max 360 — DB-stored width is clamped to this band so
          the column never feels cramped or sprawling. */}
      {taskNameCol && (
        <div
          style={{
            width: Math.min(TASK_NAME_MAX_WIDTH, Math.max(TASK_NAME_MIN_WIDTH, taskNameCol.width)),
          }}
          className={cn(
            'shrink-0 sticky z-[2] bg-canvas',
            // 1px horizontal gap to the next cell — canvas shows through
            // because we leave a margin instead of a border.
            'mr-px',
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

      {/* Synthetic comment-indicator column — transparent. */}
      <div
        style={{ width: COMMENT_COL_WIDTH }}
        className="shrink-0 mr-px flex items-center justify-center"
      >
        <CommentIndicator
          item={item}
          onOpen={openTaskPanel}
        />
      </div>

      {/* Synthetic task-code column — SLATE-FILL chip (chunk 3 styling). */}
      <div
        style={{ width: TASK_CODE_COL_WIDTH }}
        className="shrink-0 mr-px"
      >
        <TaskCodeChip code={item.task_code} onClick={openTaskPanel} />
      </div>

      {/* Remaining user-defined columns — CHIPS fill the cell.
          The CellRenderer renders the right chip background per column type. */}
      {otherCols.map((col, idx) => {
        const key = `${item.id}:${col.id}`;
        const val = valuesByItemColumn.get(key);
        const isLast = idx === otherCols.length - 1;
        return (
          <div
            key={col.id}
            style={{ width: col.width }}
            className={cn(
              'shrink-0',
              // 1px gap on the right unless this is the last cell in the
              // user-defined column run (the row's "+ Add column" cell
              // already sits on canvas).
              !isLast && 'mr-px',
            )}
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
