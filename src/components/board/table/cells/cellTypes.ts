import type { ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';

export interface CellProps {
  item: ItemRow;
  column: ColumnRow;
  value: unknown;
  labelsForColumn?: ColumnLabelRow[];
  boardId: string;
  readonly?: boolean;
  // Trigger the editor to open. Set by ItemRow.
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onCommit: (value: unknown) => void;
  onOpenLabelsEditor?: (column: ColumnRow) => void;
}
