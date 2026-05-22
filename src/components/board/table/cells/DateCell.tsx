import { useRef } from 'react';
import { Popover } from '../Popover';
import { DatePopover } from '../DatePopover';
import { dateToneFor, dateChipColor } from '@/lib/chipColor';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';

/**
 * Premium polish Date cell — relative-time tinted chip.
 *
 * Per chunk-5 spec:
 *   • Today    → full-bleed amber chip + dark text
 *   • Tomorrow → full-bleed sky chip   + white text
 *   • Overdue  → full-bleed pink chip  + white text
 *   • Future   → neutral row fill, plain white date text (no chip)
 *   • Empty    → neutral row fill, hover-+ affordance (chunk 14 rule)
 *
 * Sharp corners + full-fill come from .chip-cell. The 1px gap to the
 * next cell is provided by ItemRow's mr-px.
 */
function fmt(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function DateCell({ value, readonly, isEditing, onStartEdit, onEndEdit, onCommit }: CellProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const iso = (value as { date?: string | null } | undefined)?.date ?? null;
  const tone = dateToneFor(iso);
  const bg = dateChipColor(tone);   // null for future / empty

  // Today gets dark text on amber for contrast; everything else white.
  const textColor = tone === 'today' ? '#1A1D24' : '#FFFFFF';

  return (
    <>
      <div
        ref={anchorRef}
        tabIndex={readonly ? -1 : 0}
        role={readonly ? undefined : 'button'}
        className={cn(
          'cell-focusable group/datecell w-full h-full',
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
        {iso ? (
          <span
            className="chip-cell chip-cell-center"
            style={{
              background: bg ?? 'var(--bg-row)',
              color: bg ? textColor : 'var(--text-primary)',
            }}
            title={`${fmt(iso)}${tone === 'overdue' ? ' — overdue' : tone === 'today' ? ' — today' : tone === 'tomorrow' ? ' — tomorrow' : ''}`}
          >
            <span className="truncate">{fmt(iso)}</span>
          </span>
        ) : (
          // Empty: neutral row fill, hover reveals a faint "+". No em-dash.
          <span
            className={cn(
              'chip-cell chip-cell-center text-text-secondary',
              !readonly && 'hover:bg-white/[0.08]',
            )}
            style={{ background: 'var(--bg-row)' }}
          >
            {!readonly && (
              <span className="opacity-0 group-hover/datecell:opacity-60 text-[16px] leading-none transition-opacity duration-100">
                +
              </span>
            )}
          </span>
        )}
      </div>
      <Popover anchorRef={anchorRef} open={isEditing} onClose={onEndEdit} minWidth={280}>
        <DatePopover
          value={iso}
          onChange={(newIso) => {
            onCommit(newIso ? { date: newIso } : null);
            onEndEdit();
          }}
        />
      </Popover>
    </>
  );
}
