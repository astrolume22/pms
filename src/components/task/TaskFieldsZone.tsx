/**
 * Vertical list of editable field rows for a task — every visible column
 * (except the task name itself) is rendered as: label on the left, value
 * editor on the right. Reuses the table CellRenderer.
 */
import { useState } from 'react';
import type { ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';
import { CellRenderer } from '@/components/board/table/cells/CellRenderer';
import { useUpdateCellValue } from '@/hooks/items';

interface TaskFieldsZoneProps {
  item: ItemRow;
  columns: ColumnRow[];
  labelsByColumnId: Map<string, ColumnLabelRow[]>;
  valuesByItemColumn: Map<string, unknown>;
  boardId: string;
  canEdit: boolean;
  onOpenLabelsEditor: (col: ColumnRow) => void;
}

export function TaskFieldsZone({
  item, columns, labelsByColumnId, valuesByItemColumn, boardId, canEdit, onOpenLabelsEditor,
}: TaskFieldsZoneProps) {
  const updateCell = useUpdateCellValue();
  const [editingId, setEditingId] = useState<string | null>(null);

  const fields = columns
    .filter((c) => c.column_type !== 'task_name')
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <dl className="space-y-2 py-2">
      {fields.map((col) => {
        const value = valuesByItemColumn.get(`${item.id}:${col.id}`);
        return (
          <div
            key={col.id}
            className="grid grid-cols-[120px_1fr] items-center gap-3 px-4 py-1 rounded-base hover:bg-hover/40"
          >
            <dt className="text-xs uppercase tracking-wide text-text-secondary font-medium truncate">
              {col.name}
            </dt>
            <dd className="min-w-0">
              <div
                className="relative inline-flex w-full h-8 max-w-full rounded-sm border border-transparent hover:border-border-light"
                style={{ width: Math.max(col.width, 180) }}
              >
                <CellRenderer
                  item={item}
                  column={col}
                  value={value}
                  labelsForColumn={labelsByColumnId.get(col.id)}
                  boardId={boardId}
                  readonly={!canEdit}
                  isEditing={editingId === col.id}
                  onStartEdit={() => setEditingId(col.id)}
                  onEndEdit={() => setEditingId(null)}
                  onCommit={(v) => updateCell.mutate({ boardId, itemId: item.id, columnId: col.id, value: v })}
                  onOpenLabelsEditor={onOpenLabelsEditor}
                />
              </div>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
