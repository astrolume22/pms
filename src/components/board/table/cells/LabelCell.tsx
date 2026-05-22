import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { Popover } from '../Popover';
import { LabelPicker } from '../LabelPicker';
import { chipColorFor } from '@/lib/chipColor';
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

  // Token-anchored chip color for the selected label(s). chipColorFor()
  // checks the column type AND name so Task Type / Priority / Co-Work
  // Time all pull from the OKLCH chip palette regardless of the hex
  // that's stored in the DB. Default columns (custom dropdowns) still
  // render their stored color.
  const tokenColorFor = (labelId: string): string => {
    const idx = labels.findIndex((l) => l.id === labelId);
    const lbl = labels[idx];
    if (!lbl) return 'var(--chip-slate)';
    return chipColorFor(column, lbl, idx === -1 ? 0 : idx, labels.length);
  };

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
        // Keyboard-focusable surface — :focus-visible adds the 2px
        // inset chip-sky ring per criterion 24. Enter / Space opens
        // the picker just like the click handler does.
        tabIndex={readonly ? -1 : 0}
        role={readonly ? undefined : 'button'}
        className={cn(
          'cell-focusable group/labelcell relative w-full h-full overflow-hidden',
          !readonly && 'cursor-pointer',
        )}
        onClick={() => !readonly && (isEditing ? onEndEdit() : onStartEdit())}
        onKeyDown={(e) => {
          if (readonly) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isEditing) onEndEdit(); else onStartEdit();
          }
        }}
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
          // token color as the background ribbon, then float the rest as
          // small chips on top.
          <span
            className="chip-cell chip-cell-start gap-1 overflow-hidden"
            style={{ background: selectedLabels[0] ? tokenColorFor(selectedLabels[0].id) : 'var(--bg-row)' }}
          >
            {selectedLabels.slice(0, 3).map((l, i) => (
              <span
                key={l.id}
                className={cn(
                  'inline-flex items-center h-5 px-1.5 rounded-sm text-[12px] font-semibold text-white truncate max-w-[110px]',
                  i === 0 ? 'bg-black/15' : '',
                )}
                style={i === 0 ? undefined : { background: tokenColorFor(l.id) }}
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
          // Status/Priority/etc: FULL-BLEED saturated chip — fills the
          // entire cell edge-to-edge. Sharp corners (radius 0). Color is
          // mapped through chipColorFor() so Status / Priority / Task
          // Type / Co-Work Time all pull from the OKLCH chip palette.
          <span
            className="chip-cell chip-cell-center group-hover/labelcell:brightness-110 transition-[filter] duration-100"
            style={{ background: tokenColorFor(selectedLabels[0].id) }}
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
          column={column}
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
