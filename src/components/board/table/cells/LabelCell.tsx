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
          'group/labelcell relative w-full h-full overflow-hidden',
          !readonly && 'cursor-pointer',
        )}
        onClick={() => !readonly && (isEditing ? onEndEdit() : onStartEdit())}
      >
        {isEmpty ? (
          // Empty cell: neutral slate fill (--bg-row) — empty is a STYLE,
          // not a void. No em-dash. Hover reveals a faint "+" so the
          // user knows the cell is clickable; the bare cell just blends
          // into the row's neutral fill otherwise.
          <span
            className={cn(
              'chip-cell chip-cell-center text-text-secondary',
              !readonly && 'hover:bg-white/[0.08]',
            )}
            style={{ background: 'var(--bg-row)' }}
          >
            {!readonly && (
              <span className="opacity-0 group-hover/labelcell:opacity-60 text-[16px] leading-none transition-opacity duration-100">
                +
              </span>
            )}
          </span>
        ) : multi ? (
          // Multi-select (dropdown): fill the cell with the FIRST label's
          // color as the background ribbon, then float the rest of the
          // labels as small chips on top. Still no per-cell border.
          <span
            className="chip-cell chip-cell-start gap-1 overflow-hidden"
            style={{ background: selectedLabels[0]?.color ?? 'var(--bg-row)' }}
          >
            {selectedLabels.slice(0, 3).map((l, i) => (
              <span
                key={l.id}
                className={cn(
                  'inline-flex items-center h-5 px-1.5 rounded-sm text-[12px] font-semibold text-white truncate max-w-[110px]',
                  i === 0 ? 'bg-black/15' : '',
                )}
                style={i === 0 ? undefined : { background: l.color }}
                title={l.name}
              >
                {l.name}
              </span>
            ))}
            {selectedLabels.length > 3 && (
              <span className="text-[12px] text-white/85">+{selectedLabels.length - 3}</span>
            )}
          </span>
        ) : (
          // Status/Priority: FULL-BLEED saturated chip — fills the entire
          // cell edge-to-edge. Sharp corners (radius 0). 1px gap to next
          // cell comes from the ItemRow wrapper's mr-px.
          <span
            className="chip-cell chip-cell-center"
            style={{ background: selectedLabels[0].color }}
            title={selectedLabels[0].name}
          >
            <span className="truncate">{selectedLabels[0].name}</span>
          </span>
        )}
      </div>
      <Popover
        anchorRef={anchorRef}
        open={isEditing}
        onClose={onEndEdit}
        minWidth={260}
        variant="chip"
      >
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
