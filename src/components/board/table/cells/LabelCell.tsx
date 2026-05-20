import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { Popover } from '../Popover';
import { LabelPicker } from '../LabelPicker';
import type { CellProps } from './cellTypes';

interface Props extends CellProps {
  multi?: boolean;       // dropdown = true, status/priority = false
}

export function LabelCell({
  column, value, labelsForColumn, boardId, readonly,
  isEditing, onStartEdit, onEndEdit, onCommit, onOpenLabelsEditor, multi = false,
}: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const labels = labelsForColumn ?? [];

  const currentIds = multi
    ? ((value as { label_ids?: string[] } | undefined)?.label_ids ?? [])
    : (() => {
        const id = (value as { label_id?: string | null } | undefined)?.label_id ?? null;
        return id ? [id] : [];
      })();

  const selectedLabels = currentIds
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is NonNullable<typeof l> => !!l);

  const handleChange = (ids: string[]) => {
    if (multi) {
      onCommit(ids.length > 0 ? { label_ids: ids } : null);
    } else {
      onCommit(ids[0] ? { label_id: ids[0] } : null);
      // Single-select: commit then close.
      onEndEdit();
    }
  };

  const isEmpty = selectedLabels.length === 0;
  const isSingleSelect = !multi;

  return (
    <>
      <div
        ref={anchorRef}
        className={cn(
          'w-full h-full flex items-center overflow-hidden',
          // Single-select empty: subtle grey fill (matches Monday's reference)
          isEmpty && isSingleSelect && 'bg-label-grey/25',
          !readonly && 'cursor-pointer',
        )}
        onClick={() => !readonly && (isEditing ? onEndEdit() : onStartEdit())}
      >
        {isEmpty ? (
          // For multi-select we keep a clean white cell with a centered dash.
          isSingleSelect ? null : (
            <span className="w-full text-center text-xs text-text-disabled">—</span>
          )
        ) : multi ? (
          <div className="flex items-center gap-1 overflow-hidden px-2">
            {selectedLabels.slice(0, 3).map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center h-6 px-2.5 rounded-sm text-[12px] font-semibold text-white truncate max-w-[110px]"
                style={{ background: l.color }}
                title={l.name}
              >
                {l.name}
              </span>
            ))}
            {selectedLabels.length > 3 && (
              <span className="text-[12px] text-text-secondary">+{selectedLabels.length - 3}</span>
            )}
          </div>
        ) : (
          // Status/Priority: full-cell saturated color, white centered label
          <span
            className="block w-full h-full text-[13px] font-semibold text-white flex items-center justify-center px-3 tracking-[0.005em]"
            style={{ background: selectedLabels[0].color }}
            title={selectedLabels[0].name}
          >
            <span className="truncate">{selectedLabels[0].name}</span>
          </span>
        )}
      </div>
      <Popover anchorRef={anchorRef} open={isEditing} onClose={onEndEdit} minWidth={260}>
        <LabelPicker
          boardId={boardId}
          columnId={column.id}
          labels={labels}
          selectedIds={currentIds}
          multi={multi}
          onChange={handleChange}
          onOpenLabelsEditor={() => { onEndEdit(); onOpenLabelsEditor?.(column); }}
          onDone={onEndEdit}
        />
      </Popover>
    </>
  );
}
