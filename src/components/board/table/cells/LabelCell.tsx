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

  return (
    <>
      <div
        ref={anchorRef}
        className={cn(
          'w-full h-full flex items-center px-1 gap-1 overflow-hidden',
          !readonly && 'cursor-pointer',
        )}
        onClick={() => !readonly && (isEditing ? onEndEdit() : onStartEdit())}
      >
        {selectedLabels.length === 0 ? (
          <span className="text-xs text-text-disabled px-1">—</span>
        ) : multi ? (
          <div className="flex items-center gap-1 overflow-hidden">
            {selectedLabels.slice(0, 3).map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center h-5 px-2 rounded-sm text-[11px] font-medium text-white truncate max-w-[100px]"
                style={{ background: l.color }}
                title={l.name}
              >
                {l.name}
              </span>
            ))}
            {selectedLabels.length > 3 && (
              <span className="text-[11px] text-text-secondary">+{selectedLabels.length - 3}</span>
            )}
          </div>
        ) : (
          // Status/Priority: full-cell colored pill
          <span
            className="block w-full h-full rounded-sm text-xs font-medium text-white text-center flex items-center justify-center px-1"
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
        />
      </Popover>
    </>
  );
}
