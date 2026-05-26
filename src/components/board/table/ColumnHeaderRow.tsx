/**
 * Per-group column-header row.
 *
 * Renders the column-header band that used to live ONCE at the top of
 * BoardContent — now rendered ONCE PER GROUP inside GroupBlock, between
 * the group title row and the group's data block (above the colored
 * spine), Monday-style.
 *
 * Column alignment with the data rows below is preserved because:
 *   - Every column-header cell and every item-row cell reads its width
 *     from boardViewStore.liveColumnWidths (chunk-3 live resize) → all
 *     groups + rows + summary move together when any header resizes.
 *   - The fixed prefix (88px gutter + sticky task-name + 40px comment
 *     + 100px task-code) is hand-mirrored here AND in ItemRow.
 *   - The outer horizontal-scroll container in BoardContent still
 *     wraps every group, so all per-group headers share one scrollLeft.
 *
 * Column drag-reorder: each per-group header is wrapped in its own
 * SortableContext so duplicate sortable ids across groups don't conflict.
 * dnd-kit dispatches drag-end to BoardContent's onDragEnd, which detects
 * column drag by checking active.id against the columns list and fires
 * the reorderColumns mutation. Every per-group header re-renders in
 * the new order via the query cache. The per-group headers stay locked
 * in step with each other.
 */
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { ColumnHeader } from './ColumnHeader';
import { AddColumnMenu } from './AddColumnMenu';
import {
  GUTTER_WIDTH,
  COMMENT_COL_WIDTH,
  TASK_CODE_COL_WIDTH,
} from './tableLayout';
import type { ColumnRow } from '@/lib/database.types';

interface ColumnHeaderRowProps {
  boardId: string;
  canEdit: boolean;
  visibleColumns: ColumnRow[];
  columnIds: string[];
  rowMinWidth: number;
  onOpenLabelsEditor: (col: ColumnRow) => void;
  /** Stable suffix that disambiguates this header's sortable container from
   *  every other per-group header in the same DndContext. Typically the
   *  group id. Without this, two header rows registering the SAME column
   *  id in the SAME DndContext would compete for the drag slot. */
  groupId: string;
  /** Show the "+ Add column" trailing cell. Defaults to true. */
  showAddColumn?: boolean;
}

export function ColumnHeaderRow({
  boardId, canEdit, visibleColumns, columnIds, rowMinWidth, onOpenLabelsEditor,
  groupId, showAddColumn = true,
}: ColumnHeaderRowProps) {
  // Split the same way ItemRow does so Task name renders first (sticky-
  // left at left-[88px]), then the synthetic comment + task-code cells,
  // then the rest.
  const taskNameCol = visibleColumns.find((c) => c.column_type === 'task_name');
  const otherCols   = visibleColumns.filter((c) => c.column_type !== 'task_name');

  return (
    <div
      className="flex items-stretch bg-header-band h-9 border-b border-border-hair"
      style={{ minWidth: rowMinWidth }}
    >
      {/* 88px sticky-left gutter spacer matches ItemRow.gutter. The
          inner sticky-left wrapper hugs the canvas-side edge so it
          tracks the horizontal scroll like the rest. */}
      <div
        className="shrink-0 sticky left-0 z-[5] bg-header-band border-r border-border-hair"
        style={{ width: GUTTER_WIDTH }}
        data-group={groupId}
      />

      <SortableContext
        items={columnIds}
        strategy={horizontalListSortingStrategy}
        id={`cols:${groupId}`}
      >
        {taskNameCol && (
          <ColumnHeader
            key={taskNameCol.id}
            column={taskNameCol}
            boardId={boardId}
            canEdit={canEdit}
            onOpenLabelsEditor={onOpenLabelsEditor}
          />
        )}

        {/* Synthetic header cells — empty title for the comment column
            (icon is per-row), "Code" for the task-code column. */}
        <div
          style={{ width: COMMENT_COL_WIDTH }}
          className="shrink-0 flex items-center justify-center border-r border-border-hair"
          aria-hidden="true"
        />
        <div
          style={{ width: TASK_CODE_COL_WIDTH }}
          className="shrink-0 flex items-center justify-center col-header-text border-r border-border-hair"
        >
          Code
        </div>

        {otherCols.map((col) => (
          <ColumnHeader
            key={col.id}
            column={col}
            boardId={boardId}
            canEdit={canEdit}
            onOpenLabelsEditor={onOpenLabelsEditor}
          />
        ))}
      </SortableContext>
      {showAddColumn && canEdit && (
        <AddColumnMenu boardId={boardId} disabled={!canEdit} />
      )}
    </div>
  );
}
